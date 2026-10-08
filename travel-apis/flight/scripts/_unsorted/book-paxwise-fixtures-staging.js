/**
 * Book staging fixtures for paxwise matrix (leave Confirmed; no cancel).
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-paxwise-fixtures-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/book-paxwise-fixtures-staging.json';
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function adultProfiles(n) {
  const base = [
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
    ['Neha', 'Sharma', 'Mrs', 'Female', '1996-03-12'],
    ['Vikram', 'Patil', 'Mr', 'Male', '1990-01-22'],
    ['Sneha', 'Patil', 'Mrs', 'Female', '1992-07-08'],
  ];
  return base.slice(0, n).map(([firstName, lastName, title, gender, dob], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: { title, firstName, lastName, gender, dob, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
}

function family2adt1chd() {
  return [
    ...adultProfiles(2),
    {
      paxId: 'PAX3',
      type: 'child',
      isLead: false,
      profile: {
        title: 'Miss', firstName: 'Ananya', lastName: 'Sharma',
        gender: 'Female', dob: '2017-11-20', nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
  ];
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 4) {
      console.log('  leave Inprogress');
      return st;
    }
    await sleep(3500);
  }
  return last?.data?.status;
}

function extractPnr(detail) {
  const it = detail?.bookingResponse?.itinerary || [];
  return it.map((l) => ({ direction: l.direction, pnr: l.pnr, stops: l.totalStops, segs: (l.segments || []).length }));
}

function fixGst(payload, pricingData) {
  payload.data.includeGst = false;
  payload.data.gstDetails = null;
  // Some fares still demand gst — set empty object only if pricing flags it
  if (pricingData?.addGstInfo === true || pricingData?.pricing?.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.gstDetails = {
      gstNumber: '27AABCU9603R1ZM',
      companyName: 'TravelVIP QA',
      email: config.flight.contactEmail,
      phone: config.flight.contactMobile,
    };
  }
  return payload;
}

async function searchOw(flight, { origin, destination, days, adults, children = 0, maxStops = 0, airlines = [], wantConnecting = false }) {
  const body = buildOneWaySearchBody(days, {
    origin, destination, fareType: 'NORMAL', maxStops: wantConnecting ? null : maxStops,
  });
  body.travellers = { adults, children, infants: 0 };
  body.preferences = {
    airlines: airlines || [],
    maxStops: wantConnecting ? null : maxStops,
    refundableOnly: false,
  };

  let sid = null;
  let data = null;
  for (let i = 0; i < 14; i += 1) {
    const s = await flight.search(body);
    data = s.data;
    const analysis = analyzeFlightOptions(data, 'ONWARD');
    if (wantConnecting) {
      const c = analysis.connecting.find((x) => x.totalStops === 1 || x.segmentCount === 2) || analysis.connecting[0];
      sid = c?.searchId || null;
    } else {
      const d = analysis.nonStop.find((x) => x.totalStops === 0 || x.segmentCount === 1) || analysis.nonStop[0];
      sid = d?.searchId || extractFirstSearchId(data);
    }
    if (sid) break;
    if (isSearchProgressComplete(data)) break;
    await sleep(data?.progress?.pollAfterMs || 3000);
  }
  return { sid, data };
}

async function bookOw(flight, client, job) {
  console.log(`\n=== ${job.id}: OW ${job.origin}->${job.destination} pax=${job.adults}A/${job.children || 0}C stops=${job.wantConnecting ? 'layover' : '0'} ===`);
  for (const days of job.daysList || [job.days]) {
    for (const airlines of job.airlineSets || [[]]) {
      console.log(`  try +${days}d airlines=${airlines.join(',') || 'any'}`);
      const { sid, data } = await searchOw(flight, { ...job, days, airlines });
      if (!sid) {
        console.log('  no searchId');
        continue;
      }
      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [sid],
        journeyType: 'ONE_WAY',
      });
      payload.data.passengers = job.children ? family2adt1chd() : adultProfiles(job.adults);
      fixGst(payload, pricing.data);

      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        console.log('  issue fail', brief(issue.data));
        continue;
      }
      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const legs = extractPnr(detail.data);
      const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
      const row = {
        id: job.id,
        label: job.label,
        journeyType: 'ONE_WAY',
        route: `${job.origin}-${job.destination}`,
        adults: job.adults,
        children: job.children || 0,
        connecting: Boolean(job.wantConnecting),
        br,
        status: detail.data?.status || status,
        legs,
        pax,
        usable: /confirm/i.test(String(detail.data?.status || status)) && legs.some((l) => l.pnr && l.pnr !== 'FVRVRV'),
      };
      console.log('  ->', row.br, row.status, row.legs.map((l) => l.pnr).join('|'), 'usable=', row.usable);
      if (row.usable) return row;
      if (/inprogress/i.test(String(row.status))) console.log('  leave and try next');
    }
  }
  return { id: job.id, label: job.label, error: 'no confirmed booking', usable: false };
}

async function bookRt(flight, client, job) {
  console.log(`\n=== ${job.id}: RT ${job.origin}<->${job.destination} adults=${job.adults} ===`);
  for (const [od, rd] of job.dayPairs || [[job.onwardDays, job.returnDays]]) {
    for (const airlines of job.airlineSets || [[]]) {
      console.log(`  try ${od}/${rd} airlines=${airlines.join(',') || 'any'}`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin: job.origin, destination: job.destination, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults: job.adults, children: 0, infants: 0 };
      if (airlines.length) body.preferences.airlines = airlines;

      let search;
      try {
        search = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('  search fail', e.message);
        continue;
      }
      if (!search.searchIds || search.searchIds.length < 2) {
        console.log('  no RT pair');
        continue;
      }
      const pricing = await flight.getPricing(search.searchIds, 'ROUND_TRIP');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: search.searchIds,
        journeyType: 'ROUND_TRIP',
      });
      payload.data.passengers = adultProfiles(job.adults);
      fixGst(payload, pricing.data);

      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        console.log('  issue fail', brief(issue.data));
        continue;
      }
      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const legs = extractPnr(detail.data);
      const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => p.paxId);
      const row = {
        id: job.id,
        label: job.label,
        journeyType: 'ROUND_TRIP',
        route: `${job.origin}-${job.destination}-${job.origin}`,
        adults: job.adults,
        children: 0,
        br,
        status: detail.data?.status || status,
        legs,
        pax,
        onwardPnr: legs.find((l) => /onward/i.test(l.direction))?.pnr || legs[0]?.pnr,
        returnPnr: legs.find((l) => /return/i.test(l.direction))?.pnr || legs[1]?.pnr,
        usable: /confirm/i.test(String(detail.data?.status || status))
          && legs.filter((l) => l.pnr && l.pnr !== 'FVRVRV').length >= 1,
      };
      console.log('  ->', row.br, row.status, row.legs.map((l) => `${l.direction}:${l.pnr}`).join(' | '), 'usable=', row.usable);
      if (row.usable) return row;
    }
  }
  return { id: job.id, label: job.label, error: 'no confirmed RT', usable: false };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl, 'BOOK ONLY — no cancel');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const jobs = [
    {
      id: 'F1', label: 'OW 1ADT direct', type: 'OW',
      origin: 'DEL', destination: 'BOM', adults: 1,
      daysList: [55, 62, 70], airlineSets: [['IX'], ['SG'], []],
    },
    {
      id: 'F2', label: 'OW 2ADT direct', type: 'OW',
      origin: 'BLR', destination: 'DEL', adults: 2,
      daysList: [58, 65], airlineSets: [['IX'], ['SG'], []],
    },
    {
      id: 'F3', label: 'OW 2ADT+1CHD direct', type: 'OW',
      origin: 'DEL', destination: 'BOM', adults: 2, children: 1,
      daysList: [72, 78], airlineSets: [['IX'], ['SG']],
    },
    {
      id: 'F5', label: 'OW 1ADT layover', type: 'OW', wantConnecting: true,
      origin: 'DEL', destination: 'GOI', adults: 1,
      daysList: [60, 68], airlineSets: [[], ['IX']],
    },
    {
      id: 'F6', label: 'OW 2ADT layover', type: 'OW', wantConnecting: true,
      origin: 'BOM', destination: 'CCU', adults: 2,
      daysList: [64, 71], airlineSets: [[], ['IX', 'SG']],
    },
    {
      id: 'F7', label: 'RT 1ADT', type: 'RT',
      origin: 'DEL', destination: 'BOM', adults: 1,
      dayPairs: [[80, 87], [85, 92]], airlineSets: [['IX'], ['SG'], []],
    },
    {
      id: 'F8', label: 'RT 2ADT', type: 'RT',
      origin: 'BLR', destination: 'DEL', adults: 2,
      dayPairs: [[82, 89], [88, 95]], airlineSets: [['IX'], []],
    },
  ];

  const fixtures = {};
  for (const job of jobs) {
    try {
      fixtures[job.id] = job.type === 'RT'
        ? await bookRt(flight, client, job)
        : await bookOw(flight, client, job);
    } catch (e) {
      fixtures[job.id] = { id: job.id, label: job.label, error: e.message, usable: false };
      console.log('FAIL', job.id, e.message);
    }
  }

  const usable = Object.values(fixtures).filter((f) => f.usable);
  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    note: 'Book-only paxwise fixtures on staging. No cancels.',
    fixtures,
    usable: usable.map((f) => ({
      id: f.id, label: f.label, br: f.br, status: f.status,
      journeyType: f.journeyType, route: f.route, adults: f.adults, children: f.children,
      onwardPnr: f.onwardPnr, returnPnr: f.returnPnr, legs: f.legs, pax: f.pax,
    })),
    score: {
      booked: usable.length,
      failed: Object.values(fixtures).filter((f) => !f.usable).length,
      total: jobs.length,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nUSABLE', report.usable);
  console.log('SCORE', report.score);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

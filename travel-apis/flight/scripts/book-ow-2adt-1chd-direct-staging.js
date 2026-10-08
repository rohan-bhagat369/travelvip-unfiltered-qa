/**
 * Book ONE_WAY, 2ADT + 1CHD, direct (1 journey, 1 segment).
 * Leaves Inprogress alone; rotates route / date / airline / passenger names until Confirmed.
 *
 * Run: node scripts/book-ow-2adt-1chd-direct-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  analyzeFlightOptions,
  buildOneWaySearchBody,
  isTerminalBookingStatus,
  pollUntil,
  extractFirstSearchId,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-ow-2adt-1chd-direct-staging.json');

const ATTEMPTS = [
  { origin: 'DEL', destination: 'BOM', days: 72, airlines: ['IX'], paxSet: 0 },
  { origin: 'DEL', destination: 'BOM', days: 75, airlines: ['SG'], paxSet: 1 },
  { origin: 'BLR', destination: 'DEL', days: 70, airlines: ['IX'], paxSet: 2 },
  { origin: 'BOM', destination: 'HYD', days: 68, airlines: ['SG'], paxSet: 0 },
  { origin: 'DEL', destination: 'BLR', days: 78, airlines: ['IX'], paxSet: 1 },
  { origin: 'HYD', destination: 'BOM', days: 73, airlines: ['6E'], paxSet: 2 },
  { origin: 'MAA', destination: 'BOM', days: 71, airlines: ['IX', 'SG'], paxSet: 0 },
  { origin: 'DEL', destination: 'HYD', days: 80, airlines: ['AI'], paxSet: 1 },
  { origin: 'BOM', destination: 'BLR', days: 77, airlines: ['SG'], paxSet: 2 },
  { origin: 'CCU', destination: 'DEL', days: 74, airlines: ['6E', 'SG'], paxSet: 0 },
  { origin: 'DEL', destination: 'PNQ', days: 69, airlines: ['IX'], paxSet: 1 },
  { origin: 'AMD', destination: 'DEL', days: 76, airlines: ['SG', 'IX'], paxSet: 2 },
];

const PAX_SETS = [
  [
    { title: 'Mr', firstName: 'Amit', lastName: 'Sharma', gender: 'Male', dob: '1995-08-15' },
    { title: 'Mrs', firstName: 'Neha', lastName: 'Sharma', gender: 'Female', dob: '1996-03-12' },
    { title: 'Miss', firstName: 'Ananya', lastName: 'Sharma', gender: 'Female', dob: '2017-11-20' },
  ],
  [
    { title: 'Mr', firstName: 'Vikram', lastName: 'Patil', gender: 'Male', dob: '1990-01-22' },
    { title: 'Mrs', firstName: 'Sneha', lastName: 'Patil', gender: 'Female', dob: '1992-07-08' },
    { title: 'Mstr', firstName: 'Arjun', lastName: 'Patil', gender: 'Male', dob: '2016-05-14' },
  ],
  [
    { title: 'Mr', firstName: 'Rahul', lastName: 'Verma', gender: 'Male', dob: '1988-12-03' },
    { title: 'Mrs', firstName: 'Kavita', lastName: 'Verma', gender: 'Female', dob: '1991-09-25' },
    { title: 'Miss', firstName: 'Isha', lastName: 'Verma', gender: 'Female', dob: '2019-02-18' },
  ],
];

function emptySsr() {
  return { baggage: [], meals: [], seats: [] };
}

function buildPassengers(paxSetIdx = 0) {
  const profiles = PAX_SETS[paxSetIdx % PAX_SETS.length];
  const types = ['adult', 'adult', 'child'];
  return profiles.map((profile, i) => ({
    paxId: `PAX${i + 1}`,
    type: types[i],
    isLead: i === 0,
    profile: { ...profile, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: emptySsr(),
  }));
}

function pickDirectIds(searchData, preferAirlines = [], limit = 2) {
  const prefer = preferAirlines.map((a) => String(a).toUpperCase());
  const { nonStop } = analyzeFlightOptions(searchData, 'ONWARD');
  const ranked = [...nonStop]
    .filter((c) => (c.totalStops ?? 0) === 0 || (c.segmentCount ?? 0) === 1)
    .sort((a, b) => {
      const aCode = String(a.legs?.[0]?.flight || '').split(/\s+/)[0].toUpperCase();
      const bCode = String(b.legs?.[0]?.flight || '').split(/\s+/)[0].toUpperCase();
      const aRank = prefer.includes(aCode) ? prefer.indexOf(aCode) : 99;
      const bRank = prefer.includes(bCode) ? prefer.indexOf(bCode) : 99;
      return aRank - bRank;
    });
  return ranked.slice(0, limit).map((c) => c.searchId);
}

function optionMeta(searchData, searchId) {
  for (const block of searchData?.results || []) {
    for (const opt of block?.options || []) {
      if (opt.searchId !== searchId) continue;
      return {
        totalStops: opt.totalStops ?? 0,
        segmentCount: opt.segments?.length ?? 0,
        flights: (opt.segments || []).map((s) => ({
          flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
          route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
          dep: s.departure?.time || s.departure?.dateTime,
          arr: s.arrival?.time || s.arrival?.dateTime,
        })),
      };
    }
  }
  return null;
}

async function searchDirect(flight, body) {
  return pollUntil(
    () => flight.search(body),
    (res) => {
      if (!res.ok) return false;
      const hasId = Boolean(extractFirstSearchId(res.data));
      const complete = String(res.data?.progress?.state || '').toUpperCase() === 'COMPLETE';
      const hasDirect = analyzeFlightOptions(res.data, 'ONWARD').nonStopCount > 0;
      return hasId && (complete || hasDirect);
    },
    { maxAttempts: 20, intervalMs: 4000, label: 'OW direct multipax search' },
  );
}

/** Poll briefly; leave Inprogress alone quickly. */
async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 8; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 3) {
      console.log('  leave Inprogress — try next variant');
      return st;
    }
    await sleep(3500);
  }
  return last?.data?.status;
}

function summarizeBooking(br, status, route, meta, price, detail, issueHttp, paxSet) {
  const brResp = detail?.data?.bookingResponse || {};
  const itinerary = brResp.itinerary || [];
  const segs = itinerary.flatMap((leg) => leg.segments || []);
  const paxList = brResp.passengers || [];
  return {
    bookingReference: br,
    bookingStatus: status,
    pnr: itinerary.find((x) => x.pnr)?.pnr || null,
    route: `${route.origin} → ${route.destination}`,
    journeyType: 'ONE_WAY',
    travellers: { adults: 2, children: 1, infants: 0 },
    paxSet,
    passengersIssued: buildPassengers(paxSet).map((p) => ({
      paxId: p.paxId,
      type: p.type,
      title: p.profile.title,
      name: `${p.profile.firstName} ${p.profile.lastName}`,
    })),
    direct: true,
    totalStops: meta?.totalStops,
    journeyCount: itinerary.length,
    segmentCount: segs.length,
    passengerCount: paxList.length,
    expectedCells: itinerary.length * Math.max(paxList.length, 3),
    expectedDb: {
      flight_journey: 1,
      flight_segment_note: '1 segment on that journey',
      flight_journey_passenger_cells: 3,
      booking_passenger: 3,
      booking_item_passenger: 3,
    },
    passengers: paxList.map((px) => ({
      paxId: px.paxId,
      type: px.paxType || px.type,
      title: px.profile?.title,
      name: `${px.profile?.firstName || ''} ${px.profile?.lastName || ''}`.trim(),
    })),
    flights: meta?.flights,
    detailSegments: segs.map((s) => ({
      seq: s.segmentNumber || s.segmentId,
      flight: `${s.airline?.code || s.airlineCode || ''} ${s.flightNumber || ''}`.trim(),
      route: `${s.departure?.airportCode || s.origin}→${s.arrival?.airportCode || s.destination}`,
    })),
    price,
    salesSummary: brResp.salesSummary || null,
    issueHttp,
  };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: OW | 2ADT+1CHD | direct | book all 3 | Confirmed');
  console.log('Policy: leave Inprogress; rotate date/airline/route/pax names');

  const session = await authenticate(true);
  if (typeof session.client.setPartnerKey === 'function') {
    session.client.setPartnerKey(session.accessToken);
  }
  const flight = new FlightService(session.client);
  const client = session.client;

  const attempts = [];
  let booked = null;
  const leftInprogress = [];

  for (const route of ATTEMPTS) {
    if (booked && /confirm/i.test(String(booked.bookingStatus))) break;

    const body = buildOneWaySearchBody(route.days, {
      origin: route.origin,
      destination: route.destination,
      fareType: 'NORMAL',
      maxStops: 0,
    });
    body.travellers = { adults: 2, children: 1, infants: 0 };
    body.preferences = {
      airlines: route.airlines || [],
      maxStops: 0,
      refundableOnly: false,
    };

    console.log(
      `\n=== ${route.origin}→${route.destination} +${route.days}d airlines=${(route.airlines || []).join(',')} paxSet=${route.paxSet} ===`,
    );

    let searchRes;
    try {
      searchRes = await searchDirect(flight, body);
    } catch (e) {
      console.log('  search fail:', e.message);
      attempts.push({ ...route, ok: false, error: e.message });
      continue;
    }

    const analysis = analyzeFlightOptions(searchRes.data, 'ONWARD');
    console.log(`  options=${analysis.total} nonStop=${analysis.nonStopCount}`);

    const candidates = pickDirectIds(searchRes.data, route.airlines || [], 2);
    if (!candidates.length) {
      console.log('  no direct option');
      attempts.push({ ...route, ok: false, error: 'no direct' });
      continue;
    }

    for (const searchId of candidates) {
      const meta = optionMeta(searchRes.data, searchId);
      console.log('  try:', JSON.stringify(meta));
      if ((meta?.segmentCount || 0) > 1 || (meta?.totalStops || 0) > 0) continue;

      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
        console.log('  pricing fail:', JSON.stringify(pricing.data)?.slice(0, 220));
        attempts.push({ ...route, ok: false, error: 'pricing', meta });
        continue;
      }

      const p = pricing.data.pricing || pricing.data;
      const price = {
        priceId: pricing.data.priceId,
        baseFare: p.baseFare ?? pricing.data.baseFare,
        taxes: p.taxes ?? pricing.data.taxes,
        convenienceFee: p.convenienceFee ?? pricing.data.convenienceFee,
        totalAmount: p.totalAmount ?? pricing.data.totalAmount,
        currency: p.currency || pricing.data.currency || 'INR',
      };
      console.log('  pricing:', JSON.stringify(price));

      const passengers = buildPassengers(route.paxSet);
      const issueBody = {
        type: 'ticket',
        currency: 'INR',
        language: 'en',
        bookingReference: pricing.data.bookingContext,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
        timezone: 'Asia/Calcutta',
        data: {
          priceId: pricing.data.priceId,
          passportType: 'NONE',
          includeGst: false,
          gstDetails: null,
          contact: {
            email: config.flight.contactEmail,
            mobile: config.flight.contactMobile,
            countryCode: config.flight.contactCountryCode,
          },
          passengers,
        },
      };

      console.log(
        '  issuing',
        passengers.map((x) => `${x.paxId}:${x.profile.firstName}`).join(', '),
      );
      const issue = await client.request({
        method: 'POST',
        path: '/v1/flights/booking/issue-ticket',
        query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
        body: issueBody,
        correlation: true,
      });

      if (!issue.ok) {
        console.log('  issue fail:', JSON.stringify(issue.data)?.slice(0, 350));
        attempts.push({ ...route, ok: false, error: 'issue', meta, issue: issue.data });
        continue;
      }

      const br = issue.data.bookingReference || issue.data.bookingReferenceId || issue.data.bookingRefId;
      console.log('  bookingReference:', br, 'issueStatus:', issue.data.status);

      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const row = summarizeBooking(br, status, route, meta, price, detail, issue.status, route.paxSet);

      attempts.push({ ...route, ok: true, searchId, meta, br, status });

      if (/confirm/i.test(String(status))) {
        booked = row;
        console.log('  CONFIRMED — stop');
        break;
      }

      if (/inprogress/i.test(String(status))) {
        leftInprogress.push(br);
        console.log('  left Inprogress:', br);
      } else {
        console.log('  non-confirmed:', status, '— try next');
      }
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    goal: 'OW 2ADT+1CHD direct — 1 journey, 1 segment, 3 cells',
    booked,
    leftInprogress,
    priorInprogressNote: 'BR1786460841983264 left alone from earlier run',
    attempts,
    verifySqlHint: [
      "SELECT COUNT(*) FROM booking_passenger WHERE booking_id=(SELECT id FROM booking WHERE booking_reference='BR…'); -- 3",
      'SELECT COUNT(*) FROM flight_journey WHERE booking_id=…; -- 1',
      'SELECT COUNT(*) FROM flight_journey_passenger fjp JOIN flight_journey fj ON fj.id=fjp.flight_journey_id WHERE fj.booking_id=…; -- 3 cells',
      'SELECT COUNT(*) FROM booking_item_passenger WHERE …; -- 3',
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== BOOKING RESULT ===');
  console.log(JSON.stringify(booked || { error: 'No Confirmed booking', leftInprogress, attempts: attempts.length }, null, 2));
  console.log('Left Inprogress:', leftInprogress);
  console.log('Report:', OUT);

  if (!booked || !/confirm/i.test(String(booked.bookingStatus))) process.exit(1);
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});

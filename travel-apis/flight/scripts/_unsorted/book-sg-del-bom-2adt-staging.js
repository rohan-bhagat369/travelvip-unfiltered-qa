/**
 * Book DEL→BOM on SG (SpiceJet), 2 adults.
 * Prefer CORPORATE; fallback NORMAL. Days ~20–21.
 * If status Inprogress → leave BR, rebook with different passenger names.
 *
 *   node scripts/book-sg-del-bom-2adt-staging.js
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
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/book-sg-del-bom-2adt-staging.json';
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const PAX_NAME_SETS = [
  [
    ['Vikram', 'Patil', 'Mr', 'Male', '1990-01-22'],
    ['Suresh', 'Kulkarni', 'Mr', 'Male', '1988-04-11'],
  ],
  [
    ['Nikhil', 'Desai', 'Mr', 'Male', '1993-07-19'],
    ['Rahul', 'Joshi', 'Mr', 'Male', '1992-11-03'],
  ],
  [
    ['Arjun', 'Mehta', 'Mr', 'Male', '1994-02-28'],
    ['Karan', 'Nair', 'Mr', 'Male', '1991-09-14'],
  ],
  [
    ['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'],
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
  ],
];

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function adultProfiles(n, nameSetIndex = 0) {
  const base = PAX_NAME_SETS[nameSetIndex % PAX_NAME_SETS.length];
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

function isSgOption(opt) {
  const legs = opt.legs || [];
  if (!legs.length) return true; // unknown — allow
  return legs.every((l) => String(l.flight || '').startsWith('SG '));
}

function pickOption(analysis, { preferConnecting = true } = {}) {
  const pool = preferConnecting
    ? [...analysis.connecting, ...analysis.nonStop]
    : [...analysis.nonStop, ...analysis.connecting];
  const sg = pool.filter(isSgOption);
  return (sg[0] || pool[0]) || null;
}

async function pollOw(flight, body) {
  let last = null;
  for (let i = 0; i < 14; i += 1) {
    last = await flight.search(body);
    const analysis = analyzeFlightOptions(last.data, 'ONWARD');
    console.log(`  poll ${i + 1} state=${last.data?.progress?.state} ns=${analysis.nonStopCount} cx=${analysis.connectingCount}`);
    const opt = pickOption(analysis, { preferConnecting: true });
    if (opt?.searchId) return { data: last.data, analysis, opt };
    if (isSearchProgressComplete(last.data)) break;
    await sleep(last.data?.progress?.pollAfterMs || 3000);
  }
  const analysis = analyzeFlightOptions(last?.data, 'ONWARD');
  return { data: last?.data, analysis, opt: pickOption(analysis) || { searchId: extractFirstSearchId(last?.data) } };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  const origin = 'DEL';
  const destination = 'BOM';
  const mode = (process.env.MODE || 'RT').toUpperCase(); // RT | OW
  const fareTypes = (process.env.FARE_TYPES || 'CORPORATE,NORMAL').split(',').map((s) => s.trim());
  const daysOw = (process.env.DAYS || '20,21,22,23').split(',').map(Number).filter(Boolean);
  const dayPairs = (process.env.DAY_PAIRS || '20:21,20:27,21:28')
    .split(',')
    .map((p) => p.trim().split(':').map(Number))
    .filter((p) => p.length === 2);

  console.log('Base', config.baseUrl, 'partner', config.partnerId);
  console.log(`Book ${mode} SG ${origin}<->${destination} 2ADT fareTypes=${fareTypes.join(',')}`);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const attempts = [];
  let booked = null;
  let nameSetIndex = 0;

  async function issueAndConfirm({ searchIds, journeyType, pricing, label }) {
    const addGst = pricing.data?.addGstInfo === true || pricing.data?.pricing?.addGstInfo === true;
    const passengers = adultProfiles(2, nameSetIndex);
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType,
    });
    payload.data.passengers = passengers;
    if (addGst) {
      payload.data.includeGst = true;
      payload.data.gstDetails = { ...VALID_GST };
    }

    const issue = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
    console.log('  issue', issue.status, br || brief(issue.data));
    if (!br) {
      attempts.push({ label, step: 'issue', error: brief(issue.data), nameSetIndex });
      return null;
    }

    let status;
    for (let i = 0; i < 5; i += 1) {
      const st = await flight.getBookingStatus(br);
      status = String(st.data?.status || '');
      console.log('  status', i + 1, status);
      if (isTerminalBookingStatus(status)) break;
      if (/inprogress/i.test(status) && i >= 2) break;
      await sleep(3000);
    }

    const detail = await flight.getBookingDetail(br);
    status = detail.data?.status || status;
    const itinerary = detail.data?.bookingResponse?.itinerary || [];
    const legs = itinerary.map((l) => ({
      direction: l.direction,
      pnr: l.pnr,
      stops: l.totalStops,
      segs: (l.segments || []).length,
      airlines: [...new Set((l.segments || []).map((s) => s.airline?.code || s.airlineCode).filter(Boolean))],
      routes: (l.segments || []).map((s) => `${s.departure?.airportCode}→${s.arrival?.airportCode}`),
    }));

    const row = {
      label,
      airlineFilter: 'SG',
      journeyType,
      adults: 2,
      br,
      status,
      route: `${origin}-${destination}`,
      searchIds,
      priceId: pricing.data.priceId,
      totalAmount: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
      addGstInfo: addGst,
      passengerNames: passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
      nameSetIndex,
      legs,
      pnrs: legs.map((l) => l.pnr).filter(Boolean),
    };

    attempts.push({
      label, br, status, nameSetIndex, names: row.passengerNames,
      step: /confirm/i.test(status) ? 'confirmed' : (/inprogress/i.test(status) ? 'inprogress' : 'other'),
    });

    if (/confirm/i.test(String(status))) return row;

    if (/inprogress/i.test(String(status))) {
      console.log('  Inprogress — leave BR, rotate passenger names');
      nameSetIndex += 1;
    } else {
      nameSetIndex += 1;
    }
    return null;
  }

  // --- RT attempts ---
  if (mode === 'RT' || mode === 'BOTH') {
    for (const fareType of fareTypes) {
      for (const [od, rd] of dayPairs) {
        if (booked) break;
        const label = `RT ${fareType} +${od}/+${rd} SG`;
        console.log(`\n=== ${label} nameset=${nameSetIndex} ===`);
        const body = buildRoundTripSearchBody(od, rd, {
          origin, destination, fareType, maxStops: null,
        });
        body.travellers = { adults: 2, children: 0, infants: 0 };
        body.preferences.airlines = ['SG'];
        body.preferences.maxStops = null;

        // onward
        let onwardOpt = null;
        let data = null;
        for (let i = 0; i < 14; i += 1) {
          const s = await flight.search(body);
          data = s.data;
          const onward = analyzeFlightOptions(data, 'ONWARD');
          console.log(`  onward poll ${i + 1} state=${data?.progress?.state} ns=${onward.nonStopCount} cx=${onward.connectingCount}`);
          onwardOpt = pickOption(onward, { preferConnecting: true });
          if (onwardOpt?.searchId) break;
          if (isSearchProgressComplete(data)) break;
          await sleep(data?.progress?.pollAfterMs || 3000);
        }
        if (!onwardOpt?.searchId) {
          console.log('  no SG onward');
          attempts.push({ label, step: 'onward', error: 'no option' });
          continue;
        }
        console.log('  onward', onwardOpt.searchId, onwardOpt.legs);

        const refined = { ...body, selection: { selectedSearchIds: [onwardOpt.searchId] } };
        let returnOpt = null;
        for (let i = 0; i < 14; i += 1) {
          const s = await flight.search(refined);
          const ret = analyzeFlightOptions(s.data, 'RETURN');
          console.log(`  return poll ${i + 1} state=${s.data?.progress?.state} ns=${ret.nonStopCount} cx=${ret.connectingCount}`);
          returnOpt = pickOption(ret, { preferConnecting: true });
          if (returnOpt?.searchId) break;
          if (isSearchProgressComplete(s.data)) break;
          await sleep(s.data?.progress?.pollAfterMs || 3000);
        }
        if (!returnOpt?.searchId) {
          console.log('  no SG return');
          attempts.push({ label, step: 'return', error: 'no option' });
          continue;
        }
        console.log('  return', returnOpt.searchId, returnOpt.legs);

        const searchIds = [onwardOpt.searchId, returnOpt.searchId];
        const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
        console.log('  pricing', pricing.status, pricing.data?.priceId, pricing.data?.pricing?.totalAmount);
        if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
          attempts.push({ label, step: 'pricing', error: brief(pricing.data) });
          continue;
        }
        booked = await issueAndConfirm({
          searchIds, journeyType: 'ROUND_TRIP', pricing, label,
        });
      }
    }
  }

  // --- OW fallback / primary ---
  if (!booked && (mode === 'OW' || mode === 'BOTH' || mode === 'RT')) {
    for (const fareType of fareTypes) {
      for (const days of daysOw) {
        if (booked) break;
        const label = `OW ${fareType} +${days}d SG`;
        console.log(`\n=== ${label} nameset=${nameSetIndex} ===`);
        const body = buildOneWaySearchBody(days, {
          origin, destination, fareType, maxStops: null,
        });
        body.travellers = { adults: 2, children: 0, infants: 0 };
        body.preferences.airlines = ['SG'];
        body.preferences.maxStops = null;

        const { opt } = await pollOw(flight, body);
        if (!opt?.searchId) {
          console.log('  no SG OW option');
          attempts.push({ label, step: 'search', error: 'no option' });
          continue;
        }
        console.log('  option', opt.searchId, opt.legs);

        const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
        console.log('  pricing', pricing.status, pricing.data?.priceId, pricing.data?.pricing?.totalAmount);
        if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
          attempts.push({ label, step: 'pricing', error: brief(pricing.data) });
          continue;
        }
        booked = await issueAndConfirm({
          searchIds: [opt.searchId], journeyType: 'ONE_WAY', pricing, label,
        });
      }
    }
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partner: config.partnerId,
    airline: 'SG',
    route: 'DEL-BOM',
    attempts,
    booking: booked,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(booked || { error: 'no confirmed SG booking' }, null, 2));
  console.log('Wrote', OUT);
  if (!booked) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

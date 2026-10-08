/**
 * Book CORPORATE RT connecting, 2 adults on staging (no cancel).
 *   node scripts/book-corporate-rt-connecting-2adt-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-corporate-rt-connecting-2adt-staging.json';
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function pickConnecting(analysis) {
  return analysis.connecting.find((x) => x.totalStops >= 1 || x.segmentCount >= 2)
    || analysis.connecting[0]
    || null;
}

/** Rotate names when prior attempt stuck Inprogress (workspace rule). */
const PAX_NAME_SETS = [
  [
    ['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'],
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
  ],
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
];

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

async function pollSearch(flight, body, { needOnwardConnecting = true } = {}) {
  let last = null;
  for (let i = 0; i < 20; i += 1) {
    last = await flight.search(body);
    const data = last.data;
    const onward = analyzeFlightOptions(data, 'ONWARD');
    const ret = analyzeFlightOptions(data, 'RETURN');
    console.log(
      `  poll ${i + 1} state=${data?.progress?.state} onward(ns=${onward.nonStopCount},cx=${onward.connectingCount}) return(ns=${ret.nonStopCount},cx=${ret.connectingCount})`,
    );
    if (needOnwardConnecting && pickConnecting(onward)) return { response: last, onward, ret };
    if (!needOnwardConnecting && (onward.total || ret.total) && isSearchProgressComplete(data)) {
      return { response: last, onward, ret };
    }
    if (isSearchProgressComplete(data) && needOnwardConnecting && !pickConnecting(onward)) {
      return { response: last, onward, ret }; // exhausted
    }
    await sleep(data?.progress?.pollAfterMs || 3500);
  }
  return { response: last, onward: analyzeFlightOptions(last?.data, 'ONWARD'), ret: analyzeFlightOptions(last?.data, 'RETURN') };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  const origin = process.env.ORIGIN || 'DEL';
  const destination = process.env.DEST || 'BOM';
  const dayPairs = (process.env.DAY_PAIRS || '40:47,45:52,50:57,55:62,60:67')
    .split(',')
    .map((p) => p.trim().split(':').map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));

  console.log('Base', config.baseUrl, 'partner', config.partnerId);
  console.log(`Book CORPORATE RT CONNECTING 2ADT ${origin}<->${destination}`);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const attempts = [];
  let booked = null;
  let nameSetIndex = 0;

  for (const [od, rd] of dayPairs) {
    console.log(`\n=== try CORPORATE RT +${od}/+${rd}d nameset=${nameSetIndex} ===`);
    const body = buildRoundTripSearchBody(od, rd, {
      origin, destination, fareType: 'CORPORATE', maxStops: null,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences.maxStops = null;

    // Step A: find connecting onward
    const first = await pollSearch(flight, body, { needOnwardConnecting: true });
    const onwardOpt = pickConnecting(first.onward);
    if (!onwardOpt?.searchId) {
      console.log('  no connecting onward');
      attempts.push({ od, rd, step: 'onward', error: 'no connecting onward', counts: {
        onwardCx: first.onward.connectingCount, onwardNs: first.onward.nonStopCount,
      } });
      continue;
    }
    console.log('  onward connecting', onwardOpt.searchId, `stops=${onwardOpt.totalStops} segs=${onwardOpt.segmentCount}`, onwardOpt.legs);

    // Step B: select onward → get return options; prefer connecting return
    const refined = {
      ...body,
      selection: { selectedSearchIds: [onwardOpt.searchId] },
    };
    let returnOpt = null;
    let returnData = null;
    for (let i = 0; i < 16; i += 1) {
      const r = await flight.search(refined);
      returnData = r.data;
      const ret = analyzeFlightOptions(returnData, 'RETURN');
      console.log(`  return poll ${i + 1} state=${returnData?.progress?.state} ns=${ret.nonStopCount} cx=${ret.connectingCount}`);
      returnOpt = pickConnecting(ret) || ret.nonStop[0] || ret.connecting[0] || null;
      // Prefer connecting; if complete and only non-stop, take non-stop but flag
      if (pickConnecting(ret)) {
        returnOpt = pickConnecting(ret);
        break;
      }
      if (isSearchProgressComplete(returnData) && returnOpt) break;
      await sleep(returnData?.progress?.pollAfterMs || 3500);
    }

    if (!returnOpt?.searchId) {
      console.log('  no return option');
      attempts.push({ od, rd, step: 'return', error: 'no return', onward: onwardOpt.searchId });
      continue;
    }
    const returnConnecting = (returnOpt.totalStops >= 1 || returnOpt.segmentCount >= 2);
    console.log(
      '  return', returnOpt.searchId,
      returnConnecting ? 'CONNECTING' : 'non-stop-fallback',
      `stops=${returnOpt.totalStops} segs=${returnOpt.segmentCount}`,
      returnOpt.legs,
    );

    // Require at least onward connecting (user asked RT connecting)
    if (!returnConnecting) {
      console.log('  note: return is non-stop; onward is connecting — proceeding as RT connecting (onward layover)');
    }

    const searchIds = [onwardOpt.searchId, returnOpt.searchId];
    const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
    const addGst = pricing.data?.addGstInfo === true || pricing.data?.pricing?.addGstInfo === true;
    console.log(
      '  pricing', pricing.status,
      'priceId', pricing.data?.priceId,
      'total', pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
      'addGst', addGst,
    );
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
      attempts.push({ od, rd, step: 'pricing', error: brief(pricing.data) });
      continue;
    }

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: 'ROUND_TRIP',
    });
    const passengers = adultProfiles(2, nameSetIndex);
    payload.data.passengers = passengers;
    if (addGst) {
      payload.data.includeGst = true;
      payload.data.gstDetails = { ...VALID_GST };
    } else {
      payload.data.includeGst = false;
      payload.data.gstDetails = null;
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
      attempts.push({ od, rd, step: 'issue', error: brief(issue.data), nameSetIndex });
      continue;
    }

    // Short poll only — if Inprogress, leave it and rebook with different names
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
      routes: (l.segments || []).map((s) => `${s.departure?.airportCode || s.origin}→${s.arrival?.airportCode || s.destination}`),
    }));
    const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => ({
      paxId: p.paxId,
      name: `${p.profile?.firstName || p.firstName || ''} ${p.profile?.lastName || p.lastName || ''}`.trim(),
    }));

    const row = {
      fareType: 'CORPORATE',
      journeyType: 'ROUND_TRIP',
      adults: 2,
      br,
      status,
      route: `${origin}-${destination}-${origin}`,
      days: { onward: od, return: rd },
      dates: {
        onward: body.itinerary[0].date,
        return: body.itinerary[1].date,
      },
      searchIds,
      priceId: pricing.data.priceId,
      totalAmount: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
      addGstInfo: addGst,
      onwardConnecting: true,
      returnConnecting,
      legs,
      pax,
      passengerNames: passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
      nameSetIndex,
      pnrs: legs.map((l) => l.pnr).filter(Boolean),
    };

    attempts.push({
      od, rd, step: /confirm/i.test(status) ? 'confirmed' : 'inprogress_or_other',
      br, status, returnConnecting, nameSetIndex, names: row.passengerNames,
    });

    if (/confirm/i.test(String(status))) {
      booked = row;
      break;
    }

    if (/inprogress/i.test(String(status))) {
      console.log('  Inprogress — leave BR, rebook with different passenger names');
      nameSetIndex += 1;
      continue;
    }

    console.log('  not confirmed — try next date pair (also rotate names)');
    nameSetIndex += 1;
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partner: config.partnerId,
    attempts,
    booking: booked,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(booked || { error: 'no booking' }, null, 2));
  console.log('Wrote', OUT);
  if (!booked || !/confirm/i.test(String(booked.status || ''))) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

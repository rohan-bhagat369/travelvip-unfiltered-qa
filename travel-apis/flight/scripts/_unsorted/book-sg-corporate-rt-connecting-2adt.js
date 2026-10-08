/**
 * Book SG CORPORATE RT connecting, 2 adults.
 * Tries multiple routes + date pairs; on Inprogress → leave BR, rotate passenger names.
 *
 *   node scripts/book-sg-corporate-rt-connecting-2adt.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/book-sg-corporate-rt-connecting-2adt.json';
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const ROUTES = (process.env.ROUTES || 'DEL-BOM,BOM-DEL,BLR-DEL,DEL-BLR,BOM-HYD,HYD-BOM,DEL-GOI,BLR-BOM')
  .split(',')
  .map((r) => r.trim().split('-'))
  .filter((p) => p.length === 2);

const DAY_PAIRS = (process.env.DAY_PAIRS || '20:21,20:27,21:28,22:29,25:32,28:35,30:37')
  .split(',')
  .map((p) => p.trim().split(':').map(Number))
  .filter((p) => p.length === 2 && p.every(Number.isFinite));

const PAX_NAME_SETS = [
  [['Vikram', 'Patil', 'Mr', 'Male', '1990-01-22'], ['Suresh', 'Kulkarni', 'Mr', 'Male', '1988-04-11']],
  [['Nikhil', 'Desai', 'Mr', 'Male', '1993-07-19'], ['Rahul', 'Joshi', 'Mr', 'Male', '1992-11-03']],
  [['Arjun', 'Mehta', 'Mr', 'Male', '1994-02-28'], ['Karan', 'Nair', 'Mr', 'Male', '1991-09-14']],
  [['Deepak', 'Iyer', 'Mr', 'Male', '1989-06-08'], ['Manoj', 'Reddy', 'Mr', 'Male', '1992-12-01']],
  [['Sanjay', 'Gupta', 'Mr', 'Male', '1987-03-17'], ['Pavan', 'Shah', 'Mr', 'Male', '1996-08-25']],
  [['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'], ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15']],
];

function brief(d, n = 350) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function adultProfiles(nameSetIndex) {
  const base = PAX_NAME_SETS[nameSetIndex % PAX_NAME_SETS.length];
  return base.map(([firstName, lastName, title, gender, dob], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: { title, firstName, lastName, gender, dob, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
}

function isSg(opt) {
  const legs = opt?.legs || [];
  if (!legs.length) return false;
  return legs.every((l) => /^SG\s/i.test(String(l.flight || '')));
}

function pickConnectingSg(analysis) {
  const cx = (analysis.connecting || []).filter(isSg);
  const ns = (analysis.nonStop || []).filter(isSg);
  // Prefer connecting SG; if none, null (caller may relax)
  return cx.find((x) => x.totalStops >= 1 || x.segmentCount >= 2) || cx[0] || null;
}

function pickAnySg(analysis) {
  return pickConnectingSg(analysis)
    || (analysis.connecting || []).filter(isSg)[0]
    || (analysis.nonStop || []).filter(isSg)[0]
    || null;
}

async function pollDirection(flight, body, direction, { preferConnecting = true, maxPolls = 10 } = {}) {
  let last = null;
  for (let i = 0; i < maxPolls; i += 1) {
    last = await flight.search(body);
    const analysis = analyzeFlightOptions(last.data, direction);
    const opt = preferConnecting ? pickConnectingSg(analysis) : pickAnySg(analysis);
    console.log(
      `  ${direction} poll ${i + 1} state=${last.data?.progress?.state} ns=${analysis.nonStopCount} cx=${analysis.connectingCount} sgCx=${(analysis.connecting || []).filter(isSg).length}`,
    );
    if (opt?.searchId) return { data: last.data, analysis, opt };
    if (isSearchProgressComplete(last.data)) {
      // last chance: any SG
      const any = pickAnySg(analysis);
      return { data: last.data, analysis, opt: any };
    }
    await sleep(Math.min(last.data?.progress?.pollAfterMs || 2500, 4000));
  }
  const analysis = analyzeFlightOptions(last?.data, direction);
  return { data: last?.data, analysis, opt: pickAnySg(analysis) };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  console.log('Base', config.baseUrl, 'partner', config.partnerId);
  console.log('Book SG CORPORATE RT CONNECTING 2ADT — multi route/date/names');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const attempts = [];
  let booked = null;
  let nameSetIndex = 0;

  outer: for (const [origin, destination] of ROUTES) {
    for (const [od, rd] of DAY_PAIRS) {
      if (booked) break outer;
      const label = `SG CORP RT ${origin}-${destination} +${od}/+${rd}`;
      console.log(`\n=== ${label} nameset=${nameSetIndex} (${PAX_NAME_SETS[nameSetIndex % PAX_NAME_SETS.length].map((p) => p[0]).join('+')}) ===`);

      const body = buildRoundTripSearchBody(od, rd, {
        origin, destination, fareType: 'CORPORATE', maxStops: null,
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences.airlines = ['SG'];
      body.preferences.maxStops = null;

      const onwardRes = await pollDirection(flight, body, 'ONWARD', { preferConnecting: true, maxPolls: 10 });
      let onwardOpt = onwardRes.opt;
      // Require connecting on at least one leg for "connecting" ask — prefer onward connecting
      if (!onwardOpt?.searchId || !(onwardOpt.totalStops >= 1 || onwardOpt.segmentCount >= 2)) {
        // try any SG onward then hope return is connecting
        onwardOpt = pickAnySg(onwardRes.analysis);
        if (!onwardOpt?.searchId) {
          console.log('  no SG onward');
          attempts.push({ label, step: 'onward', error: 'no SG' });
          continue;
        }
        console.log('  onward SG (may be direct)', onwardOpt.searchId, onwardOpt.legs);
      } else {
        console.log('  onward SG CONNECTING', onwardOpt.searchId, `stops=${onwardOpt.totalStops}`, onwardOpt.legs);
      }

      const refined = { ...body, selection: { selectedSearchIds: [onwardOpt.searchId] } };
      const returnRes = await pollDirection(flight, refined, 'RETURN', { preferConnecting: true, maxPolls: 10 });
      let returnOpt = returnRes.opt;
      if (!returnOpt?.searchId) {
        console.log('  no SG return');
        attempts.push({ label, step: 'return', error: 'no SG return' });
        continue;
      }
      const returnCx = returnOpt.totalStops >= 1 || returnOpt.segmentCount >= 2;
      const onwardCx = onwardOpt.totalStops >= 1 || onwardOpt.segmentCount >= 2;
      if (!onwardCx && !returnCx) {
        console.log('  both legs direct SG — skip (need connecting)');
        attempts.push({ label, step: 'connecting', error: 'no connecting leg' });
        continue;
      }
      console.log('  return', returnCx ? 'CONNECTING' : 'direct', returnOpt.searchId, returnOpt.legs);

      const searchIds = [onwardOpt.searchId, returnOpt.searchId];
      const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
      const addGst = pricing.data?.addGstInfo === true || pricing.data?.pricing?.addGstInfo === true;
      console.log('  pricing', pricing.status, pricing.data?.priceId, 'total', pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount, 'addGst', addGst);
      if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
        attempts.push({ label, step: 'pricing', error: brief(pricing.data) });
        continue;
      }

      const passengers = adultProfiles(nameSetIndex);
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds,
        journeyType: 'ROUND_TRIP',
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
        nameSetIndex += 1;
        continue;
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
        airline: 'SG',
        fareType: 'CORPORATE',
        journeyType: 'ROUND_TRIP',
        adults: 2,
        br,
        status,
        route: `${origin}-${destination}-${origin}`,
        days: { onward: od, return: rd },
        dates: { onward: body.itinerary[0].date, return: body.itinerary[1].date },
        searchIds,
        priceId: pricing.data.priceId,
        totalAmount: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
        addGstInfo: addGst,
        onwardConnecting: onwardCx,
        returnConnecting: returnCx,
        passengerNames: passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
        nameSetIndex,
        legs,
        pnrs: legs.map((l) => l.pnr).filter(Boolean),
      };

      attempts.push({
        label, br, status, nameSetIndex, names: row.passengerNames,
        step: /confirm/i.test(status) ? 'confirmed' : (/inprogress/i.test(status) ? 'inprogress' : 'other'),
      });

      if (/confirm/i.test(String(status))) {
        booked = row;
        break outer;
      }

      console.log(/inprogress/i.test(String(status))
        ? '  Inprogress — leave BR, rotate names + next combo'
        : '  not confirmed — rotate names + next combo');
      nameSetIndex += 1;
    }
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
  console.log(JSON.stringify(booked || { error: 'no confirmed SG corporate RT connecting booking' }, null, 2));
  console.log('Wrote', OUT);
  if (!booked) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

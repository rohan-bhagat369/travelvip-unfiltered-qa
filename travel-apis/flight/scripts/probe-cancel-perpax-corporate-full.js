/**
 * P0 S3 — CORPORATE OW 2ADT full PNR cancel (no cancellationPaxList)
 * Book → PENALTY → CANCEL; assert perPax chargedPax=2, no paxScope, fee×2
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-corporate-full.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  buildPassengerProfile,
  isTerminalBookingStatus,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-corporate-full.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 900) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function nearly(a, b, tol = 1) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function passengers(tag) {
  const pool = [
    { title: 'Mr', firstName: 'Arjun', lastName: 'Kapoor', gender: 'Male', dob: '1986-07-19' },
    { title: 'Mrs', firstName: 'Priya', lastName: 'Kapoor', gender: 'Female', dob: '1989-02-08' },
  ];
  return pool.map((p, i) => {
    const prof = buildPassengerProfile({ ...p, lastName: `${p.lastName}${tag}${i + 1}` });
    return {
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: prof.title, firstName: prof.firstName, lastName: prof.lastName,
        gender: prof.gender, dob: prof.dob, nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  });
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: { retryCount: 2, ...body },
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function waitConfirm(flight, br, max = 12) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return last;
    if (isTerminalBookingStatus(last) && !/pending|progress/i.test(last)) return last;
    await sleep(2500);
  }
  return last;
}

async function bookCorporateOw2(flight, client) {
  const routes = [
    { o: 'DEL', d: 'BOM' },
    { o: 'BOM', d: 'DEL' },
    { o: 'BLR', d: 'DEL' },
    { o: 'DEL', d: 'HYD' },
  ];
  for (const r of routes) {
    for (const days of [30, 38, 45, 55]) {
      console.log(`\nBOOK CORPORATE OW 2ADT ${r.o}-${r.d} d+${days}`);
      const body = buildOneWaySearchBody(days, {
        origin: r.o, destination: r.d, fareType: 'CORPORATE', maxStops: 0,
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };

      let sid = null;
      for (let i = 0; i < 10; i += 1) {
        const s = await flight.search(body);
        sid = extractFirstSearchId(s.data);
        if (sid || isSearchProgressComplete(s.data)) break;
        await sleep(2000);
      }
      if (!sid) continue;

      const pricing = await flight.getPricing([sid], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data, 200));
        continue;
      }
      console.log('  fare', pricing.data.pricing?.totalAmount, 'gst', pricing.data.addGstInfo);

      const tag = Date.now().toString(36).slice(-4);
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [sid],
        journeyType: 'ONE_WAY',
      });
      payload.data.passengers = passengers(tag);
      payload.data.includeGst = true;
      payload.data.addGstInfo = true;
      payload.data.gstDetails = { ...GST };

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
        console.log('  issue fail', brief(issue.data, 260));
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
          return { error: 'INSUFFICIENT_BALANCE', details: issue.data };
        }
        continue;
      }

      const status = await waitConfirm(flight, br);
      if (/inprogress|in.?progress/i.test(String(status))) {
        console.log('  Inprogress — leave, retry other');
        continue;
      }
      const detail = await flight.getBookingDetail(br);
      const leg = (detail.data?.bookingResponse?.itinerary || [])[0] || {};
      const pnr = leg.pnr || null;
      console.log('  =>', br, status, 'pnr', pnr, 'online', leg.onlineCancellation);
      if (!/confirm/i.test(String(status)) || !pnr) continue;

      return {
        br,
        status,
        pnr,
        onlineCancellation: leg.onlineCancellation,
        route: `${r.o}-${r.d}`,
        fareType: 'CORPORATE',
        totalAmount: pricing.data.pricing?.totalAmount,
        airline: leg.segments?.[0]?.airlineCode || leg.segments?.[0]?.airline?.code,
      };
    }
  }
  return null;
}

function score(label, res) {
  const c = cr(res);
  const scope = env(res).paxScope || null;
  const perPax = c.perPax || null;
  const totalAmount = num(c.totalAmount);
  const charge = num(c.estimatedCancellationCharge);
  const refund = num(c.estimatedRefund);
  const rows = [];

  rows.push({
    rule: `${label}: paxScope absent (full PNR)`,
    expected: 'no paxScope',
    actual: scope ? brief(scope, 200) : 'absent',
    status: scope == null ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: amounts present`,
    expected: 'totalAmount, charge, refund numeric',
    actual: `total=${totalAmount} charge=${charge} refund=${refund} msg=${c.message || ''}`,
    status: totalAmount != null && charge != null && refund != null ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: refund = total − charge`,
    expected: 'estimatedRefund === totalAmount - estimatedCancellationCharge',
    actual: `refund=${refund} total=${totalAmount} charge=${charge}`,
    status: nearly(refund, (totalAmount ?? 0) - (charge ?? 0)) ? 'PASS' : 'BUG',
  });
  rows.push({
    rule: `${label}: perPax chargedPax=2 basis!=NONE`,
    expected: 'chargedPax=2 (or paxCount=2), penaltyBasis not NONE',
    actual: perPax ? brief(perPax, 280) : 'MISSING',
    status: perPax
      && (Number(perPax.chargedPax) === 2 || Number(perPax.paxCount) === 2)
      && String(perPax.penaltyBasis) !== 'NONE'
      ? 'PASS' : 'BUG',
  });

  if (perPax) {
    const fee = num(perPax.cancellationFee);
    const pen = num(perPax.penalty);
    // charge should include fee×chargedPax (+ penalty scaled by basis)
    const charged = Number(perPax.chargedPax) || 2;
    if (fee != null) {
      rows.push({
        rule: `${label}: cancellationFee × chargedPax in charge`,
        expected: `charge includes fee×${charged} (=${fee * charged})`,
        actual: `fee=${fee} charge=${charge} penalty=${pen}`,
        status: charge != null && charge >= fee * charged - 1 ? 'PASS' : 'BUG',
      });
    }
  }

  rows.push({
    rule: `${label}: status`,
    expected: 'Penalty Fetched / Cancellation Requested / Cancelled',
    actual: c.status || res.data?.error?.code || res.status,
    status: /penalty fetched|cancellation requested|cancelled/i.test(String(c.status || ''))
      && !/failed|not available/i.test(String(c.status || ''))
      ? 'PASS' : 'BUG',
  });

  return {
    rows,
    snapshot: {
      http: res.status,
      raw: env(res),
      status: c.status,
      totalAmount,
      charge,
      refund,
      perPax,
      paxScope: scope,
      message: c.message || null,
      error: res.data?.error || null,
    },
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('S3 CORPORATE full PNR cancel on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixture = await bookCorporateOw2(flight, client);
  if (fixture?.error === 'INSUFFICIENT_BALANCE') {
    fs.writeFileSync(OUT, JSON.stringify({ error: fixture }, null, 2));
    throw new Error('INSUFFICIENT_BALANCE');
  }
  if (!fixture?.br) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_BOOKING', fixture }, null, 2));
    throw new Error('No CORPORATE Confirmed booking');
  }

  console.log('\n=== FULL PNR PENALTY', fixture.br, fixture.pnr);
  const pen = await cancelCall(client, fixture.br, {
    action: 'PENALTY',
    pnr: fixture.pnr,
    cancellationReason: 'S3 CORPORATE full PNR',
  });
  console.log('PENALTY', pen.status, brief(pen.data));
  const sPen = score('S3 PENALTY full', pen);

  await sleep(1500);
  console.log('\n=== FULL PNR CANCEL');
  const can = await cancelCall(client, fixture.br, {
    action: 'CANCEL',
    pnr: fixture.pnr,
    cancellationReason: 'S3 CORPORATE full PNR',
  });
  console.log('CANCEL', can.status, brief(can.data));
  const sCan = score('S3 CANCEL full', can);

  const after = await flight.getBookingStatus(fixture.br);
  const table = [
    ...sPen.rows,
    ...sCan.rows,
    {
      rule: 'S3 final booking status',
      expected: 'Cancelled or Cancellation Requested',
      actual: after.data?.status,
      status: /cancel/i.test(String(after.data?.status || '')) ? 'PASS' : 'BUG',
    },
  ];
  const scorecard = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'S3 CORPORATE OW 2ADT full PNR cancel',
    fixture,
    request: { action: 'PENALTY/CANCEL', pnr: fixture.pnr, cancellationPaxList: null },
    penalty: sPen.snapshot,
    cancel: sCan.snapshot,
    afterStatus: after.data?.status,
    table,
    score: scorecard,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', scorecard);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

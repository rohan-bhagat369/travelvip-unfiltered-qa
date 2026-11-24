/**
 * Unblocked cancel-suite leftovers on ak-api:
 *   H3 — PENALTY first cancel (onward PNR)
 *   H4 — settle onward, then PENALTY on return (original-total quote check)
 * Also books a spare OW for Nexus C8.
 *
 *   node travel-apis/flight/scripts/_tmp-h3-h4-c8-probe.mjs
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  extractOnwardSearchId,
  extractReturnSearchId,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';
import { config } from '../../../shared/config/env.js';

const OUT_DIR = path.join(
  'd:/Travel VIP API Automation/travel-apis/flight/reports/cancel-suite-2026-11-19',
);
fs.mkdirSync(OUT_DIR, { recursive: true });

const j = JSON.parse(
  fs.readFileSync(
    path.join(
      process.env.USERPROFILE || '',
      '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
    ),
    'utf8',
  ),
);
const vars = {};
for (const v of j.environments[0].variables) vars[v.name] = v.value ?? v.initialValue ?? '';
process.env.BASE_URL = 'https://ak-api.travelvip.ai';
process.env.PARTNER_ID = vars.partner_id || 'vgm';
process.env.PARTNER_SECRET = vars.partner_secret;
process.env.SIGNING_KEY = vars.signing_key;
process.env.TIER_ID = vars.tier_id || '10546901';
process.env.ALLOW_BOOK = 'true';

function opts(data, dir) {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === dir)?.options) || [];
}
function collectPnrs(st) {
  const raw = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    for (const [k, v] of Object.entries(o)) {
      if (/pnr/i.test(k) && typeof v === 'string' && v.trim() && !v.startsWith('BR')) raw.push(v.trim());
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(st);
  return [...new Set(raw.flatMap((p) => p.split('|').map((x) => x.trim()).filter(Boolean)))];
}
function moneyFields(d) {
  const s = JSON.stringify(d || {});
  const pick = (re) => {
    const m = s.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    estimatedRefund: pick(/"estimatedRefund"\s*:\s*([0-9.]+)/i),
    estimatedCancellationCharge: pick(/"estimatedCancellationCharge"\s*:\s*([0-9.]+)/i),
    totalAmount: pick(/"totalAmount"\s*:\s*([0-9.]+)/i),
    convenienceFee: pick(/"convenienceFee"\s*:\s*([0-9.]+)/i),
    cancellationFee: pick(/"cancellationFee"\s*:\s*([0-9.]+)/i),
    refundAmount: pick(/"refundAmount"\s*:\s*([0-9.]+)/i),
  };
}
function brief(d, n = 800) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

async function pollConfirmed(flight, br, max = 28) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  poll ${i + 1}: ${st}`);
    if (isTerminalBookingStatus(st) || /confirm|fail|cancel/i.test(st)) return { status: st, res: last };
    await sleep(3000);
  }
  return { status: last?.data?.status, res: last, timedOut: true };
}

async function bookRt(flight, client) {
  const body = buildRoundTripSearchBody(32, 38, {
    origin: 'DEL',
    destination: 'PNQ',
    maxStops: 2,
    fareType: 'NORMAL',
  });
  body.travellers = { adults: 2, children: 0, infants: 0 };
  console.log('RT search DEL↔PNQ', body.itinerary);
  const search = await flight.search(body);
  const onward = extractOnwardSearchId(search.data) || opts(search.data, 'ONWARD')[0]?.searchId;
  if (!onward) throw new Error('no onward searchId');
  const retRes = await flight.search({ ...body, selection: { selectedSearchIds: [onward] } });
  const ret =
    extractReturnSearchId(retRes.data) ||
    opts(retRes.data, 'RETURN').find((o) => o.searchId !== onward)?.searchId;
  if (!ret) throw new Error('no return searchId');
  const ids = [onward, ret];
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  const ctx = pricing.data?.bookingContext || pricing.data?.bookingReference;
  const priceId = pricing.data?.priceId;
  const total = pricing.data?.pricing?.totalAmount;
  if (!ctx || !priceId) throw new Error('pricing missing ctx/priceId');

  const payload = buildIssueTicketPayload({
    bookingContext: ctx,
    priceId,
    searchIds: ids,
    journeyType: 'ROUND_TRIP',
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: 'Confirmed',
      gender: 'Male',
      dob: '1992-05-15',
      nationality: 'IN',
    },
  });
  payload.data.contact.email = `ak.h3h4.${Date.now()}@travelvip.ai`;
  payload.data.passengers[0].profile.lastName = 'Confirmed';
  payload.data.passengers.push({
    paxId: 'PAX2',
    type: 'adult',
    isLead: false,
    profile: {
      title: 'Mr',
      firstName: 'Amit',
      lastName: 'Confirmed',
      gender: 'Male',
      dob: '1990-03-10',
      nationality: 'IN',
    },
    city: payload.data.passengers[0].city,
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  });

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: 'vgm',
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!br) throw new Error(`issue failed ${brief(issue.data)}`);
  const polled = await pollConfirmed(flight, br);
  return {
    br,
    status: polled.status,
    pnrs: collectPnrs(polled.res?.data),
    paidTotal: total,
    issueHttp: issue.status,
  };
}

async function bookOw(flight, client) {
  const body = buildOneWaySearchBody(28, {
    origin: 'PNQ',
    destination: 'DEL',
    maxStops: 1,
    fareType: 'NORMAL',
  });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  const search = await flight.search(body);
  const sid = extractOnwardSearchId(search.data) || opts(search.data, 'ONWARD')[0]?.searchId;
  if (!sid) throw new Error('OW no searchId');
  const pricing = await flight.getPricing([sid], 'ONE_WAY');
  const ctx = pricing.data?.bookingContext || pricing.data?.bookingReference;
  const priceId = pricing.data?.priceId;
  if (!ctx || !priceId) throw new Error('OW pricing missing');
  const payload = buildIssueTicketPayload({
    bookingContext: ctx,
    priceId,
    searchIds: [sid],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: 'Confirmed',
      gender: 'Male',
      dob: '1992-05-15',
      nationality: 'IN',
    },
  });
  payload.data.contact.email = `ak.c8.${Date.now()}@travelvip.ai`;
  payload.data.passengers[0].profile.lastName = 'Confirmed';
  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: 'vgm',
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!br) throw new Error(`OW issue failed ${brief(issue.data)}`);
  const polled = await pollConfirmed(flight, br);
  return { br, status: polled.status, pnrs: collectPnrs(polled.res?.data) };
}

async function main() {
  console.log('BASE', process.env.BASE_URL);
  const { client } = await authenticate(true);
  client.setPartnerKey(client.partnerKey || process.env.PARTNER_ID);
  const flight = new FlightService(client);

  const report = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    cases: {},
    webhookPasteBrs: {
      H6_online: ['BR1795102051513893', 'BR1795088345226462'],
      H7_offline_fee_change: ['BR1795091441315761'],
      H8_cancelled_some: ['BR1795156611803979', 'BR1795102326635514'],
    },
  };

  console.log('\n## Book RT for H3/H4');
  const rt = await bookRt(flight, client);
  console.log('RT', rt);
  report.rt = rt;
  if (!/confirm/i.test(String(rt.status)) || rt.pnrs.length < 1) {
    report.cases.H3 = { status: 'NOT TESTED', note: `book ${rt.status} pnrs=${rt.pnrs}` };
    report.cases.H4 = { status: 'NOT TESTED', note: 'no Confirmed RT' };
  } else {
    const onwardPnr = rt.pnrs[0];
    const returnPnr = rt.pnrs[1] || rt.pnrs[0];

    console.log('\n## H3 PENALTY onward', onwardPnr);
    const h3 = await flight.checkCancellationPenalty(rt.br, { pnr: onwardPnr });
    const h3m = moneyFields(h3.data);
    console.log('H3', h3.status, h3m, brief(h3.data, 400));
    report.cases.H3 = {
      status: h3.status === 500 ? 'BUG' : h3.ok || h3.status < 500 ? 'PASS' : 'BUG',
      note: `PENALTY first cancel http=${h3.status} pnr=${onwardPnr}`,
      money: h3m,
      sample: brief(h3.data, 900),
    };

    console.log('\n## Settle onward via v2 CANCEL', onwardPnr);
    const cancel = await flight.cancelV2({
      bookingId: rt.br,
      action: 'CANCEL',
      pnr: onwardPnr,
      cancelledBy: 'USER',
    });
    console.log('cancel', cancel.status, brief(cancel.data, 400));
    await sleep(4000);
    const after = await pollConfirmed(flight, rt.br, 12);
    report.settleOnward = {
      http: cancel.status,
      bookingStatus: after.status,
      sample: brief(cancel.data, 700),
    };

    console.log('\n## H4 PENALTY return', returnPnr);
    const h4 = await flight.checkCancellationPenalty(rt.br, { pnr: returnPnr });
    const h4m = moneyFields(h4.data);
    console.log('H4', h4.status, h4m, brief(h4.data, 400));
    // H-a: quote should be based on original total (~ half of paid for that PNR share), not shrunk remainder
    const paid = Number(rt.paidTotal) || null;
    const hint =
      paid && h4m.estimatedRefund != null
        ? `paidTotal=${paid} returnRefund=${h4m.estimatedRefund} (~half fare share expected on original)`
        : 'compare estimatedRefund to original sales summary share';
    report.cases.H4 = {
      status: h4.status === 500 ? 'BUG' : h4.ok || h4.status < 500 ? 'PASS' : 'BUG',
      note: `PENALTY after settle http=${h4.status} pnr=${returnPnr} · ${hint}`,
      money: h4m,
      sample: brief(h4.data, 900),
      compareHint: hint,
    };
  }

  console.log('\n## Book OW spare for C8');
  try {
    const ow = await bookOw(flight, client);
    console.log('OW', ow);
    report.c8Fixture = ow;
  } catch (e) {
    console.log('OW book failed', e.message);
    report.c8Fixture = { error: e.message };
  }

  const outPath = path.join(OUT_DIR, 'h3-h4-c8-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\nWROTE', outPath);
  console.log(JSON.stringify(report.cases, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Edge validations: mixed invalid pax list, duplicate PENALTY, whitespace paxId
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-edge-validations.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { FLIGHT_QUERY } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-edge-validations.json';
const Q = { ...FLIGHT_QUERY };
const BR_1ADT = process.env.BR_1ADT || 'BR1786571557638647';
const BR_MULTI = process.env.BR_MULTI || 'BR1786569524287412';

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
}
function errOf(r) {
  return r?.data?.error || null;
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

async function load(flight, br) {
  const st = await flight.getBookingStatus(br);
  const det = await flight.getBookingDetail(br);
  const itins = det.data?.bookingResponse?.itinerary || [];
  const pax = det.data?.bookingResponse?.passengers || [];
  return {
    br,
    status: st.data?.status || det.data?.status,
    pnr: itins[0]?.pnr,
    passengers: pax.map((p) => p.paxId),
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Edge validations on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const one = await load(flight, BR_1ADT);
  const multi = await load(flight, BR_MULTI);
  console.log('1ADT', one);
  console.log('MULTI', multi);

  const table = [];
  const cases = {};

  // E1: mixed valid + invalid pax
  {
    console.log('\n=== E1 mixed [PAX1, PAX99]');
    const res = await cancelCall(client, multi.br, {
      action: 'PENALTY',
      pnr: multi.pnr,
      cancellationPaxList: ['PAX1', 'PAX99'],
      cancellationReason: 'E1',
    });
    console.log(res.status, brief(res.data));
    const err = errOf(res);
    const ok = res.status >= 400
      && (err?.code === 'PAX_NOT_IN_BOOKING' || /PAX|invalid|not/i.test(err?.code || err?.message || ''));
    table.push({
      rule: 'E1 mixed valid+invalid pax rejected',
      expected: '4xx PAX_NOT_IN_BOOKING (or similar); no quote',
      actual: `${res.status} ${err?.code || cr(res).status || brief(res.data, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.E1 = { http: res.status, error: err, raw: brief(res.data, 400) };
  }

  // E2: whitespace pax id
  {
    console.log('\n=== E2 whitespace pax " PAX1 "');
    const res = await cancelCall(client, one.br, {
      action: 'PENALTY',
      pnr: one.pnr,
      cancellationPaxList: [' PAX1 '],
      cancellationReason: 'E2',
    });
    console.log(res.status, brief(res.data));
    const err = errOf(res);
    const st = cr(res).status;
    // Accept either trim-success (Penalty Fetched) OR validation reject
    const ok = /penalty fetched/i.test(String(st || ''))
      || (res.status >= 400 && Boolean(err?.code));
    table.push({
      rule: 'E2 whitespace paxId deterministic',
      expected: 'trim → Penalty Fetched OR 4xx validation',
      actual: `${res.status} ${err?.code || st || brief(res.data, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.E2 = { http: res.status, error: err, status: st, raw: brief(res.data, 400) };
  }

  // E3: duplicate PENALTY (idempotent / stable)
  {
    console.log('\n=== E3 duplicate PENALTY');
    const a = await cancelCall(client, one.br, {
      action: 'PENALTY', pnr: one.pnr, cancellationReason: 'E3a',
    });
    await sleep(800);
    const b = await cancelCall(client, one.br, {
      action: 'PENALTY', pnr: one.pnr, cancellationReason: 'E3b',
    });
    console.log('first', a.status, cr(a).status, cr(a).estimatedRefund);
    console.log('second', b.status, cr(b).status, cr(b).estimatedRefund);
    const ok = a.status === 200 && b.status === 200
      && /penalty fetched/i.test(String(cr(a).status || ''))
      && /penalty fetched/i.test(String(cr(b).status || ''))
      && Number(cr(a).estimatedRefund) === Number(cr(b).estimatedRefund);
    table.push({
      rule: 'E3 duplicate PENALTY stable quote',
      expected: 'both Penalty Fetched; same estimatedRefund',
      actual: `a=${cr(a).status}/${cr(a).estimatedRefund} b=${cr(b).status}/${cr(b).estimatedRefund}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.E3 = {
      first: { http: a.status, status: cr(a).status, refund: cr(a).estimatedRefund, charge: cr(a).estimatedCancellationCharge },
      second: { http: b.status, status: cr(b).status, refund: cr(b).estimatedRefund, charge: cr(b).estimatedCancellationCharge },
    };
  }

  // E4: duplicate pax in list [PAX1, PAX1]
  {
    console.log('\n=== E4 duplicate pax in list');
    const res = await cancelCall(client, multi.br, {
      action: 'PENALTY',
      pnr: multi.pnr,
      cancellationPaxList: ['PAX1', 'PAX1'],
      cancellationReason: 'E4',
    });
    console.log(res.status, brief(res.data));
    const err = errOf(res);
    const st = cr(res).status;
    const scope = env(res).paxScope;
    // Accept: validation error OR dedupe to cancelledPaxCount=1 with quote
    const ok = (res.status >= 400 && Boolean(err?.code))
      || (Number(scope?.cancelledPaxCount) === 1 && /penalty fetched/i.test(String(st || '')))
      || (/penalty fetched/i.test(String(st || '')) && Array.isArray(cr(res).perPax) && cr(res).perPax.length === 1);
    table.push({
      rule: 'E4 duplicate pax in list deterministic',
      expected: 'reject OR dedupe to 1 charged pax',
      actual: `${res.status} ${err?.code || st} scope=${brief(scope, 160)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.E4 = { http: res.status, error: err, status: st, paxScope: scope, raw: brief(res.data, 400) };
  }

  const score = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'Cancel edge validations',
    fixtures: { one, multi },
    cases,
    table,
    score,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', score);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

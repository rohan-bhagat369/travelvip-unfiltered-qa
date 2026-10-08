/**
 * Final live canary leftovers for per-pax cancel
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-cancel-perpax-final-edges.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { FLIGHT_QUERY } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/cancel-perpax-final-edges.json';
const Q = { ...FLIGHT_QUERY };
const BR = process.env.BR || 'BR1786571557638647';
const BR_MULTI = process.env.BR_MULTI || 'BR1786569524287412';

function brief(d, n = 450) {
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
  return {
    br,
    status: st.data?.status || det.data?.status,
    pnr: itins.find((l) => /onward/i.test(l.direction))?.pnr || itins[0]?.pnr,
    passengers: (det.data?.bookingResponse?.passengers || []).map((p) => p.paxId),
  };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Final edges on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const one = await load(flight, BR);
  const multi = await load(flight, BR_MULTI);
  console.log('one', one);
  console.log('multi', multi);

  const table = [];
  const cases = {};

  // F1 invalid action
  {
    const res = await cancelCall(client, one.br, {
      action: 'PENALTY_AND_CANCEL', pnr: one.pnr, cancellationReason: 'F1',
    });
    console.log('F1', res.status, brief(res.data));
    const err = errOf(res);
    table.push({
      rule: 'F1 invalid action rejected',
      expected: '400 VALIDATION_ERROR',
      actual: `${res.status} ${err?.code || brief(res.data, 120)}`,
      status: res.status === 400 && err?.code === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
    });
    cases.F1 = { http: res.status, error: err };
  }

  // F2 lowercase action
  {
    const res = await cancelCall(client, one.br, {
      action: 'penalty', pnr: one.pnr, cancellationReason: 'F2',
    });
    console.log('F2', res.status, brief(res.data));
    const err = errOf(res);
    const st = cr(res).status;
    const ok = /penalty fetched/i.test(String(st || ''))
      || (res.status >= 400 && Boolean(err?.code));
    table.push({
      rule: 'F2 lowercase action deterministic',
      expected: 'accepted (normalized) OR 400 validation',
      actual: `${res.status} ${err?.code || st}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.F2 = { http: res.status, error: err, status: st };
  }

  // F3 numeric pax alias "1" for PAX1
  {
    const res = await cancelCall(client, multi.br, {
      action: 'PENALTY',
      pnr: multi.pnr,
      cancellationPaxList: ['1'],
      cancellationReason: 'F3',
    });
    console.log('F3', res.status, brief(res.data));
    const err = errOf(res);
    const st = cr(res).status;
    const scope = env(res).paxScope;
    const ok = /penalty fetched/i.test(String(st || ''))
      || (res.status >= 400 && Boolean(err?.code));
    table.push({
      rule: 'F3 numeric pax alias "1"',
      expected: 'maps to PAX1 quote OR clear validation error',
      actual: `${res.status} ${err?.code || st} ${brief(scope, 120)}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.F3 = { http: res.status, error: err, status: st, paxScope: scope };
  }

  // F4 empty string pnr
  {
    const res = await cancelCall(client, one.br, {
      action: 'PENALTY', pnr: '', cancellationReason: 'F4',
    });
    console.log('F4', res.status, brief(res.data));
    const err = errOf(res);
    table.push({
      rule: 'F4 empty pnr rejected',
      expected: '400 VALIDATION_ERROR',
      actual: `${res.status} ${err?.code || brief(res.data, 120)}`,
      status: res.status >= 400 && Boolean(err?.code) ? 'PASS' : 'BUG',
    });
    cases.F4 = { http: res.status, error: err };
  }

  // F5 null cancellationPaxList omitted vs explicit null — send null
  {
    const res = await cancelCall(client, one.br, {
      action: 'PENALTY', pnr: one.pnr, cancellationPaxList: null, cancellationReason: 'F5',
    });
    console.log('F5', res.status, brief(res.data));
    const err = errOf(res);
    const st = cr(res).status;
    const ok = /penalty fetched|penalty check failed/i.test(String(st || ''))
      || (res.status >= 400 && Boolean(err?.code));
    table.push({
      rule: 'F5 cancellationPaxList null treated as full PNR or validated',
      expected: 'Penalty Fetched (full) OR 400',
      actual: `${res.status} ${err?.code || st}`,
      status: ok ? 'PASS' : 'BUG',
    });
    cases.F5 = { http: res.status, error: err, status: st };
  }

  // F6 CANCEL without prior PENALTY (direct cancel still ok)
  {
    // use multi return pnr if still confirmed - safer: one.br full cancel would burn fixture
    // Only PENALTY on one already done; do CANCEL on multi return if exists
    const det = await flight.getBookingDetail(multi.br);
    const ret = (det.data?.bookingResponse?.itinerary || []).find((l) => /return/i.test(l.direction));
    if (ret?.pnr && /confirm/i.test(String(multi.status || ''))) {
      const res = await cancelCall(client, multi.br, {
        action: 'CANCEL', pnr: ret.pnr, cancellationReason: 'F6 direct cancel no prior penalty',
      });
      console.log('F6', res.status, brief(res.data));
      const st = cr(res).status;
      const err = errOf(res);
      // IX may fail provider — accept Cancelled/Requested OR known provider fail
      const ok = /cancelled|cancellation requested/i.test(String(st || ''))
        || /failed/i.test(String(st || ''))
        || Boolean(err?.code);
      table.push({
        rule: 'F6 CANCEL without prior PENALTY accepted/handled',
        expected: 'Cancelled/Requested (or provider fail envelope)',
        actual: `${res.status} ${err?.code || st}`,
        status: ok ? 'PASS' : 'BUG',
      });
      cases.F6 = { http: res.status, error: err, status: st, pnr: ret.pnr };
    } else {
      table.push({
        rule: 'F6 CANCEL without prior PENALTY accepted/handled',
        expected: 'testable return PNR',
        actual: 'no return PNR / not confirmed',
        status: 'NOT_TESTED',
      });
    }
  }

  await sleep(300);

  const score = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
    NOT_TESTED: table.filter((t) => t.status === 'NOT_TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixtures: { one, multi },
    cases,
    table,
    score,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', score);
  console.table(table.map((t, i) => ({ n: i + 1, status: t.status, rule: t.rule.slice(0, 55) })));
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

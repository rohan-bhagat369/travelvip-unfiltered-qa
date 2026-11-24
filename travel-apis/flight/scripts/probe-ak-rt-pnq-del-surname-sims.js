/**
 * ak-api PNQ↔DEL round-trip surname simulation matrix
 *
 *   BASE_URL=https://ak-api.travelvip.ai node travel-apis/flight/scripts/probe-ak-rt-pnq-del-surname-sims.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { sleep } from '../../../shared/lib/testUtils.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  extractOnwardSearchId,
  extractReturnSearchId,
} from '../src/helpers.js';

const BASE = (process.env.BASE_URL || 'https://ak-api.travelvip.ai').replace(/\/$/, '');
const ORIGIN = process.env.FLIGHT_ORIGIN || 'PNQ';
const DEST = process.env.FLIGHT_DEST || 'DEL';
const ONWARD_DATE = process.env.FLIGHT_DATE || '2026-12-20';
const RETURN_DATE = process.env.FLIGHT_RETURN_DATE || '2026-12-23';
const FARE = process.env.FLIGHT_FARE_TYPE || 'NORMAL';
const OUT = path.join('travel-apis', 'flight', 'reports', 'ak-api-rt-pnq-del-surname-sims.json');
const MD = path.join('travel-apis', 'flight', 'reports', 'ak-api-rt-pnq-del-surname-sims.md');

const CASES = [
  {
    id: '1',
    label: 'Confirm / Confirm',
    lastName: 'Tester',
    expect: 'CONFIRMED with onward+return PNRs, both legs CONFIRMED',
  },
  {
    id: '2a',
    label: 'Fail / Fail',
    lastName: 'FAIL',
    expect: 'FAILED, no PNRs',
  },
  {
    id: '2b',
    label: 'Fail / Fail (pending then fail)',
    lastName: 'PENDINGFAIL',
    expect: 'pending then FAILED, no PNRs',
  },
  {
    id: '3',
    label: 'Confirm / In-progress',
    lastName: 'HALFPENDING',
    expect: 'IN_PROGRESS with onward PNR; return settles later',
  },
  {
    id: '4',
    label: 'Confirm / Fail',
    lastName: 'HALFFAIL',
    expect: 'partial IN_PROGRESS with onward PNR (not full FAILED)',
  },
  {
    id: '5',
    label: 'Fail / In-progress',
    lastName: 'PENDINGHALFFAIL',
    expect: 'IN_PROGRESS; onward settles later',
  },
];

function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function optionsOf(data, direction) {
  const results = data?.results || [];
  if (direction) {
    const block = results.find((r) => String(r.direction).toUpperCase() === direction);
    return block?.options || [];
  }
  return results.flatMap((r) => r.options || []);
}

function firstMealRaw(ssrData) {
  for (const seg of ssrData?.meal?.segments || []) {
    for (const m of seg.Meals || seg.meals || []) {
      const pref = m.priceReference || m.pricing?.priceReference;
      if (!pref) continue;
      return { m, pref, seg };
    }
  }
  return null;
}

/** Attach a meal per pricing leg with origin/destination (required for PNQ-DEL mandatory meal). */
function mealsForItinerary(pricingData, raw) {
  if (!raw) return [];
  const meals = [];
  for (const leg of pricingData?.itinerary || []) {
    const seg0 = (leg.segments || [])[0] || {};
    const dir = String(leg.direction || '').toUpperCase() === 'RETURN' ? 'RETURN' : 'ONWARD';
    meals.push({
      ssrId: String(raw.m.ssrId || raw.m.mealId || ''),
      mealId: String(raw.m.ssrId || raw.m.mealId || ''),
      direction: dir,
      segmentId: seg0.segmentId || raw.m.segmentId || raw.seg?.segmentId || 'SEG_1',
      paxType: 'ADT',
      code: raw.m.code,
      title: raw.m.title || raw.m.description || 'Meal',
      description: raw.m.description || raw.m.title || 'Meal',
      priceReference: raw.pref,
      origin: seg0.departure?.airportCode || raw.seg?.origin,
      destination: seg0.arrival?.airportCode || raw.seg?.destination,
    });
  }
  // Fallback if pricing has no itinerary: force ONWARD PNQ-DEL
  if (!meals.length) {
    meals.push({
      ssrId: String(raw.m.ssrId || raw.m.mealId || ''),
      mealId: String(raw.m.ssrId || raw.m.mealId || ''),
      direction: 'ONWARD',
      segmentId: raw.m.segmentId || raw.seg?.segmentId || 'SEG_1',
      paxType: 'ADT',
      code: raw.m.code,
      title: raw.m.title || 'Meal',
      description: raw.m.description || 'Meal',
      priceReference: raw.pref,
      origin: ORIGIN,
      destination: DEST,
    });
  }
  return meals;
}

function extractLegs(detailOrStatus) {
  const data = detailOrStatus?.data || detailOrStatus || {};
  const itin = data?.bookingResponse?.itinerary
    || data?.itinerary
    || data?.bookingDetails?.itinerary
    || [];
  const legs = itin.map((leg, i) => ({
    index: i,
    direction: leg.direction || leg.tripType || (i === 0 ? 'ONWARD' : 'RETURN'),
    pnr: leg.pnr || leg.airlinePnr || leg.airline_pnr || null,
    status: leg.status || leg.bookingStatus || null,
    flight: leg.segments?.[0]
      ? `${leg.segments[0].airline?.code || ''}${leg.segments[0].flightNumber || ''}`
      : null,
  }));
  return {
    bookingStatus: data?.status || data?.bookingStatus || data?.ticketStatus || null,
    message: data?.message || data?.error?.message || null,
    pnrs: legs.map((l) => l.pnr).filter(Boolean),
    legs,
  };
}

function scoreCase(caseDef, snap) {
  const st = String(snap.bookingStatus || '').toUpperCase().replace(/[\s-]/g, '_');
  const legs = snap.legs || [];
  const pnrs = snap.pnrs || [];
  const onward = legs[0] || {};
  const ret = legs[1] || {};
  const onwardSt = String(onward.status || '').toUpperCase().replace(/[\s-]/g, '_');
  const retSt = String(ret.status || '').toUpperCase().replace(/[\s-]/g, '_');
  const checks = [];
  const add = (rule, ok, actual) => checks.push({ rule, status: ok ? 'PASS' : 'BUG', actual });

  if (caseDef.id === '1') {
    add('Booking CONFIRMED', /CONFIRMED/.test(st), `status=${snap.bookingStatus}`);
    add('Onward + return PNR', pnrs.length >= 2, `pnrs=${JSON.stringify(pnrs)}`);
    add('Both legs CONFIRMED', /CONFIRMED/.test(onwardSt) && /CONFIRMED/.test(retSt),
      `onward=${onward.status} return=${ret.status}`);
  } else if (caseDef.id === '2a' || caseDef.id === '2b') {
    add('Booking FAILED', /FAIL/.test(st), `status=${snap.bookingStatus} msg=${snap.message}`);
    add('No PNRs', pnrs.length === 0, `pnrs=${JSON.stringify(pnrs)}`);
    if (caseDef.id === '2b') {
      add('Saw Pending in poll history', (snap.pollStatuses || []).some((p) => /PEND/i.test(p)),
        `polls=${(snap.pollStatuses || []).join('>')}`);
    }
  } else if (caseDef.id === '3') {
    const ok = /IN_PROGRESS|PENDING|CONFIRMED/.test(st);
    add('IN_PROGRESS (or still settling)', ok, `status=${snap.bookingStatus}`);
    add('Onward PNR present', Boolean(onward.pnr) || pnrs.length >= 1, `onwardPnr=${onward.pnr} pnrs=${JSON.stringify(pnrs)}`);
    add('Not full FAILED', !/^FAILED$/.test(st), `status=${snap.bookingStatus}`);
  } else if (caseDef.id === '4') {
    add('Not full FAILED booking', !/^FAILED$/.test(st) || Boolean(onward.pnr),
      `status=${snap.bookingStatus} onwardPnr=${onward.pnr}`);
    add('Onward PNR / Confirmed-ish', Boolean(onward.pnr) || /CONFIRMED|IN_PROGRESS|PENDING/.test(st),
      `onward=${onward.status}/${onward.pnr} booking=${snap.bookingStatus}`);
    add('Return failed or booking partial', /FAIL|IN_PROGRESS|PENDING|PARTIAL/i.test(st + retSt + String(snap.message || '')),
      `return=${ret.status} booking=${snap.bookingStatus}`);
  } else if (caseDef.id === '5') {
    add('IN_PROGRESS (not full FAILED)', /IN_PROGRESS|PENDING|CONFIRMED/.test(st) && !/^FAILED$/.test(st),
      `status=${snap.bookingStatus}`);
  }

  const bugs = checks.filter((c) => c.status === 'BUG').length;
  const passes = checks.filter((c) => c.status === 'PASS').length;
  return {
    verdict: bugs ? 'BUG' : (passes ? 'PASS' : 'NOT TESTED'),
    checks,
  };
}

async function prepareRt(flight) {
  const datePairs = [
    [ONWARD_DATE, RETURN_DATE],
    ['2026-12-20', '2026-12-23'],
    ['2026-12-27', '2026-12-30'],
    ['2027-01-10', '2027-01-14'],
  ];
  let lastErr = null;
  let attempt = 0;
  for (const [od, rd] of datePairs) {
    attempt += 1;
    const body = buildRoundTripSearchBody(30, 33, {
      origin: ORIGIN, destination: DEST, fareType: FARE, maxStops: null,
    });
    body.itinerary[0].date = od;
    body.itinerary[1].date = rd;
    body.preferences.refundableOnly = false;

    try {
      // Fresh search each attempt (avoid sticky searchIds); poll lightly
      let s1 = await flight.search(body);
      for (let i = 0; i < 12; i += 1) {
        if (optionsOf(s1.data, 'ONWARD').length) break;
        if (s1.data?.error?.code && s1.data.error.code !== 'SEARCH_IN_PROGRESS') break;
        await sleep(2000);
        s1 = await flight.search(body);
      }
      const onwardList = optionsOf(s1.data, 'ONWARD');
      // rotate option index by attempt to avoid sticky/expired fare
      const onwardIdx = (attempt - 1) % Math.max(onwardList.length, 1);
      const onwardId = onwardList[onwardIdx]?.searchId
        || extractOnwardSearchId(s1.data)
        || onwardList[0]?.searchId;
      if (!onwardId) throw new Error(`no onward ${brief(s1.data)}`);

      const refined = { ...body, selection: { selectedSearchIds: [onwardId] } };
      let s2 = await flight.search(refined);
      for (let i = 0; i < 12; i += 1) {
        if (optionsOf(s2.data, 'RETURN').length) break;
        await sleep(2000);
        s2 = await flight.search(refined);
      }
      const retId = extractReturnSearchId(s2.data)
        || optionsOf(s2.data, 'RETURN').find((o) => o.searchId !== onwardId)?.searchId;
      if (!retId) throw new Error(`no return ${brief(s2.data)}`);
      const searchIds = [onwardId, retId];

      const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
      if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
        throw new Error(`pricing incomplete ${brief(pricing.data)}`);
      }

      const ssr = await flight.getSsr(pricing.data.priceId);
      const raw = firstMealRaw(ssr.data);
      const meals = mealsForItinerary(pricing.data, raw);
      return {
        dates: [od, rd],
        searchIds,
        amount: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        meals,
        ssrSample: meals.length ? null : brief(ssr.data, 300),
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('RT prepare failed');
}

async function issue(client, prep, lastName) {
  const payload = buildIssueTicketPayload({
    bookingContext: prep.bookingContext,
    priceId: prep.priceId,
    searchIds: prep.searchIds,
    journeyType: 'ROUND_TRIP',
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName,
      gender: 'Male',
      dob: '1992-11-18',
      nationality: 'IN',
    },
  });
  if (prep.meals?.length) {
    payload.data.passengers[0].ssr.meals = prep.meals;
  }
  return client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: process.env.FLIGHT_ISSUE_PID || config.partnerId || 'vgm',
      count: 10,
      page: 0,
      perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function poll(flight, br, caseId) {
  const max = ['2b', '3', '5'].includes(caseId) ? 20 : 12;
  const polls = [];
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    const det = await flight.getBookingDetail(br);
    const snap = extractLegs(det.ok ? det : st);
    if (!snap.bookingStatus) snap.bookingStatus = st.data?.status;
    polls.push({
      i: i + 1,
      status: snap.bookingStatus,
      pnrs: snap.pnrs,
      legs: snap.legs,
      at: new Date().toISOString(),
    });
    last = snap;
    last.pollStatuses = polls.map((p) => p.status).filter(Boolean);
    const done = /CONFIRMED|FAILED|CANCELLED/i.test(String(snap.bookingStatus || ''));
    // for half-pending cases, stop early if we already see IN_PROGRESS + onward PNR
    if (caseId === '3' || caseId === '4' || caseId === '5') {
      if (/IN_PROGRESS|PENDING/i.test(String(snap.bookingStatus || '')) && snap.pnrs?.length >= 1) {
        // keep a few more polls for settle signal, then stop
        if (i >= 5) break;
      }
    }
    if (done && i >= 1) break;
    await sleep(4000);
  }
  return { last, polls };
}

async function runCase(flight, client, caseDef) {
  console.log(`\n=== Case ${caseDef.id} ${caseDef.label} lastName=${caseDef.lastName} ===`);
  const prep = await prepareRt(flight);
  console.log('  prepared', prep.dates.join('/'), 'amount', prep.amount, 'meals', prep.meals?.length || 0, prep.searchIds);
  if (!prep.meals?.length) {
    console.log('  WARN no SSR meals — PNQ-DEL may reject issue');
  }
  const bookRes = await issue(client, prep, caseDef.lastName);
  const br = bookRes.data?.bookingReference || bookRes.data?.bookingReferenceId || null;
  console.log('  issue', bookRes.status, 'br', br, 'status', bookRes.data?.status, 'code', bookRes.data?.error?.code);
  if (!br) {
    const code = bookRes.data?.error?.code || null;
    // VALIDATION_ERROR (e.g. missing meal) is infrastructure — not a surname-sim result
    const isSimFail = /FAIL/i.test(caseDef.lastName) && code && code !== 'VALIDATION_ERROR';
    return {
      ...caseDef,
      http: bookRes.status,
      code,
      br: null,
      verdict: isSimFail ? 'PASS' : (code === 'VALIDATION_ERROR' ? 'NOT TESTED' : 'BUG'),
      note: code === 'VALIDATION_ERROR' ? 'blocked by issue validation (not surname sim)' : 'no BR on issue',
      responseSnippet: brief(bookRes.data, 800),
      checks: [{
        rule: 'issue response',
        status: isSimFail ? 'PASS' : (code === 'VALIDATION_ERROR' ? 'NOT TESTED' : 'BUG'),
        actual: brief(bookRes.data, 200),
      }],
    };
  }
  await sleep(2000);
  const { last, polls } = await poll(flight, br, caseDef.id);
  const scored = scoreCase(caseDef, last || {});
  console.log('  final', last?.bookingStatus, 'pnrs', last?.pnrs, '=>', scored.verdict);
  return {
    ...caseDef,
    dates: prep.dates,
    amount: prep.amount,
    http: bookRes.status,
    br,
    issueStatus: bookRes.data?.status,
    finalStatus: last?.bookingStatus,
    message: last?.message,
    pnrs: last?.pnrs,
    legs: last?.legs,
    polls,
    responseSnippet: brief(bookRes.data, 600),
    ...scored,
  };
}

async function main() {
  process.env.BASE_URL = BASE;
  clearSession();
  console.log('BASE', BASE, 'route', `${ORIGIN}-${DEST}-${ORIGIN}`, 'fare', FARE);

  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const rows = [];

  for (const c of CASES) {
    try {
      rows.push(await runCase(flight, session.client, c));
    } catch (e) {
      console.log('  ERROR', e.message);
      rows.push({
        ...c,
        verdict: 'BUG',
        error: e.message,
        checks: [{ rule: 'prepare+book', status: 'BUG', actual: e.message }],
      });
    }
    await sleep(2000);
  }

  const summary = {
    PASS: rows.filter((r) => r.verdict === 'PASS').length,
    BUG: rows.filter((r) => r.verdict === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.verdict === 'NOT TESTED').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    base: BASE,
    partnerId: config.partnerId,
    tierId: config.tierId,
    route: `${ORIGIN}-${DEST} RT`,
    fareType: FARE,
    summary,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const md = [
    `# ak-api PNQ–DEL RT surname sims`,
    ``,
    `- Ran: ${report.ranAt}`,
    `- Base: ${BASE}`,
    `- Route: **${ORIGIN} ↔ ${DEST}** · fareType ${FARE}`,
    `- Summary: **${summary.PASS} PASS / ${summary.BUG} BUG / ${summary.NOT_TESTED} NOT TESTED**`,
    ``,
    `| # | Case | lastName | Verdict | BR | Status | PNRs | Notes |`,
    `|---|------|----------|---------|----|--------|------|-------|`,
    ...rows.map((r) => {
      const notes = r.note || r.error || (r.checks || []).filter((c) => c.status === 'BUG').map((c) => c.rule).join('; ') || r.expect || '';
      return `| ${r.id} | ${r.label} | ${r.lastName} | **${r.verdict}** | ${r.br || ''} | ${r.finalStatus || r.issueStatus || ''} | ${(r.pnrs || []).join(',') || '—'} | ${String(notes).replace(/\|/g, '/').slice(0, 100)} |`;
    }),
    ``,
  ].join('\n');
  fs.writeFileSync(MD, md);
  console.log('\n=== SUMMARY ===', summary);
  console.log('Wrote', OUT);
  console.log('Wrote', MD);
  if (summary.BUG) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

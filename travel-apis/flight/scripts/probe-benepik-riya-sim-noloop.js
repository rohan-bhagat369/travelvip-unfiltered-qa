/**
 * Benepik Riya simulator pack — NO retry loops.
 * BASE_URL=https://dev-benepik-api.travelvip.ai + staging partner creds (.env).
 *
 * Routes (sim): PNQ-DEL, PNQ-DXB, DXB-LHR · user asked also DEL-PNQ.
 * BOM-DEL → expect [SIM-NO-RECORDING]
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  buildSeatMapPassengers,
  extractFirstSearchId,
  extractOnwardSearchId,
  extractReturnSearchId,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT_JSON = path.join('travel-apis', 'flight', 'reports', 'benepik-riya-sim-noloop.json');
const OUT_MD = path.join('travel-apis', 'flight', 'reports', 'benepik-riya-sim-noloop.md');
const BASE = 'https://dev-benepik-api.travelvip.ai';

function brief(d, n = 900) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d);
  }
}

function optionsOf(data, direction = 'ONWARD') {
  const block = (data?.results || []).find((r) => String(r.direction).toUpperCase() === direction)
    || data?.results?.[0];
  return block?.options || [];
}

function row(id, how, status, detail = {}) {
  return { id, how, status, ...detail, at: new Date().toISOString() };
}

/** Simulator is instant — max 3 polls, no long loop. */
async function searchOnce(flight, body, { maxPolls = 3 } = {}) {
  let last = null;
  for (let i = 0; i < maxPolls; i += 1) {
    last = await flight.search(body);
    const opts = optionsOf(last.data).length;
    const err = last.data?.error?.code || last.data?.error?.message;
    const state = last.data?.progress?.state;
    if (opts > 0 || err || state === 'COMPLETE' || (last.status >= 400 && last.status < 500)) {
      return { response: last, polls: i + 1 };
    }
    await sleep(last.data?.progress?.pollAfterMs || 2000);
  }
  return { response: last, polls: maxPolls };
}

async function waitStatusShort(flight, br, max = 8) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (isTerminalBookingStatus(st)) return { status: st, polls: i + 1, data: last.data };
    if (/inprogress/i.test(st) && i >= 2) return { status: st, polls: i + 1, data: last.data, stop: 'NO_LOOP_INPROGRESS' };
    await sleep(2000);
  }
  return { status: last?.data?.status || 'UNKNOWN', polls: max, data: last?.data };
}

async function priceBookFlow(flight, client, {
  label,
  origin,
  destination,
  fareType = 'NORMAL',
  journey = 'ONE_WAY',
  lastName = 'Smith',
  intlPassport = false,
  doSeatMap = false,
  doFareRules = false,
  doBook = false,
  doCancel = false,
}) {
  const steps = [];
  const body = journey === 'ROUND_TRIP'
    ? buildRoundTripSearchBody(25, 32, { origin, destination, fareType, maxStops: null })
    : buildOneWaySearchBody(25, { origin, destination, fareType, maxStops: null });
  body.travellers = { adults: 1, children: 0, infants: 0 };
  body.preferences.refundableOnly = false;

  const { response: searchRes, polls } = await searchOnce(flight, body);
  const opts = optionsOf(searchRes.data);
  const searchId = extractFirstSearchId(searchRes.data) || opts[0]?.searchId;
  steps.push({
    api: 'POST /v1/flights/search',
    req: { itinerary: body.itinerary, fareType, journeyType: body.journeyType },
    http: searchRes.status,
    polls,
    optCount: opts.length,
    err: searchRes.data?.error || null,
    sample: brief(searchRes.data, 500),
  });

  if (!searchId) {
    return { label, ok: false, reason: 'no searchId', steps };
  }

  let searchIds = [searchId];
  if (journey === 'ROUND_TRIP') {
    const onward = extractOnwardSearchId(searchRes.data) || searchId;
    const refined = { ...body, selection: { selectedSearchIds: [onward] } };
    const retRes = await flight.search(refined);
    const retId = extractReturnSearchId(retRes.data)
      || optionsOf(retRes.data, 'RETURN').find((o) => o.searchId && o.searchId !== onward)?.searchId;
    steps.push({
      api: 'POST /v1/flights/search (return select)',
      req: { selectedSearchIds: [onward] },
      http: retRes.status,
      returnOpts: optionsOf(retRes.data, 'RETURN').length,
      err: retRes.data?.error || null,
    });
    if (!retId) return { label, ok: false, reason: 'no return searchId', steps, searchIds: [onward] };
    searchIds = [onward, retId];
  }

  if (doFareRules) {
    const fr = await flight.getFareRules(searchIds, journey);
    steps.push({
      api: 'POST /v1/flights/fareRules',
      req: { searchIds, journeyType: journey },
      http: fr.status,
      ok: fr.ok,
      err: fr.data?.error || null,
      sample: brief(fr.data, 400),
    });
  }

  const pricing = await flight.getPricing(searchIds, journey);
  steps.push({
    api: 'POST /v1/flights/pricing',
    req: { searchIds, journeyType: journey },
    http: pricing.status,
    priceId: pricing.data?.priceId || null,
    bookingContext: Boolean(pricing.data?.bookingContext),
    total: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
    fareCategory: pricing.data?.fareCategory || pricing.data?.pricing?.fareCategory,
    err: pricing.data?.error || null,
    sample: brief(pricing.data, 500),
  });

  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    return { label, ok: false, reason: 'pricing incomplete', steps, searchIds };
  }

  if (doSeatMap) {
    const sm = await flight.getSeatMap(pricing.data.bookingContext, buildSeatMapPassengers(), 1);
    steps.push({
      api: 'POST /v1/flights/seatmap',
      req: { requestReference: '(bookingContext)', passengers: 1 },
      http: sm.status,
      ok: sm.ok || sm.status < 500,
      err: sm.data?.error || null,
      sample: brief(sm.data, 400),
    });
  }

  if (!doBook) {
    return { label, ok: true, steps, searchIds, pricing: steps.find((s) => s.api.includes('pricing')) };
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds,
    journeyType: journey,
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName,
      gender: 'Male',
      dob: '1992-11-18',
      nationality: 'IN',
    },
  });
  if (intlPassport) {
    payload.data.passportType = 'FULL';
    payload.data.passengers[0].passport = {
      number: 'M7654321',
      expiry: '2031-06-30',
      issuedDate: '2021-03-01',
      issuedCountryCode: 'IN',
    };
  }

  const issue = await client.request({
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
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  steps.push({
    api: 'POST /api/v2/flights/booking/issue-ticket',
    req: { lastName, journeyType: journey, searchIds },
    http: issue.status,
    br: br || null,
    issueStatus: issue.data?.status,
    err: issue.data?.error || null,
    sample: brief(issue.data, 600),
  });

  if (!br) return { label, ok: false, reason: 'no BR', steps, lastName };

  const st = await waitStatusShort(flight, br, /SLOW|PENDING/i.test(lastName) ? 12 : 6);
  steps.push({
    api: 'GET booking status',
    br,
    status: st.status,
    polls: st.polls,
    stop: st.stop || null,
  });

  let cancelRes = null;
  if (doCancel && /confirm/i.test(String(st.status))) {
    const detail = await flight.getBookingDetail(br);
    const pnr = detail.data?.bookingResponse?.itinerary?.[0]?.pnr
      || detail.data?.bookingResponse?.pnr;
    cancelRes = await flight.cancelV2({
      bookingReference: br,
      type: 'cancel',
      mode: 'ONLINE',
      reason: 'Simulator QA cancel',
    });
    steps.push({
      api: 'POST /api/v2/flight/cancel',
      req: { bookingReference: br },
      http: cancelRes.status,
      err: cancelRes.data?.error || null,
      sample: brief(cancelRes.data, 400),
      pnr,
    });
  }

  return {
    label,
    ok: true,
    lastName,
    br,
    finalStatus: st.status,
    steps,
  };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || BASE;
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  console.log('Base', process.env.BASE_URL, 'partner', config.partnerId, 'NO_LOOP');
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const results = [];
  const cases = [];

  // ——— 1. Search & pricing ———
  // 1a DEL-PNQ (user ask) + fareRules + seatmap + pricing
  {
    const r = await priceBookFlow(flight, client, {
      label: '1a_OW_DEL_PNQ_search_price_rules_seat',
      origin: 'DEL',
      destination: 'PNQ',
      doFareRules: true,
      doSeatMap: true,
      doBook: false,
    });
    const optsOk = (r.steps[0]?.optCount || 0) > 0;
    const priceOk = r.steps.some((s) => s.api.includes('pricing') && s.http >= 200 && s.http < 300 && s.priceId);
    const rulesOk = r.steps.some((s) => s.api.includes('fareRules') && s.http < 500);
    const seatOk = r.steps.some((s) => s.api.includes('seatmap') && (s.ok || s.http < 500));
    const pass = optsOk && priceOk && rulesOk && seatOk;
    results.push(row('1a', 'DEL→PNQ search+price+fareRules+seatmap (once)', pass ? 'PASS' : 'FAIL', { r }));
    cases.push(r);
    console.log('1a', pass ? 'PASS' : 'FAIL', 'opts', r.steps[0]?.optCount);
  }

  // 1b PNQ-DEL official sim route
  {
    const r = await priceBookFlow(flight, client, {
      label: '1b_OW_PNQ_DEL_search_price',
      origin: 'PNQ',
      destination: 'DEL',
      doBook: false,
    });
    const pass = (r.steps[0]?.optCount || 0) > 0 && r.steps.some((s) => s.priceId);
    results.push(row('1b', 'PNQ→DEL search+pricing instantly', pass ? 'PASS' : 'FAIL', { r }));
    cases.push(r);
    console.log('1b', pass ? 'PASS' : 'FAIL');
  }

  // 1c RT PNQ-DEL pair prices
  {
    const r = await priceBookFlow(flight, client, {
      label: '1c_RT_PNQ_DEL_price',
      origin: 'PNQ',
      destination: 'DEL',
      journey: 'ROUND_TRIP',
      doBook: false,
    });
    const pass = r.ok && r.steps.some((s) => s.priceId);
    results.push(row('1c', 'RT PNQ↔DEL pair prices', pass ? 'PASS' : 'FAIL', { r }));
    cases.push(r);
    console.log('1c', pass ? 'PASS' : 'FAIL');
  }

  // 1d BOM-DEL → SIM-NO-RECORDING
  {
    const body = buildOneWaySearchBody(25, { origin: 'BOM', destination: 'DEL', fareType: 'NORMAL', maxStops: null });
    const { response, polls } = await searchOnce(flight, body);
    const blob = JSON.stringify(response.data || {});
    const hit = /SIM-NO-RECORDING|Simulator only replays/i.test(blob);
    results.push(row('1d', 'BOM→DEL expect [SIM-NO-RECORDING]', hit ? 'PASS' : 'FAIL', {
      http: response.status,
      polls,
      err: response.data?.error || null,
      sample: brief(response.data, 600),
    }));
    console.log('1d', hit ? 'PASS' : 'FAIL', brief(response.data?.error || response.data, 200));
  }

  // ——— 2. Corporate & SME ———
  {
    const r = await priceBookFlow(flight, client, {
      label: '2a_CORPORATE_PNQ_DEL_search',
      origin: 'PNQ',
      destination: 'DEL',
      fareType: 'CORPORATE',
      doBook: false,
    });
    const fareCat = r.steps.find((s) => s.api.includes('pricing'))?.fareCategory
      || optionsOf(r.steps[0] && cases.length ? null : null);
    const searchSample = r.steps[0]?.sample || '';
    const hasCorp = /CORPORATE|SME|corporate|sme/i.test(JSON.stringify(r.steps));
    const pass = (r.steps[0]?.optCount || 0) > 0 && r.steps.some((s) => s.priceId);
    results.push(row('2a', 'fareType CORPORATE PNQ-DEL shows flights + prices', pass ? 'PASS' : 'FAIL', {
      hasCorpHint: hasCorp,
      r,
    }));
    cases.push(r);
    console.log('2a', pass ? 'PASS' : 'FAIL', 'corpHint', hasCorp);
  }

  {
    const r = await priceBookFlow(flight, client, {
      label: '2b_CORPORATE_book_Smith',
      origin: 'PNQ',
      destination: 'DEL',
      fareType: 'CORPORATE',
      lastName: 'Smith',
      doBook: true,
      doCancel: true,
    });
    const pass = /confirm/i.test(String(r.finalStatus || ''));
    results.push(row('2b', 'Corporate book lastName=Smith → CONFIRMED (+cancel once)', pass ? 'PASS' : 'FAIL', { r }));
    cases.push(r);
    console.log('2b', pass ? 'PASS' : 'FAIL', r.br, r.finalStatus);
  }

  // ——— 3. Last-name outcomes (one attempt each, no loop) ———
  const lastNames = [
    { ln: 'FAIL', expect: /fail/i, note: 'sold out → Failed' },
    { ln: 'CHANGE', expect: /fail/i, note: 'fare changed → Failed' },
    { ln: 'PENDING', expect: /confirm|inprogress/i, note: 'in progress then confirmed (short poll)' },
    { ln: 'EXPIRED', expect: /fail|confirm/i, note: 'fail once / retry succeeds — NO retry; score first result' },
    { ln: 'SLOW', expect: /confirm|inprogress/i, note: 'confirmed after ~15s' },
    { ln: 'TIMEOUT', expect: /fail/i, note: 'FAILED no booking' },
    { ln: 'SERVERERROR', expect: /fail/i, note: 'FAILED no booking' },
    { ln: 'EMPTY', expect: /fail/i, note: 'FAILED no booking' },
  ];

  for (const { ln, expect, note } of lastNames) {
    const r = await priceBookFlow(flight, client, {
      label: `3_${ln}`,
      origin: 'PNQ',
      destination: 'DEL',
      lastName: ln,
      doBook: true,
      doCancel: false,
    });
    const st = String(r.finalStatus || r.reason || '');
    const noBrFail = !r.br && /fail|TIMEOUT|SERVERERROR|EMPTY/i.test(ln);
    const pass = expect.test(st) || noBrFail || (ln === 'EXPIRED' && (/fail/i.test(st) || /confirm/i.test(st)));
    results.push(row(`3_${ln}`, `lastName=${ln} (${note})`, pass ? 'PASS' : 'FAIL', { r, observed: st }));
    cases.push(r);
    console.log(`3_${ln}`, pass ? 'PASS' : 'FAIL', r.br, st);
  }

  // HALFFAIL RT
  {
    const r = await priceBookFlow(flight, client, {
      label: '3_HALFFAIL_RT',
      origin: 'PNQ',
      destination: 'DEL',
      journey: 'ROUND_TRIP',
      lastName: 'HALFFAIL',
      doBook: true,
    });
    const st = String(r.finalStatus || '');
    // expect partial fail / fail on return — often Failed or Partially*
    const pass = /fail|partial|confirm|inprogress/i.test(st) || Boolean(r.br);
    results.push(row('3_HALFFAIL', 'RT lastName=HALFFAIL return fails', /fail|partial/i.test(st) ? 'PASS' : (pass ? 'NOTE' : 'FAIL'), { r, observed: st }));
    cases.push(r);
    console.log('3_HALFFAIL', st, r.br);
  }

  // PARTIALCANCEL RT — book Smith-like first? Use PARTIALCANCEL last name
  {
    const r = await priceBookFlow(flight, client, {
      label: '3_PARTIALCANCEL_RT',
      origin: 'PNQ',
      destination: 'DEL',
      journey: 'ROUND_TRIP',
      lastName: 'PARTIALCANCEL',
      doBook: true,
      doCancel: true,
    });
    results.push(row('3_PARTIALCANCEL', 'RT lastName=PARTIALCANCEL then cancel', r.br ? 'NOTE' : 'FAIL', { r }));
    cases.push(r);
    console.log('3_PARTIALCANCEL', r.br, r.finalStatus);
  }

  // CANCELFAIL — confirm then cancel should fail
  {
    const r = await priceBookFlow(flight, client, {
      label: '3_CANCELFAIL',
      origin: 'PNQ',
      destination: 'DEL',
      lastName: 'CANCELFAIL',
      doBook: true,
      doCancel: true,
    });
    const cancelStep = (r.steps || []).find((s) => s.api?.includes('cancel'));
    const cancelFailed = cancelStep && (cancelStep.http >= 400 || cancelStep.err || /fail/i.test(JSON.stringify(cancelStep)));
    const pass = /confirm/i.test(String(r.finalStatus || '')) && cancelFailed;
    results.push(row('3_CANCELFAIL', 'lastName=CANCELFAIL confirm then cancel fails', pass ? 'PASS' : 'FAIL', { r }));
    cases.push(r);
    console.log('3_CANCELFAIL', pass ? 'PASS' : 'FAIL', r.br);
  }

  const summary = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    partner: config.partnerId,
    note: 'Riya simulator on Benepik · staging creds · NO_LOOP',
    results,
    cases,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));

  const lines = [
    '# Benepik Riya simulator — no-loop pack',
    '',
    `- **Base:** ${process.env.BASE_URL}`,
    `- **Partner:** ${config.partnerId} (staging creds)`,
    `- **At:** ${summary.at}`,
    `- **Rule:** one attempt per case · no date/name retry`,
    '',
    '| ID | How tested | Status | Evidence |',
    '|---|---|---|---|',
  ];
  for (const r of results) {
    const ev = r.r?.br
      ? `BR ${r.r.br} · ${r.r.finalStatus || r.observed || ''}`
      : (r.sample || r.err && brief(r.err, 120) || r.r?.reason || r.observed || r.http || '—');
    lines.push(`| ${r.id} | ${r.how} | **${r.status}** | ${String(ev).replace(/\|/g, '/').slice(0, 160)} |`);
  }
  const pass = results.filter((x) => x.status === 'PASS').length;
  const fail = results.filter((x) => x.status === 'FAIL').length;
  const note = results.filter((x) => x.status === 'NOTE').length;
  lines.push('', `**Totals:** ${pass} PASS · ${fail} FAIL · ${note} NOTE`);
  lines.push('', `Raw: \`${OUT_JSON}\``);
  fs.writeFileSync(OUT_MD, `${lines.join('\n')}\n`);

  console.log('\nREPORT', OUT_MD);
  console.log(`Totals: ${pass} PASS / ${fail} FAIL / ${note} NOTE`);
  console.log(JSON.stringify(results.map((r) => ({ id: r.id, status: r.status })), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

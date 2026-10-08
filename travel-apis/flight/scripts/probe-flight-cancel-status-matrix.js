/**
 * Flight cancel test cases on staging:
 * TC1 OW cancel (success path)
 * TC2 RT single PNR cancel + booking status
 * TC3 RT two PNRs — cancel first, status, cancel second, status
 * TC4 Airline that returns "waiting for cancellation…" — expect Cancellation Requested + status check
 *
 * Run: node scripts/probe-flight-cancel-status-matrix.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'flight-cancel-status-matrix-staging.json');
const Q = { lang: 'en', currency: 'INR' };

function ok(res) {
  return Boolean(res?.ok || (res?.status >= 200 && res?.status < 300));
}
function brief(d, n = 450) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function airlineOf(opt) {
  return opt?.segments?.[0]?.airline?.code || null;
}
function extractPnrs(detailData) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /pnr/i.test(k) && !v.startsWith('BR') && v.length <= 24) {
        for (const p of String(v).split('|').map((x) => x.trim()).filter(Boolean)) {
          if (!seen.has(p)) { seen.add(p); found.push(p); }
        }
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return found;
}

function cancelStatusOf(body) {
  return body?.data?.cancellationRequest?.status
    || body?.cancellationRequest?.status
    || null;
}
function cancelMsgOf(body) {
  return body?.data?.cancellationRequest?.message
    || body?.cancellationRequest?.message
    || body?.message
    || null;
}
function classifyCancel(res) {
  const raw = JSON.stringify(res?.data || {});
  const st = String(cancelStatusOf(res.data) || '');
  const msg = String(cancelMsgOf(res.data) || '');
  if (/waiting for cancellation/i.test(raw)) {
    return { ok: false, reason: 'WAITING', status: st, message: msg };
  }
  if (/unavailable online|offline cancellation/i.test(raw)) {
    return { ok: false, reason: 'VENDOR_OFFLINE_ONLY', status: st, message: msg };
  }
  if (/^Cancelled$/i.test(st)) return { ok: true, reason: 'CANCELLED', status: st, message: msg };
  if (/Cancellation Requested/i.test(st)) return { ok: true, reason: 'CANCEL_REQUESTED', status: st, message: msg };
  if (/fail/i.test(st)) return { ok: false, reason: 'CANCEL_FAILED', status: st, message: msg };
  if (ok(res) && !/fail/i.test(st)) return { ok: true, reason: 'ACCEPTED', status: st || 'OK', message: msg };
  return { ok: false, reason: 'UNKNOWN', status: st, message: msg || brief(res.data, 180) };
}

async function waitConfirmed(flight, br, max = 6) {
  // ~30s max — if still Pending/InProgress, caller must try different route/date
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  book-status', i + 1, st);
    if (isTerminalBookingStatus(st)) return { status: st, body: last.data };
    await sleep(5000);
  }
  const st = String(last?.data?.status || '');
  return {
    status: st,
    body: last?.data,
    timedOut: true,
    inProgress: /pending|progress/i.test(st),
  };
}

async function pollStatus(flight, br, times = 8, gapMs = 4000) {
  const samples = [];
  for (let i = 0; i < times; i += 1) {
    const st = await flight.getBookingStatus(br);
    samples.push({ at: new Date().toISOString(), status: st.data?.status, http: st.status, body: st.data });
    console.log('  status-poll', i + 1, st.data?.status);
    if (/cancel/i.test(String(st.data?.status || ''))) break;
    await sleep(gapMs);
  }
  return samples;
}

async function cancelCall(client, br, body) {
  const payload = { retryCount: 2, ...body };
  const res = await client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  return {
    endpoint: `POST /v1/flights/booking/${br}/cancel`,
    payload,
    http: res.status,
    response: res.data,
    classified: classifyCancel(res),
  };
}

async function searchOwAirline(flight, code, routes, daysList) {
  const candidates = [];
  for (const [origin, destination] of routes) {
    for (const days of daysList) {
      const body = buildOneWaySearchBody(days, {
        origin, destination, maxStops: 0, fareType: 'NORMAL',
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      body.preferences = { airlines: [code], maxStops: 0, refundableOnly: false };

      let opts = [];
      for (let i = 0; i < 8; i += 1) {
        const s = await flight.search(body);
        const all = [];
        for (const block of s.data?.results || []) {
          for (const opt of block.options || []) all.push(opt);
        }
        opts = all.filter((o) => airlineOf(o) === code && o.searchId);
        const st = String(s.data?.progress?.state || '').toUpperCase();
        if (opts.length && (st === 'COMPLETE' || i >= 2)) break;
        await sleep(1500);
      }
      for (const opt of opts.slice(0, 2)) {
        const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
        if (!ok(pricing) || !pricing.data?.priceId) continue;
        candidates.push({
          origin, destination, days, airline: code,
          searchId: opt.searchId,
          pricing: pricing.data,
          total: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
          flights: (opt.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber}`),
        });
      }
      if (candidates.length >= 10) return candidates;
    }
  }
  return candidates;
}

/** Book OW; if Pending/InProgress too long, try next candidate (different route/date). */
async function bookOwWithFallback(flight, candidates) {
  const skipped = [];
  const skipKeys = new Set(); // route|days after in-progress
  for (const picked of candidates) {
    const key = `${picked.origin}-${picked.destination}|${picked.days}`;
    if (skipKeys.has(key)) continue;

    console.log('Try OW', picked.airline, `${picked.origin}-${picked.destination}`, 'd' + picked.days, picked.total, picked.flights);
    const issue = await flight.issueTicket({
      bookingContext: picked.pricing.bookingContext,
      priceId: picked.pricing.priceId,
      searchIds: [picked.searchId],
      journeyType: 'ONE_WAY',
    });
    const br = issue.data?.bookingReference;
    if (!br) {
      console.log('  issue fail', brief(issue.data, 150));
      if (/INSUFFICIENT|wallet|balance/i.test(brief(issue.data))) {
        return { error: 'wallet', snippet: brief(issue.data) };
      }
      skipped.push({ reason: 'issue failed', snippet: brief(issue.data, 120) });
      continue;
    }
    const wait = await waitConfirmed(flight, br, 6);
    if (!/confirm/i.test(String(wait.status))) {
      console.log('  LEAVE in-progress/failed — try different route/date:', wait.status, br);
      skipped.push({ br, status: wait.status, reason: 'in_progress_try_next_route_date', key });
      skipKeys.add(key); // don't retry same route/date
      continue;
    }
    const detail = await flight.getBookingDetail(br);
    return {
      br,
      status: wait.status,
      pnrs: extractPnrs(detail.data),
      total: picked.total,
      airline: picked.airline,
      route: `${picked.origin}-${picked.destination}`,
      flights: picked.flights,
      skipped,
    };
  }
  return { error: 'no confirmed OW after trying alternatives', skipped };
}

async function bookRt(flight, { preferMixed = false, preferSame = false, airlines = [] } = {}) {
  const routes = [['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'HYD']];
  const windows = [[21, 28], [28, 35], [35, 42], [40, 47]];
  const skipped = [];

  for (const [origin, destination] of routes) {
    for (const [od, rd] of windows) {
      const body = buildRoundTripSearchBody(od, rd, {
        origin, destination, maxStops: null, fareType: 'NORMAL',
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      body.preferences = {
        airlines: airlines.length ? airlines : [],
        maxStops: null,
        refundableOnly: false,
      };
      delete body.preferences.maxStops;

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('RT search fail', origin, destination, e.message);
        continue;
      }
      const blocks = searchRes.response?.data?.results || [];
      let onward = (blocks.find((r) => /ONWARD/i.test(r.direction)) || {}).options || [];
      let ret = (blocks.find((r) => /RETURN/i.test(r.direction)) || {}).options || [];
      if (airlines.length) {
        const filt = (list) => list.filter((o) => airlines.includes(airlineOf(o)));
        const o2 = filt(onward);
        const r2 = filt(ret);
        if (o2.length) onward = o2;
        if (r2.length) ret = r2;
      }

      const candidates = [];
      for (const o of onward.slice(0, 8)) {
        for (const r of ret.slice(0, 8)) {
          if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
          const ao = airlineOf(o);
          const ar = airlineOf(r);
          const mixed = ao && ar && ao !== ar;
          const same = ao && ar && ao === ar;
          if (preferMixed && !mixed) continue;
          if (preferSame && !same) continue;
          candidates.push({ o, r, ao, ar, mixed, same });
        }
      }
      candidates.sort((a, b) => {
        if (preferMixed) return (b.mixed - a.mixed);
        if (preferSame) return (b.same - a.same);
        return 0;
      });

      // After in-progress on a pair, jump to next date window / route (don't hammer same window)
      let leaveWindow = false;
      for (const cand of candidates.slice(0, 12)) {
        if (leaveWindow) break;
        const pricing = await flight.getPricing([cand.o.searchId, cand.r.searchId], 'ROUND_TRIP');
        if (!ok(pricing) || !pricing.data?.priceId) continue;
        console.log('Try RT', cand.ao, cand.ar, `${origin}-${destination}`, od, rd);
        const issue = await flight.issueTicket({
          bookingContext: pricing.data.bookingContext,
          priceId: pricing.data.priceId,
          searchIds: [cand.o.searchId, cand.r.searchId],
          journeyType: 'ROUND_TRIP',
        });
        const br = issue.data?.bookingReference;
        if (!br) {
          if (/INSUFFICIENT|wallet|balance/i.test(brief(issue.data))) {
            return { error: 'wallet', snippet: brief(issue.data), skipped };
          }
          skipped.push({ reason: 'issue failed', snippet: brief(issue.data, 100) });
          continue;
        }
        const wait = await waitConfirmed(flight, br, 6);
        if (!/confirm/i.test(String(wait.status))) {
          console.log('  LEAVE RT in-progress/failed — try different route/date:', wait.status, br);
          skipped.push({ br, status: wait.status, reason: 'in_progress_try_next_route_date', route: `${origin}-${destination}`, days: [od, rd] });
          leaveWindow = true; // next od/rd or route
          continue;
        }
        const detail = await flight.getBookingDetail(br);
        const pnrs = extractPnrs(detail.data);
        return {
          br,
          status: wait.status,
          pnrs,
          airlines: [cand.ao, cand.ar],
          mixed: cand.mixed,
          route: `${origin}-${destination}-${origin}`,
          days: [od, rd],
          total: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
          onward: (cand.o.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber}`),
          return: (cand.r.segments || []).map((s) => `${s.airline?.code} ${s.flightNumber}`),
          skipped,
        };
      }
    }
  }
  return { error: 'no confirmed RT after trying alternatives', skipped };
}

function verdict(tc, pass, note) {
  return { tc, pass, note };
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const results = [];
  const report = {
    baseUrl: config.baseUrl,
    generatedAt: new Date().toISOString(),
    cases: {},
  };

  // ───────── TC1: OW cancel ─────────
  console.log('\n########## TC1 OW cancel ##########');
  {
    let candidates = await searchOwAirline(flight, 'SG', [['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'HYD']], [21, 28, 35]);
    if (!candidates.length) {
      candidates = await searchOwAirline(flight, 'AI', [['DEL', 'BOM'], ['BOM', 'DEL']], [35, 42, 50]);
    }
    if (!candidates.length) {
      report.cases.TC1 = { status: 'NOT TESTED', reason: 'no OW inventory' };
      results.push(verdict('TC1', false, 'no inventory'));
    } else {
      const booked = await bookOwWithFallback(flight, candidates);
      if (booked.error) {
        report.cases.TC1 = { status: 'BUG', book: booked };
        results.push(verdict('TC1', false, booked.error));
      } else {
        const pnr = booked.pnrs[0];
        const penalty = await cancelCall(client, booked.br, pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' });
        const cancel = await cancelCall(client, booked.br, pnr ? { action: 'CANCEL', pnr } : { action: 'CANCEL' });
        const statusSamples = await pollStatus(flight, booked.br, 10, 4000);
        const finalStatus = statusSamples[statusSamples.length - 1]?.status;
        const cancelOk = cancel.classified.reason === 'CANCELLED'
          || cancel.classified.reason === 'CANCEL_REQUESTED'
          || cancel.classified.ok;
        const pass = cancelOk;

        report.cases.TC1 = {
          status: pass ? 'PASS' : 'BUG',
          goal: 'OW cancellation succeeds; check booking status',
          book: booked,
          penalty,
          cancel,
          statusSamples: statusSamples.map((s) => ({ at: s.at, status: s.status })),
          finalBookingStatus: finalStatus,
        };
        results.push(verdict('TC1', pass, `cancel=${cancel.classified.status} bookingStatus=${finalStatus}`));
      }
    }
  }

  // ───────── TC2: RT single PNR ─────────
  console.log('\n########## TC2 RT single PNR cancel ##########');
  {
    // Same airline RT often yields 1 PNR (try SG or AI)
    let rt = await bookRt(flight, { preferSame: true, airlines: ['SG'] });
    if (rt.error || (rt.pnrs && rt.pnrs.length !== 1)) {
      console.log('SG same RT not 1 PNR', rt.pnrs || rt.error);
      rt = await bookRt(flight, { preferSame: true, airlines: ['AI'] });
    }
    if (rt.error || !rt.br) {
      report.cases.TC2 = { status: 'NOT TESTED', reason: rt.error || 'no RT', detail: rt };
      results.push(verdict('TC2', false, rt.error || 'no RT'));
    } else if ((rt.pnrs || []).length !== 1) {
      // still try cancel if 1 pnr unexpectedly; else note and reuse for TC3 if 2
      report.cases.TC2 = {
        status: 'NOT TESTED',
        reason: `expected 1 PNR got ${rt.pnrs?.length}`,
        book: rt,
      };
      results.push(verdict('TC2', false, `pnrCount=${rt.pnrs?.length}`));
      // stash for possible TC3 if 2 pnrs
      report._rtTwoCandidate = (rt.pnrs || []).length >= 2 ? rt : null;
    } else {
      const pnr = rt.pnrs[0];
      const penalty = await cancelCall(client, rt.br, { action: 'PENALTY', pnr });
      const cancel = await cancelCall(client, rt.br, { action: 'CANCEL', pnr });
      const statusSamples = await pollStatus(flight, rt.br, 12, 4000);
      const finalStatus = statusSamples[statusSamples.length - 1]?.status;
      const pass = (cancel.classified.reason === 'CANCELLED' || cancel.classified.ok)
        && (/cancel/i.test(String(finalStatus || '')) || cancel.classified.reason === 'CANCELLED' || cancel.classified.reason === 'CANCEL_REQUESTED');

      report.cases.TC2 = {
        status: pass ? 'PASS' : 'BUG',
        goal: 'RT single PNR cancels successfully; booking status reflects cancel',
        book: rt,
        penalty,
        cancel,
        statusSamples: statusSamples.map((s) => ({ at: s.at, status: s.status })),
        finalBookingStatus: finalStatus,
      };
      results.push(verdict('TC2', pass, `cancel=${cancel.classified.status} bookingStatus=${finalStatus}`));
    }
  }

  // ───────── TC3: RT two PNRs sequential ─────────
  console.log('\n########## TC3 RT two PNR sequential cancel ##########');
  {
    let rt = report._rtTwoCandidate;
    if (!rt) {
      // Mixed airline for 2 PNRs — prefer AI+AI worked before with 2 PNRs; or mixed AI+SG
      rt = await bookRt(flight, { preferSame: true, airlines: ['AI'] });
      if (!rt.br || (rt.pnrs || []).length < 2) {
        rt = await bookRt(flight, { preferMixed: true, airlines: [] });
      }
    }
    if (!rt?.br || (rt.pnrs || []).length < 2) {
      report.cases.TC3 = {
        status: 'NOT TESTED',
        reason: `need 2 PNRs got ${rt?.pnrs?.length || 0}`,
        book: rt,
      };
      results.push(verdict('TC3', false, 'no dual PNR RT'));
    } else {
      const [p1, p2] = rt.pnrs;
      const step1Penalty = await cancelCall(client, rt.br, { action: 'PENALTY', pnr: p1 });
      const step1Cancel = await cancelCall(client, rt.br, { action: 'CANCEL', pnr: p1 });
      const statusAfterFirst = await pollStatus(flight, rt.br, 6, 3500);

      const step2Penalty = await cancelCall(client, rt.br, { action: 'PENALTY', pnr: p2 });
      const step2Cancel = await cancelCall(client, rt.br, { action: 'CANCEL', pnr: p2 });
      const statusAfterSecond = await pollStatus(flight, rt.br, 10, 4000);

      const finalStatus = statusAfterSecond[statusAfterSecond.length - 1]?.status;
      const firstOk = step1Cancel.classified.ok || step1Cancel.classified.reason === 'CANCEL_REQUESTED' || step1Cancel.classified.reason === 'CANCELLED';
      const secondOk = step2Cancel.classified.ok || step2Cancel.classified.reason === 'CANCEL_REQUESTED' || step2Cancel.classified.reason === 'CANCELLED';
      const pass = firstOk && secondOk;

      report.cases.TC3 = {
        status: pass ? 'PASS' : 'BUG',
        goal: 'Cancel PNR1 then PNR2; check booking status after each',
        book: rt,
        step1: {
          pnr: p1,
          penalty: step1Penalty,
          cancel: step1Cancel,
          statusAfter: statusAfterFirst.map((s) => ({ at: s.at, status: s.status })),
        },
        step2: {
          pnr: p2,
          penalty: step2Penalty,
          cancel: step2Cancel,
          statusAfter: statusAfterSecond.map((s) => ({ at: s.at, status: s.status })),
        },
        finalBookingStatus: finalStatus,
      };
      results.push(verdict('TC3', pass, `p1=${step1Cancel.classified.status} p2=${step2Cancel.classified.status} final=${finalStatus}`));
    }
  }

  // ───────── TC4: waiting-for-cancellation airline ─────────
  console.log('\n########## TC4 waiting-for-cancellation airline ##########');
  {
    // Prior matrix: IX returns "waiting for cancellation…"
    let candidates = await searchOwAirline(flight, 'IX', [['DEL', 'BOM'], ['BOM', 'DEL'], ['DEL', 'HYD'], ['BLR', 'DEL']], [28, 35, 42, 50]);
    if (!candidates.length) {
      candidates = await searchOwAirline(flight, '6E', [['DEL', 'BOM'], ['BOM', 'DEL']], [28, 35, 42]);
    }

    if (!candidates.length) {
      report.cases.TC4 = { status: 'NOT TESTED', reason: 'no IX/6E inventory' };
      results.push(verdict('TC4', false, 'no inventory'));
    } else {
      const booked = await bookOwWithFallback(flight, candidates);
      if (booked.error) {
        report.cases.TC4 = { status: 'BUG', book: booked };
        results.push(verdict('TC4', false, booked.error));
      } else {
        const pnr = booked.pnrs[0];
        const penalty = await cancelCall(client, booked.br, pnr ? { action: 'PENALTY', pnr } : { action: 'PENALTY' });
        const cancel = await cancelCall(client, booked.br, pnr ? { action: 'CANCEL', pnr } : { action: 'CANCEL' });
        const statusSamples = await pollStatus(flight, booked.br, 12, 4000);
        const finalStatus = statusSamples[statusSamples.length - 1]?.status;

        const waitingMsg = /waiting for cancellation/i.test(JSON.stringify(cancel.response) + JSON.stringify(penalty.response));
        const cancelReq = /Cancellation Requested/i.test(String(cancel.classified.status || ''));
        const bookingCancelRequested = /cancellation.?requested|cancel/i.test(String(finalStatus || ''));

        let pass = false;
        let note = '';
        if (waitingMsg) {
          pass = cancelReq || bookingCancelRequested;
          note = `got waiting msg; cancelStatus=${cancel.classified.status}; bookingStatus=${finalStatus}`;
          if (!pass) note += ' — expected Cancellation Requested on booking/cancel status';
        } else if (cancel.classified.reason === 'VENDOR_OFFLINE_ONLY') {
          pass = cancelReq || bookingCancelRequested;
          note = `offline-only msg; cancelStatus=${cancel.classified.status}; bookingStatus=${finalStatus}`;
        } else {
          pass = cancelReq || cancel.classified.reason === 'CANCELLED' || bookingCancelRequested;
          note = `did not get waiting msg (airline=${booked.airline}); cancel=${cancel.classified.status}; booking=${finalStatus}`;
        }

        report.cases.TC4 = {
          status: pass ? 'PASS' : 'BUG',
          goal: 'Airline waiting-for-cancellation message → cancel/booking status Cancellation Requested',
          book: booked,
          penalty,
          cancel,
          waitingMessageSeen: waitingMsg,
          statusSamples: statusSamples.map((s) => ({ at: s.at, status: s.status })),
          finalBookingStatus: finalStatus,
          note,
        };
        results.push(verdict('TC4', pass, note));
      }
    }
  }

  delete report._rtTwoCandidate;
  report.results = results;
  report.counts = {
    PASS: results.filter((r) => r.pass).length,
    BUG: results.filter((r) => !r.pass && report.cases[r.tc]?.status === 'BUG').length,
    FAIL_OR_NOT: results.filter((r) => !r.pass).length,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n========== REPORT ==========');
  console.log('| TC | Result | Note |');
  console.log('|----|--------|------|');
  for (const r of results) {
    const st = report.cases[r.tc]?.status || (r.pass ? 'PASS' : 'BUG');
    console.log(`| ${r.tc} | ${st} | ${r.note} |`);
  }
  console.log('Report file:', OUT);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});

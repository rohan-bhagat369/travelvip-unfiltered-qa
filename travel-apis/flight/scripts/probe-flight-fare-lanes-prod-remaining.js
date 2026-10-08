/**
 * Fare lanes — remaining cases on production, minimum hits.
 * One OW search + one domestic RT + one intl RT. No book. No extra fare-type searches.
 *
 *   $env:BASE_URL='https://api.travelvip.ai'
 *   $env:FARE_LANES_SEARCH_ONLY='0'
 *   node scripts/probe-flight-fare-lanes-prod-remaining.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const DAYS = Number(process.env.FARE_LANES_DAYS || '35');
const GAP_MS = Number(process.env.FARE_LANES_GAP_MS || '1500');
const OUT = path.join('reports', 'flight-fare-lanes-prod-remaining.json');
const OUT_MD = path.join('reports', 'flight-fare-lanes-prod-remaining.md');
const SIX = ['NORMAL', 'CORPORATE', 'SME', 'STUDENT', 'DEFENCE', 'SENIOR_CITIZEN'];

const rows = [];
const dumps = { hits: 0, stopped: null };
let client;
let flight;
let rateLimited = false;

function add(id, rule, status, detail = {}) {
  rows.push({ id, rule, status, ...detail });
  const mark = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`  [${mark}] ${id} ${status} — ${rule} (hits=${dumps.hits})`);
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

function cat(f) {
  return String(f?.fareCategory || '').toUpperCase() || null;
}

function categoriesIn(options) {
  return [...new Set((options || []).flatMap((o) => (o.fares || []).map(cat).filter(Boolean)))].sort();
}

function pickFare(options, category) {
  const want = String(category).toUpperCase();
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (cat(f) === want && (f.searchId || opt.searchId)) {
        return { opt, f, searchId: f.searchId || opt.searchId, category: want };
      }
    }
  }
  return null;
}

function limited(res) {
  const code = String(errCode(res) || '');
  return res?.status === 429 || /RATE|TOO_MANY|LIMIT/i.test(code);
}

async function call(fn) {
  if (rateLimited) return { ok: false, status: 429, data: { error: { code: 'RATE_LIMIT_STOPPED' } } };
  await sleep(GAP_MS);
  dumps.hits += 1;
  const res = await fn();
  if (limited(res)) {
    rateLimited = true;
    dumps.stopped = { http: res.status, code: errCode(res), hits: dumps.hits };
    console.log(`  ! rate limit at hit ${dumps.hits}: http=${res.status} code=${errCode(res)}`);
  }
  return res;
}

async function search(body, { page = 0, perpage = 50 } = {}) {
  return call(() => client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page, perpage, sortby: 'fare,asc' },
    body,
    correlation: true,
  }));
}

async function poll(body, { dir = 'ONWARD', max = 8, perpage = 50 } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await search(body, { page: 0, perpage });
    if (!last.ok || rateLimited) return last;
    const done = isSearchProgressComplete(last.data);
    const opts = collectOptions(last.data, dir);
    if (done && (opts.length || i >= 2)) return last;
    const wait = Math.min(Number(last.data?.progress?.pollAfterMs) || 2000, 4000);
    await sleep(wait);
  }
  return last;
}

function slim(res) {
  return { http: res?.status ?? null, code: errCode(res) };
}

async function main() {
  clearSession();
  console.log('=== Fare lanes remaining (prod, minimum hits, no book) ===');
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  client = session.client;
  flight = new FlightService(client);
  dumps.correlationId = client.correlationId;
  dumps.base = process.env.BASE_URL;

  // ── Domestic RT: one search, then D-1 / D-2 selects ──────────────────
  console.log('\n## RT DEL→BOM');
  const rt = buildRoundTripSearchBody(DAYS, DAYS + 7, {
    origin: 'DEL', destination: 'BOM', maxStops: null, fareType: 'NORMAL,SME',
  });
  const rtRes = await poll(rt, { dir: 'ONWARD', max: 8 });
  let onward = collectOptions(rtRes?.data, 'ONWARD');
  if (rtRes?.ok && !rateLimited && !categoriesIn(onward).includes('SME')) {
    const page1 = await search(rt, { page: 1, perpage: 50 });
    onward = onward.concat(collectOptions(page1?.data, 'ONWARD'));
  }
  const smeOn = pickFare(onward, 'SME');
  const normalOn = pickFare(onward, 'NORMAL');
  dumps.rt = {
    http: rtRes?.status,
    state: rtRes?.data?.progress?.state,
    cats: categoriesIn(onward),
    n: onward.length,
    sme: Boolean(smeOn),
    normal: Boolean(normalOn),
  };

  async function selectReturn(pick) {
    const refined = { ...rt, selection: { selectedSearchIds: [pick.searchId] } };
    let last = null;
    for (let i = 0; i < 6; i += 1) {
      last = await search(refined, { perpage: 20 });
      if (!last?.ok || rateLimited) break;
      const ret = collectOptions(last.data, 'RETURN');
      if ((ret.length && isSearchProgressComplete(last.data)) || (isSearchProgressComplete(last.data) && i >= 1)) break;
      await sleep(Math.min(Number(last.data?.progress?.pollAfterMs) || 2000, 4000));
    }
    return {
      onwardCats: categoriesIn(collectOptions(last?.data, 'ONWARD')),
      returnCats: categoriesIn(collectOptions(last?.data, 'RETURN')),
      returnOpts: collectOptions(last?.data, 'RETURN'),
      http: last?.status,
      state: last?.data?.progress?.state,
    };
  }

  let smeFlow = null;
  if (!smeOn) {
    add('D-1', 'RT NORMAL,SME — select SME onward → both dirs SME', 'NOT TESTED', {
      actual: JSON.stringify(dumps.rt),
    });
  } else {
    smeFlow = await selectReturn(smeOn);
    dumps.D1 = { sid: smeOn.searchId, ...smeFlow, returnOpts: undefined, returnN: smeFlow.returnOpts.length };
    const ok = smeFlow.returnOpts.length > 0
      && smeFlow.onwardCats.every((c) => c === 'SME')
      && smeFlow.returnCats.every((c) => c === 'SME')
      && smeFlow.returnCats.length > 0;
    add('D-1', 'RT NORMAL,SME — select SME onward → both dirs SME', ok ? 'PASS' : 'BUG', {
      expected: 'ONWARD+RETURN only SME',
      actual: JSON.stringify(dumps.D1),
    });
  }

  let normalFlow = null;
  if (!normalOn) {
    add('D-2', 'RT — select NORMAL onward → both dirs NORMAL', 'NOT TESTED', {
      actual: JSON.stringify(dumps.rt),
    });
  } else {
    normalFlow = await selectReturn(normalOn);
    dumps.D2 = { sid: normalOn.searchId, ...normalFlow, returnOpts: undefined, returnN: normalFlow.returnOpts.length };
    const ok = normalFlow.returnOpts.length > 0
      && normalFlow.onwardCats.every((c) => c === 'NORMAL')
      && normalFlow.returnCats.every((c) => c === 'NORMAL')
      && normalFlow.returnCats.length > 0;
    add('D-2', 'RT — select NORMAL onward → both dirs NORMAL', ok ? 'PASS' : 'BUG', {
      expected: 'only NORMAL',
      actual: JSON.stringify(dumps.D2),
    });
  }

  const same = (smeFlow?.returnOpts?.length && smeOn)
    ? { on: smeOn, ret: pickFare(smeFlow.returnOpts, 'SME'), label: 'SME' }
    : (normalFlow?.returnOpts?.length && normalOn)
      ? { on: normalOn, ret: pickFare(normalFlow.returnOpts, 'NORMAL'), label: 'NORMAL' }
      : null;
  if (!same?.on?.searchId || !same?.ret?.searchId) {
    add('D-6', 'Same-category RT → pricing succeeds', 'NOT TESTED', { actual: 'no same-category return pair' });
  } else {
    const price = await call(() => flight.getPricing([same.on.searchId, same.ret.searchId], 'ROUND_TRIP'));
    dumps.D6 = { label: same.label, ...slim(price), priceId: price.data?.priceId || null };
    add('D-6', 'Same-category RT → pricing succeeds', price.ok ? 'PASS' : 'BUG', {
      expected: '200', actual: JSON.stringify(dumps.D6),
    });
  }

  const crossOn = smeOn;
  const crossRet = normalFlow?.returnOpts?.length ? pickFare(normalFlow.returnOpts, 'NORMAL') : null;
  if (!crossOn?.searchId || !crossRet?.searchId || crossOn.searchId === crossRet.searchId) {
    add('D-4', 'Cross-category RT pair → pricing INVALID_COMBINATION', 'NOT TESTED', { actual: 'need SME onward + NORMAL return' });
    add('D-5', 'Cross pair → details + fareRules INVALID_COMBINATION', 'NOT TESTED', { actual: 'depends on D-4 ids' });
  } else {
    const price = await call(() => flight.getPricing([crossOn.searchId, crossRet.searchId], 'ROUND_TRIP'));
    dumps.D4 = { ...slim(price) };
    add('D-4', 'Cross-category RT pair → pricing INVALID_COMBINATION',
      price.status === 400 && errCode(price) === 'INVALID_COMBINATION' ? 'PASS' : 'BUG', {
        expected: '400 INVALID_COMBINATION', actual: JSON.stringify(dumps.D4),
      });
    const det = await call(() => flight.getDetails([crossOn.searchId, crossRet.searchId], 'ROUND_TRIP'));
    const rules = await call(() => flight.getFareRules([crossOn.searchId, crossRet.searchId], 'ROUND_TRIP'));
    dumps.D5 = { details: slim(det), rules: slim(rules) };
    const ok = errCode(det) === 'INVALID_COMBINATION' && errCode(rules) === 'INVALID_COMBINATION';
    add('D-5', 'Cross pair → details + fareRules INVALID_COMBINATION', ok ? 'PASS' : 'BUG', {
      expected: 'INVALID_COMBINATION both', actual: JSON.stringify(dumps.D5),
    });
  }

  // ── Intl RT: one search, one select, one price. No date retries. ─────
  console.log('\n## Intl RT DEL→DXB');
  if (rateLimited) {
    add('D-8', 'Intl RT select onward, re-search, price succeeds', 'NOT TESTED', { actual: 'stopped before intl' });
  } else {
    const intl = buildRoundTripSearchBody(DAYS + 5, DAYS + 12, {
      origin: 'DEL', destination: 'DXB', maxStops: null, fareType: 'NORMAL',
    });
    const intlRes = await poll(intl, { dir: 'ONWARD', max: 6 });
    const intlOn = pickFare(collectOptions(intlRes?.data, 'ONWARD'), 'NORMAL');
    if (!intlOn) {
      add('D-8', 'Intl RT select onward, re-search, price succeeds', 'NOT TESTED', {
        actual: `no onward http=${intlRes?.status} state=${intlRes?.data?.progress?.state}`,
      });
    } else {
      const refined = { ...intl, selection: { selectedSearchIds: [intlOn.searchId] } };
      let rr = null;
      for (let i = 0; i < 6; i += 1) {
        rr = await search(refined, { perpage: 20 });
        if (!rr?.ok || rateLimited) break;
        if (collectOptions(rr.data, 'RETURN').length && isSearchProgressComplete(rr.data)) break;
        if (isSearchProgressComplete(rr.data) && i >= 1) break;
        await sleep(Math.min(Number(rr.data?.progress?.pollAfterMs) || 2000, 4000));
      }
      const ret = pickFare(collectOptions(rr?.data, 'RETURN'), 'NORMAL');
      if (!ret) {
        dumps.D8 = { onward: true, returnN: collectOptions(rr?.data, 'RETURN').length, state: rr?.data?.progress?.state };
        add('D-8', 'Intl RT select onward, re-search, price succeeds', 'NOT TESTED', { actual: JSON.stringify(dumps.D8) });
      } else {
        const price = await call(() => flight.getPricing([intlOn.searchId, ret.searchId], 'ROUND_TRIP'));
        dumps.D8 = slim(price);
        add('D-8', 'Intl RT select onward, re-search, price succeeds', price.ok ? 'PASS' : 'BUG', {
          expected: '200 pricing', actual: JSON.stringify(dumps.D8),
        });
      }
    }
  }

  // ── One OW search for E hops. Reuse ids. No per-type searches. ───────
  console.log('\n## OW hops from one search');
  const hops = {};
  if (rateLimited) {
    for (const id of ['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-7']) {
      add(id, 'downstream hop', 'NOT TESTED', { actual: 'rate limit before OW' });
    }
  } else {
    const ow = buildOneWaySearchBody(DAYS, {
      origin: 'DEL', destination: 'BOM', maxStops: null, fareType: SIX.join(','),
    });
    const owRes = await poll(ow, { max: 8, perpage: 50 });
    let owOpts = collectOptions(owRes?.data, 'ONWARD');
    if (owRes?.ok && !rateLimited && SIX.some((t) => !categoriesIn(owOpts).includes(t))) {
      const page1 = await search(ow, { page: 1, perpage: 50 });
      owOpts = owOpts.concat(collectOptions(page1?.data, 'ONWARD'));
    }
    const picks = {};
    for (const token of SIX) picks[token] = pickFare(owOpts, token);
    dumps.ow = { http: owRes?.status, state: owRes?.data?.progress?.state, cats: categoriesIn(owOpts), n: owOpts.length };

    async function hop(token) {
      if (hops[token]) return hops[token];
      const pick = picks[token];
      if (!pick || rateLimited) {
        hops[token] = { token, status: 'NOT TESTED' };
        return hops[token];
      }
      const det = await call(() => flight.getDetails([pick.searchId], 'ONE_WAY'));
      const price = await call(() => flight.getPricing([pick.searchId], 'ONE_WAY'));
      const rules = await call(() => flight.getFareRules([pick.searchId], 'ONE_WAY'));
      const ok = det.ok && price.ok && (rules.ok || errCode(rules) === 'VENDOR_ERROR');
      hops[token] = {
        token,
        status: ok ? 'PASS' : 'BUG',
        det: det.status,
        price: price.status,
        rules: rules.status,
        rulesCode: errCode(rules),
        priceId: price.data?.priceId || null,
        bookingContext: price.data?.bookingContext || price.data?.requestReference || null,
        flexi: price.data?.flexiCancelFee ?? price.data?.pricing?.flexiCancelFee ?? null,
        total: price.data?.totalAmount ?? price.data?.pricing?.totalAmount ?? null,
      };
      return hops[token];
    }

    const corp = await hop('CORPORATE');
    add('E-1', 'Corporate searchId → details/pricing/fareRules 200',
      corp.status === 'NOT TESTED' ? 'NOT TESTED' : (corp.status === 'PASS' ? 'PASS' : 'BUG'), {
        expected: 'all 200 (rules may VENDOR_ERROR)', actual: JSON.stringify(corp),
      });

    const norm = picks.NORMAL ? await hop('NORMAL') : null;
    if (!norm) {
      add('E-2', 'Normal fare pricing 200', 'NOT TESTED', { actual: 'no NORMAL in the one search' });
    } else if (corp.status === 'PASS' && norm.status !== 'NOT TESTED' && norm.total != null && corp.total != null) {
      add('E-2', 'Normal fare pricing 200', norm.price === 200 ? 'PASS' : 'BUG', {
        actual: JSON.stringify({ normal: norm.total, corporate: corp.total, price: norm.price }),
      });
    } else {
      add('E-2', 'Normal fare pricing 200', norm.price === 200 ? 'PASS' : 'BUG', {
        actual: JSON.stringify({ price: norm.price, status: norm.status }),
      });
    }

    const e3 = [];
    for (const token of SIX) {
      if (!picks[token]) {
        e3.push({ token, status: 'NOT TESTED', reason: 'absent from the one OW search' });
        continue;
      }
      e3.push(await hop(token));
    }
    dumps.E3 = e3.map(({ bookingContext, ...rest }) => rest);
    const bugs = e3.filter((x) => x.status === 'BUG');
    const tested = e3.filter((x) => x.status !== 'NOT TESTED');
    add('E-3', 'Six fare types through details/pricing/fareRules (no extra searches)',
      bugs.length ? 'BUG' : (tested.length === 6 ? 'PASS' : (tested.length ? 'PASS' : 'NOT TESTED')), {
        expected: '200 for each type present in the one search',
        actual: JSON.stringify(dumps.E3),
        note: tested.length < 6 ? `${6 - tested.length} type(s) not in this search — not a second search` : undefined,
      });

    const sme = picks.SME ? hops.SME : null;
    if (!sme || sme.status === 'NOT TESTED') {
      add('E-4', 'SME → fareRules (corporate rules branch)', 'NOT TESTED', { actual: 'no SME in the one search' });
      add('E-5', 'SME pricing flexiCancelFee is 0', 'NOT TESTED', { actual: 'no SME' });
    } else {
      add('E-4', 'SME → fareRules (corporate rules branch)',
        sme.rules === 200 || sme.rulesCode === 'VENDOR_ERROR' ? 'PASS' : 'BUG', {
          expected: '200 or VENDOR_ERROR', actual: `http=${sme.rules} code=${sme.rulesCode}`,
        });
      add('E-5', 'SME pricing flexiCancelFee is 0',
        sme.price === 200 && (sme.flexi == null || Number(sme.flexi) === 0) ? 'PASS' : 'BUG', {
          expected: 'flexiCancelFee 0 or absent', actual: `flexi=${sme.flexi} http=${sme.price}`,
        });
    }

    const priced = [hops.NORMAL, hops.CORPORATE].find((h) => h?.priceId);
    if (!priced || rateLimited) {
      add('E-7', 'ssr + seatmap on priced selection', 'NOT TESTED', { actual: priced ? 'rate limit' : 'no priceId' });
    } else {
      const ssr = await call(() => flight.getSsr(priced.priceId));
      const seat = priced.bookingContext
        ? await call(() => flight.getSeatMap(priced.bookingContext, undefined, 1))
        : { status: null };
      dumps.E7 = { ssr: slim(ssr), seat: slim(seat) };
      const ok = ssr.status && ssr.status < 500 && seat.status && seat.status < 500;
      add('E-7', 'ssr + seatmap on priced selection', ok ? 'PASS' : 'BUG', {
        expected: 'no 500', actual: JSON.stringify(dumps.E7),
      });
    }
  }

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
    hits: dumps.hits,
    rateLimited,
  };
  const report = { at: new Date().toISOString(), base: process.env.BASE_URL, noBook: true, summary, rows, dumps };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const md = [
    '# Fare lanes — remaining on production (minimum hits, no book)',
    '',
    `- Base: \`${process.env.BASE_URL}\``,
    `- Hits: **${dumps.hits}**${rateLimited ? ' (stopped on rate limit)' : ''}`,
    `- **PASS ${summary.PASS} / BUG ${summary.BUG} / NOT TESTED ${summary.NOT_TESTED}**`,
    '',
    '| # | Id | Rule | Status |',
    '|---|----|------|--------|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.id} | ${r.rule.replace(/\|/g, '/')} | **${r.status}** |`),
  ];
  const bugs = rows.filter((r) => r.status === 'BUG');
  if (bugs.length) {
    md.push('', '## Bugs');
    for (const b of bugs) {
      md.push(`### ${b.id}`, `- Expected: ${b.expected || ''}`, `- Actual: ${b.actual || ''}`);
    }
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log('\n=== SUMMARY ===', summary);
  console.log('Wrote', OUT);
  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

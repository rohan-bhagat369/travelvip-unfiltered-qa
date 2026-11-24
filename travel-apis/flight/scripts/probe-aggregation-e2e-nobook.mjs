/**
 * Aggregation (TBO 402T + Riya 422R) end-to-end up to pricing — NO BOOK — on merged tier 22101801.
 *
 * Exactly 4 searches (looks): OW domestic DEL→BOM, OW international DEL→DXB, RT DEL⇄BOM, RT DEL⇄DXB.
 * Everything else re-uses those searches: pages, onward selection, details, fareRules, pricing, SSR, seatmap,
 * and the negative / boundary cases. Then all cases are scored offline from the saved responses.
 *
 *   node travel-apis/flight/scripts/probe-aggregation-e2e-nobook.mjs capture    # live, once per date pair
 *   node travel-apis/flight/scripts/probe-aggregation-e2e-nobook.mjs evaluate   # offline, zero HTTP
 *
 * Dates default to the pair already warm in the vendor cache from the previous round (2026-12-15 / 2026-12-22).
 * Override with AGG_ONWARD / AGG_RETURN.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const MODE = process.argv[2] || 'evaluate';
const FORCE = process.argv.includes('--force');
const BASE = (process.env.AGG_BASE_URL || 'https://preprod-api.travelvip.ai').replace(/\/$/, '');
const TIER = 22101801;
const TBO = '402T';
const RIYA = '422R';
const VENDORS = [TBO, RIYA];
const ONWARD = process.env.AGG_ONWARD || '2026-12-15';
const RETURN = process.env.AGG_RETURN || '2026-12-22';
const PAGE_SIZE = 50;
const Q = '?lang=en&currency=INR';
const OUT_DIR = path.resolve('travel-apis/flight/reports/aggregation-tbo-riya-preprod');
const CACHE_DIR = path.join(OUT_DIR, `e2e-nobook-${ONWARD}_${RETURN}`);
// hard allowlist — anything that could ticket, book or cancel is unreachable from this script
const ALLOWED = /^\/(auth\/partner\/token|v1\/auth\/session|v1\/flights\/(search|details|fareRules|pricing|ssr|seatmap))(\?|$)/;

const JOURNEYS = [
  { key: 'ow-dom', jt: 'ONE_WAY', o: 'DEL', d: 'BOM', sector: 'domestic' },
  { key: 'ow-intl', jt: 'ONE_WAY', o: 'DEL', d: 'DXB', sector: 'international' },
  { key: 'rt-dom', jt: 'ROUND_TRIP', o: 'DEL', d: 'BOM', sector: 'domestic' },
  { key: 'rt-intl', jt: 'ROUND_TRIP', o: 'DEL', d: 'DXB', sector: 'international' },
];

// ─── shared helpers ───────────────────────────────────────────────
const normFn = (fn) => String(fn || '').toUpperCase().replace(/[\s-]/g, '').replace(/^([A-Z0-9]{2})0+/, '$1');
const minute = (t) => String(t || '').slice(0, 16);
const segKey = (s) => [normFn(s.flightNumber), s.departure?.airportCode, minute(s.departure?.time), s.arrival?.airportCode, minute(s.arrival?.time)].join('|');
const scheduleKey = (o) => (o?.segments || []).map((s) => `${segKey(s)}|${String(s.cabinClass || '').toUpperCase()}`).join('>');
const block = (d, dir) => (d?.results || []).find((r) => String(r.direction).toUpperCase() === dir);
const opts = (d, dir = 'ONWARD') => block(d, dir)?.options || [];
const total = (d, dir = 'ONWARD') => d?.totalResults?.[dir] ?? null;
const optCodes = (o) => new Set((o.fares || []).map((f) => f.sourceCode).filter(Boolean));
const codes = (d, dir = null) => new Set((d?.results || []).filter((r) => !dir || r.direction === dir)
  .flatMap((r) => (r.options || []).flatMap((o) => (o.fares || []).map((f) => f.sourceCode))).filter(Boolean));
const amt = (p) => Number(p?.totalAmount);
const fareAmt = (f) => amt(f?.pricing);
const minFare = (o) => Math.min(...(o.fares || []).map(fareAmt));
const display = (o) => amt(o?.displayPricing?.pricing);
const near = (a, b, tol = 1) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const fmt = (s) => `{${[...s].sort().join(',')}}`;
// "Riya" as a word — base64 blobs contain random "RIyA" runs, which are not a vendor leak
const riyaLeak = (obj) => /(^|[^A-Za-z0-9+/])riya([^A-Za-z0-9+/=]|$)/i.test(JSON.stringify(obj ?? {}));
const sumParts = (p) => ['baseFare', 'taxes', 'convenienceFee', 'flexiCancelFee', 'platformFee']
  .reduce((a, k) => a + (Number(p?.[k]) || 0), 0);
const negPrice = (obj) => {
  const bad = [];
  const walk = (o, at) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && /amount|fare|tax|fee|price/i.test(k) && v < 0) bad.push(`${at}${k}=${v}`);
      else if (v && typeof v === 'object') walk(v, `${at}${k}.`);
    }
  };
  walk(obj, '');
  return bad;
};

// ─── capture ──────────────────────────────────────────────────────
async function capture() {
  if (fs.existsSync(path.join(CACHE_DIR, 'capture.json')) && !FORCE) {
    console.log(`Already captured for ${ONWARD}/${RETURN} → ${CACHE_DIR}\nRefusing a second live run. Use "evaluate" (or --force on purpose).`);
    process.exit(3);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const pmPath = `${process.env.USERPROFILE}/Downloads/B2B preprod.postman_environment.json`;
  const pm = fs.existsSync(pmPath) ? JSON.parse(fs.readFileSync(pmPath, 'utf8')) : { values: [] };
  const getPm = (k) => (pm.values || []).filter((v) => v.key === k && v.value).at(-1)?.value;
  const PARTNER_ID = getPm('partner_id') || process.env.PREPROD_PARTNER_ID || 'vgm';
  const PARTNER_SECRET = getPm('partner_secret') || process.env.PREPROD_PARTNER_SECRET;
  const SIGNING_KEY = getPm('signing_key') || process.env.PREPROD_SIGNING_KEY;
  if (!PARTNER_SECRET || !SIGNING_KEY) throw new Error('preprod partner_secret / signing_key not found');

  const correlationId = crypto.randomUUID();
  const ledger = [];
  let access;
  let auth;

  async function post(pathname, body, tag, { signed = true, useAuth = true } = {}) {
    if (!ALLOWED.test(pathname)) throw new Error(`blocked path ${pathname}`);
    const headers = { 'content-type': 'application/json', 'X-Request-Id': `req-${crypto.randomBytes(8).toString('hex')}`, 'X-Correlation-ID': correlationId };
    if (access) headers['X-Partner-Key'] = access;
    if (auth && useAuth) headers.Authorization = `Bearer ${auth}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (signed && payload) {
      const ts = String(Math.floor(Date.now() / 1000));
      headers['X-Timestamp'] = ts;
      headers['X-Signature'] = crypto.createHmac('sha256', SIGNING_KEY).update(payload + ts).digest('hex');
    }
    const t0 = Date.now();
    const r = await fetch(`${BASE}${pathname}`, { method: 'POST', headers, body: payload });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    const ms = Date.now() - t0;
    ledger.push({ at: new Date(t0).toISOString(), tag, path: pathname.split('?')[0], http: r.status, ms, state: data?.progress?.state || data?.error?.code || null, cacheTimeStamp: data?.cacheTimeStamp ?? null });
    console.log(`  ${tag} ${pathname.split('?')[0]} http=${r.status} ${data?.progress?.state || data?.error?.code || ''} ${ms}ms`);
    return { http: r.status, data, ms, request: body };
  }
  const save = (name, res) => {
    const { refreshToken: _r, ...data } = res.data || {}; // keep tokens out of receipts
    fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), JSON.stringify({ _capture: { http: res.http, ms: res.ms, request: res.request, ...(res.extra || {}) }, ...data }, null, 2));
  };

  const searchBody = (j, selected = []) => ({
    itinerary: j.jt === 'ROUND_TRIP'
      ? [{ origin: j.o, destination: j.d, date: ONWARD }, { origin: j.d, destination: j.o, date: RETURN }]
      : [{ origin: j.o, destination: j.d, date: ONWARD }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY', journeyType: j.jt, currency: 'INR', language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {}, selection: { selectedSearchIds: selected }, fareType: 'NORMAL',
  });
  async function search(tag, b, page = 0, maxPolls = 14) {
    let res;
    let polls = 0;
    for (let i = 1; i <= maxPolls; i += 1) {
      res = await post(`/v1/flights/search${Q}&page=${page}&perpage=${PAGE_SIZE}&sortby=fare,asc`, b, `${tag}#${i}`);
      polls = i;
      const st = res.data?.progress?.state;
      if (res.http >= 400 || !st || st === 'COMPLETE' || st === 'FAILED') break;
      await new Promise((r) => setTimeout(r, res.data?.progress?.pollAfterMs || 2500));
    }
    res.extra = { polls };
    return res;
  }
  const sel = (jt, ids) => ({ journeyType: jt, selection: { selectedSearchIds: ids } });
  const seatPax = [{ paxRefNumber: '1', passengerType: 1, gender: 'Male', title: 'Mr', firstName: 'Aggqa', lastName: 'Nobook' }];

  console.log('=== Aggregation e2e (no book) capture ===', { BASE, TIER, ONWARD, RETURN });
  const tok = await post('/auth/partner/token', { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET }, 'token', { signed: false, useAuth: false });
  access = tok.data?.access_token;
  if (!access) throw new Error(`token failed http=${tok.http}`);
  const s = await post('/v1/auth/session', { tierId: TIER }, 'session', { signed: false, useAuth: false });
  auth = s.data?.auth_token;
  if (!auth) throw new Error(`session failed http=${s.http}`);

  const flows = [];
  for (const j of JOURNEYS) {
    // 1 look per journey
    const base = await search(j.key, searchBody(j));
    save(`${j.key}-search-p0`, base);
    if (j.jt === 'ONE_WAY') { // remaining pages of the same search (cache)
      const pages = Math.ceil((total(base.data) || 0) / PAGE_SIZE);
      for (let p = 1; p < Math.min(pages, 10); p += 1) save(`${j.key}-search-p${p}`, await search(`${j.key}-p${p}`, searchBody(j), p, 1));
    }
    const on = opts(base.data, 'ONWARD');
    const dual = on.find((o) => optCodes(o).size === 2);
    for (const v of VENDORS) {
      // prefer the vendor's fare on a merged (dual) card, else the vendor's cheapest card
      const card = (dual && optCodes(dual).has(v)) ? dual : on.find((o) => optCodes(o).has(v));
      if (!card) { flows.push({ journey: j.key, vendor: v, missing: true }); continue; }
      const fare = [...card.fares].filter((f) => f.sourceCode === v).sort((a, b) => fareAmt(a) - fareAmt(b))[0];
      const flow = { journey: j.key, vendor: v, onwardCard: card.searchId, onwardFare: fare, fromDualCard: card === dual };
      let ids = [fare.searchId];
      if (j.jt === 'ROUND_TRIP') {
        const after = await search(`${j.key}-sel-${v}`, searchBody(j, [fare.searchId]), 0, 6);
        save(`${j.key}-sel-${v}`, after);
        const ret = opts(after.data, 'RETURN')[0];
        const rf = ret ? [...ret.fares].sort((a, b) => fareAmt(a) - fareAmt(b))[0] : null;
        if (!rf) { flow.noReturn = true; flows.push(flow); continue; }
        flow.returnCard = ret.searchId;
        flow.returnFare = rf;
        flow.combined = ret.combinedPricing;
        ids = [fare.searchId, rf.searchId];
      }
      flow.ids = ids;
      const tag = `${j.key}-${v}`;
      save(`${tag}-details`, await post(`/v1/flights/details${Q}`, sel(j.jt, ids), `${tag}-details`));
      save(`${tag}-farerules`, await post(`/v1/flights/fareRules${Q}`, sel(j.jt, ids), `${tag}-farerules`));
      const pr = await post(`/v1/flights/pricing${Q}`, sel(j.jt, ids), `${tag}-pricing`);
      save(`${tag}-pricing`, pr);
      if (pr.data?.priceId) save(`${tag}-ssr`, await post(`/v1/flights/ssr?currency=INR&lang=en`, { priceId: pr.data.priceId }, `${tag}-ssr`));
      if (pr.data?.bookingContext) {
        save(`${tag}-seatmap`, await post(`/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: pr.data.bookingContext, passengers: seatPax }, `${tag}-seatmap`));
      }
      flows.push(flow);
    }
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'flows.json'), JSON.stringify(flows, null, 2));

  // negatives / boundaries — all on searchIds / priceIds from the searches above (no new look)
  const neg = {};
  const f = (j, v) => flows.find((x) => x.journey === j && x.vendor === v && x.ids);
  const owAny = f('ow-intl', TBO) || f('ow-intl', RIYA) || f('ow-dom', RIYA);
  const rtT = f('rt-intl', TBO) || f('rt-dom', TBO);
  const rtR = f('rt-intl', RIYA) || f('rt-dom', RIYA);
  const pricingOf = (fl) => fl && JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${fl.journey}-${fl.vendor}-pricing.json`), 'utf8'));
  const run = async (id, p, body) => { const r = await post(p, body, `NEG-${id}`); neg[id] = { path: p.split('?')[0], request: body, http: r.http, code: r.data?.error?.code || null, message: r.data?.error?.message || null, keys: Object.keys(r.data || {}).slice(0, 8) }; };
  const BAD_ID = 'srch_00000000000000000000000000000000';
  for (const [api, p] of [['details', `/v1/flights/details${Q}`], ['fareRules', `/v1/flights/fareRules${Q}`], ['pricing', `/v1/flights/pricing${Q}`]]) {
    await run(`${api}-empty-ids`, p, sel('ONE_WAY', []));
    await run(`${api}-unknown-id`, p, sel('ONE_WAY', [BAD_ID]));
    await run(`${api}-html-id`, p, sel('ONE_WAY', ['<script>alert(1)</script>']));
  }
  if (owAny) {
    await run('pricing-ow-id-as-RT', `/v1/flights/pricing${Q}`, sel('ROUND_TRIP', owAny.ids));
    await run('pricing-dup-id', `/v1/flights/pricing${Q}`, sel('ONE_WAY', [owAny.ids[0], owAny.ids[0]]));
    await run('pricing-bad-journeyType', `/v1/flights/pricing${Q}`, sel('ONEWAY', owAny.ids));
    await run('details-omit-journeyType', `/v1/flights/details${Q}`, { selection: { selectedSearchIds: owAny.ids } });
  }
  if (rtT) await run('pricing-RT-onward-only', `/v1/flights/pricing${Q}`, sel('ROUND_TRIP', [rtT.ids[0]]));
  if (rtT && rtR) {
    // F-N2: cross-vendor round trip must not be priceable
    await run('pricing-RT-mixed-TBO-onward-Riya-return', `/v1/flights/pricing${Q}`, sel('ROUND_TRIP', [rtT.ids[0], rtR.ids[1]]));
    await run('fareRules-RT-mixed-vendors', `/v1/flights/fareRules${Q}`, sel('ROUND_TRIP', [rtT.ids[0], rtR.ids[1]]));
  }
  await run('ssr-empty-priceId', `/v1/flights/ssr?currency=INR&lang=en`, { priceId: '' });
  await run('ssr-unknown-priceId', `/v1/flights/ssr?currency=INR&lang=en`, { priceId: 'prc_does_not_exist_000' });
  await run('ssr-html-priceId', `/v1/flights/ssr?currency=INR&lang=en`, { priceId: '<b>x</b>' });
  await run('seatmap-omit-requestReference', `/v1/flights/seatmap${Q}`, { currency: 'INR', passengers: seatPax });
  await run('seatmap-garbage-requestReference', `/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: 'not-a-context,', passengers: seatPax });
  const pOw = pricingOf(owAny);
  if (pOw?.bookingContext) await run('seatmap-empty-passengers', `/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: pOw.bookingContext, passengers: [] });
  fs.writeFileSync(path.join(CACHE_DIR, 'negatives.json'), JSON.stringify(neg, null, 2));

  const by = (p) => ledger.filter((l) => l.path === p).length;
  const receipt = {
    capturedAt: new Date().toISOString(), env: BASE, tier: TIER, correlationId, dates: { onward: ONWARD, return: RETURN },
    l2b: {
      looks: JOURNEYS.length, searchHttp: by('/v1/flights/search'), details: by('/v1/flights/details'), fareRules: by('/v1/flights/fareRules'),
      pricing: by('/v1/flights/pricing'), ssr: by('/v1/flights/ssr'), seatmap: by('/v1/flights/seatmap'), booking: 0,
    },
    ledger,
  };
  fs.writeFileSync(path.join(CACHE_DIR, 'capture.json'), JSON.stringify(receipt, null, 2));
  console.log('\nCaptured →', CACHE_DIR, '\nL2B:', receipt.l2b);
}

// ─── evaluate (offline) ───────────────────────────────────────────
function evaluate() {
  if (!fs.existsSync(path.join(CACHE_DIR, 'capture.json'))) { console.log(`No cache at ${CACHE_DIR}; run capture once.`); process.exit(2); }
  const load = (n) => { const p = path.join(CACHE_DIR, `${n}.json`); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  const cap = load('capture');
  const flows = load('flows') || [];
  const neg = load('negatives') || {};
  const rows = [];
  const add = (journey, sec, id, how, status, note = '') => rows.push({ journey, sec, id, how, status, note: String(note ?? '') });
  const ok = (c) => (c ? 'PASS' : 'BUG');

  add('all', 'L2B', 'H1', 'One look per journey (4 searches), same dates', cap.l2b.looks === 4 ? 'PASS' : 'BUG', `${cap.dates.onward} / ${cap.dates.return}`);
  add('all', 'L2B', 'H2', 'No booking / ticketing / cancel endpoint called', cap.l2b.booking === 0 ? 'PASS' : 'BUG',
    `search HTTP ${cap.l2b.searchHttp} · details ${cap.l2b.details} · fareRules ${cap.l2b.fareRules} · pricing ${cap.l2b.pricing} · ssr ${cap.l2b.ssr} · seatmap ${cap.l2b.seatmap}`);
  {
    const pageCalls = cap.ledger.filter((l) => /-p\d+#/.test(l.tag));
    const firsts = Object.fromEntries(JOURNEYS.map((j) => [j.key, load(`${j.key}-search-p0`)?.cacheTimeStamp]));
    const same = pageCalls.every((l) => l.cacheTimeStamp === firsts[l.tag.split('-p')[0]]);
    add('all', 'L2B', 'H3', 'Extra pages served from the same cached search', pageCalls.length ? ok(same) : 'NOT TESTED', `${pageCalls.length} page calls`);
  }

  for (const j of JOURNEYS) {
    const J = j.key;
    const p0 = load(`${J}-search-p0`);
    if (!p0 || p0._capture.http !== 200) { add(J, 'Search', 'S0', 'Search HTTP 200 + COMPLETE', 'BUG', `http=${p0?._capture?.http}`); continue; }
    const pages = [p0];
    for (let p = 1; load(`${J}-search-p${p}`); p += 1) pages.push(load(`${J}-search-p${p}`));
    const on = pages.flatMap((d) => opts(d, 'ONWARD'));
    const re = opts(p0, 'RETURN');
    const all = [...on, ...re];
    add(J, 'Search', 'S0', 'Search HTTP 200, progress COMPLETE', ok(p0.progress?.state === 'COMPLETE'), `polls=${p0._capture.polls} · onward ${total(p0)}${j.jt === 'ROUND_TRIP' ? ` · return ${total(p0, 'RETURN')}` : ''}`);
    const c = codes(p0);
    add(J, 'Search', 'A3', 'Merged tier returns both vendors', ok(c.has(TBO) && c.has(RIYA)), `got ${fmt(c)}`);
    const duals = on.filter((o) => optCodes(o).size === 2);
    add(J, 'Search', 'A4', '∃ card with both vendor fares', ok(duals.length > 0), `${duals.length} of ${on.length} onward cards`);
    const nulls = all.flatMap((o) => o.fares || []).filter((f) => !f.sourceCode).length;
    add(J, 'Search', 'A5', 'No fare without sourceCode', ok(nulls === 0), `nulls=${nulls}`);
    const keys = on.map(scheduleKey);
    add(J, 'Search', 'B1', 'No duplicate flight cards (ONWARD)', ok(new Set(keys).size === keys.length), `${on.length} cards${j.jt === 'ONE_WAY' ? `, ${pages.length} pages` : ', page 0'}`);
    if (j.jt === 'ROUND_TRIP') { const rk = re.map(scheduleKey); add(J, 'Search', 'B1r', 'No duplicate flight cards (RETURN)', ok(new Set(rk).size === rk.length), `${re.length} cards`); }
    const mism = all.filter((o) => !near(display(o), minFare(o), 0.01));
    add(J, 'Search', 'B2', 'Card price = cheapest fare on the card', ok(mism.length === 0), mism.length ? `${mism.length} cards e.g. ${mism[0].searchId} display ${display(mism[0])} vs min ${minFare(mism[0])}` : `${all.length} cards`);
    let nd = true; let prev = -Infinity;
    for (const o of on) { if (minFare(o) < prev - 0.01) { nd = false; break; } prev = minFare(o); }
    add(J, 'Search', 'B6', 'Sorted cheapest-first', ok(nd));
    if (j.jt === 'ONE_WAY') {
      const ids = on.map((o) => o.searchId);
      add(J, 'Search', 'B7', 'Pages concat = totalResults, no repeat', ok(ids.length === total(p0) && new Set(ids).size === ids.length), `${ids.length} vs ${total(p0)}`);
    }
    const badAmt = all.flatMap((o) => o.fares || []).filter((f) => !(fareAmt(f) > 0)).length;
    add(J, 'Search', 'B8', 'Every fare total > 0', ok(badAmt === 0), `bad=${badAmt}`);
    const brk = all.flatMap((o) => o.fares || []).filter((f) => !near(sumParts(f.pricing), fareAmt(f), 1));
    add(J, 'Search', 'PX1', 'Fare breakdown adds up (base+taxes+fees = total)', ok(brk.length === 0), brk.length ? `${brk.length} fares e.g. ${brk[0].searchId} parts ${sumParts(brk[0].pricing)} vs ${fareAmt(brk[0])}` : '');
    const cur = new Set(all.flatMap((o) => (o.fares || []).map((f) => f.pricing?.currency)));
    add(J, 'Search', 'PX2', 'All fares in INR', ok(cur.size === 1 && cur.has('INR')), fmt(cur));
    const ft = all.flatMap((o) => o.fares || []).filter((f) => !f.fareType).length;
    add(J, 'Search', 'C4', 'fareType present on every fare', ok(ft === 0), `missing=${ft}`);
    const sector = on.flatMap((o) => o.segments || []).every((s) => s.departure?.airportCode && s.arrival?.airportCode);
    add(J, 'Search', 'SEG', 'Every segment has airports, times, flight number', ok(sector && on.every((o) => (o.segments || []).every((s) => s.flightNumber && s.departure?.time && s.arrival?.time))));
    const fac = p0.filters?.ONWARD?.airlines ? Object.keys(p0.filters.ONWARD.airlines) : [];
    add(J, 'Search', 'B5', 'Airline filter names case-unique', fac.length ? ok(new Set(fac.map((x) => x.toLowerCase())).size === fac.length) : 'NOT TESTED', `${fac.length} airlines`);
    add(J, 'Search', 'G10', 'No "Riya" text in search response', ok(!pages.some(riyaLeak)));
    {
      const off = {};
      for (const d of pages) {
        for (const r of d.results || []) {
          const [o, dst] = r.direction === 'RETURN' ? [j.d, j.o] : [j.o, j.d];
          for (const op of r.options || []) {
            const a = op.segments?.[0]?.departure?.airportCode;
            const b = op.segments?.at(-1)?.arrival?.airportCode;
            if (a !== o || b !== dst) off[`${a}>${b}`] = (off[`${a}>${b}`] || 0) + 1;
          }
        }
      }
      const n = Object.values(off).reduce((x, y) => x + y, 0);
      add(J, 'Search', 'AP1', `Results use the searched airports only (${j.o}/${j.d})`, n ? 'CHECK' : 'PASS',
        n ? `${n} cards on other airports: ${Object.entries(off).map(([k, v]) => `${k}×${v}`).join(', ')} — confirm nearby-airport results are intended` : '');
    }

    for (const v of VENDORS) {
      const fl = flows.find((x) => x.journey === J && x.vendor === v);
      const V = `${v === TBO ? 'TBO' : 'Riya'} ${v}`;
      if (!fl || fl.missing) { add(J, V, 'F0', `${V} fare available`, 'NOT TESTED', `no ${v} fare in this search`); continue; }
      add(J, V, 'F0', `${V} fare picked`, 'PASS', `${fl.fromDualCard ? 'from merged card' : 'single-vendor card'} · ${fl.onwardFare.fareType} ₹${fareAmt(fl.onwardFare)}`);
      if (j.jt === 'ROUND_TRIP') {
        const after = load(`${J}-sel-${v}`);
        const rc = codes(after, 'RETURN');
        add(J, V, 'C6', 'Return list non-empty after picking onward', fl.noReturn ? 'BUG' : 'PASS', `return total ${total(after, 'RETURN')}`);
        add(J, V, 'C8', 'Return fares only from the onward vendor', ok(rc.size === 1 && rc.has(v)), `got ${fmt(rc)}`);
        if (fl.noReturn) continue;
        const cp = amt(fl.combined?.pricing ?? fl.combined);
        add(J, V, 'C9', 'Return card carries combinedPricing COMBINATION', ok(fl.combined?.type === 'COMBINATION'), fl.combined?.type || 'missing');
        add(J, V, 'C11', 'Combined price ≥ onward fare and ≠ 2× onward', ok(cp >= fareAmt(fl.onwardFare) - 0.01 && !near(cp, 2 * fareAmt(fl.onwardFare), 0.01)), `combined ₹${cp} · onward ₹${fareAmt(fl.onwardFare)} · return fare ₹${fareAmt(fl.returnFare)}`);
      }
      const expected = j.jt === 'ROUND_TRIP' ? amt(fl.combined?.pricing ?? fl.combined) : fareAmt(fl.onwardFare);
      const T = `${J}-${v}`;

      // details
      const det = load(`${T}-details`);
      add(J, V, 'D1', 'Details HTTP 200', ok(det?._capture?.http === 200), `http=${det?._capture?.http} ${det?.error?.code || ''} ${det?.error?.message || ''}`);
      if (det?._capture?.http === 200) {
        const dAmt = amt(det.pricing);
        const dCur = det.pricing?.currency;
        add(J, V, 'D2', 'Details price shown in INR (requested currency=INR)', ok(dCur === 'INR'), `details ${dCur} ${dAmt}${dCur !== 'INR' ? ` · search ₹${expected} · currencyConversion ${JSON.stringify(det.currencyConversion)}` : ''}`);
        add(J, V, 'D2b', 'Details total = search price', dCur === 'INR' ? ok(near(dAmt, expected)) : 'NOT TESTED', dCur === 'INR' ? `search ₹${expected} · details ₹${dAmt}` : 'blocked by D2 (not INR)');
        const card = opts(load(`${J}-search-p0`)).find((o) => o.searchId === fl.onwardCard);
        const want = (card?.segments || []).map(segKey).join('>');
        const got = (det.itinerary?.[0]?.segments || []).map(segKey).join('>');
        add(J, V, 'D3', 'Details onward = same flight as the search card (FN, airports, times)', ok(want === got), want === got ? want : `search ${want} · details ${got}`);
        const pSup = load(`${T}-pricing`)?.passengerOptions?.[0];
        const dSup = det.passengerOptions?.[0];
        if (pSup && dSup) {
          const flags = ['supportsSeats', 'supportsMeals', 'supportsExtraBaggage'];
          const diff = flags.filter((k) => dSup[k] !== pSup[k]);
          add(J, V, 'D6', 'Details and pricing agree on seat / meal / baggage support', diff.length === 0 ? 'PASS' : 'CHECK', diff.map((k) => `${k} details=${dSup[k]} pricing=${pSup[k]}`).join(' · '));
        }
        add(J, V, 'D4', 'No negative amounts in details', ok(negPrice(det).length === 0), negPrice(det).slice(0, 3).join(' '));
        add(J, V, 'D5', 'No "Riya" in details', ok(!riyaLeak(det)));
      }

      // fare rules
      const fr = load(`${T}-farerules`);
      const frHttp = fr?._capture?.http;
      if (frHttp === 200) {
        const txt = JSON.stringify(fr);
        const ruleArr = fr.fareRules || fr.rules || fr.data?.fareRules || fr.journeys || [];
        const hasText = /(cancel|change|refund|reissue|penalt|no.?show|baggage)/i.test(txt);
        add(J, V, 'FR1', 'Fare rules HTTP 200 with rule content', ok(hasText), `${Array.isArray(ruleArr) ? ruleArr.length : 'obj'} rule blocks · top keys ${Object.keys(fr).filter((k) => k !== '_capture').slice(0, 8).join(',')}`);
        const blocks = Array.isArray(fr.fareRules) ? fr.fareRules : [];
        const legs = j.jt === 'ROUND_TRIP' ? 2 : 1;
        add(J, V, 'FR2', `One fare-rule block per leg (${legs})`, ok(blocks.length >= legs), `${blocks.length} block(s): ${blocks.map((b) => b.title).join(' | ')}`);
        const ftName = String(fl.onwardFare.fareType || '').toLowerCase();
        const ltxt = txt.toLowerCase();
        add(J, V, 'FR3', 'Rules match the picked fare (fare type or fare basis named)', ok(ltxt.includes(ftName) || (fl.onwardFare.fareBasisCode && txt.includes(fl.onwardFare.fareBasisCode))), `fareType "${fl.onwardFare.fareType}" · basis ${fl.onwardFare.fareBasisCode || '-'}`);
        const hasFees = /(INR|₹|AED|USD)\s*[\d,]+|non-?refundable|[\d,]+\s*\/-/i.test(blocks.map((b) => String(b.text).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/s+/g, ' ')).join(' '));
        add(J, V, 'FR3b', 'Rules state cancellation / change charges', ok(/cancel/i.test(txt) && hasFees));
        add(J, V, 'FR4', 'No "Riya" in fare rules', ok(!riyaLeak(fr)));
        add(J, V, 'FR5', 'No negative amounts in fare rules', ok(negPrice(fr).length === 0), negPrice(fr).slice(0, 3).join(' '));
        const route = j.jt === 'ROUND_TRIP' ? [j.o, j.d] : [j.o];
        const titled = blocks.every((b, i) => /[A-Z]{3}-[A-Z]{3}/.test(String(b.title)) || String(b.title).includes(route[i] || j.o));
        add(J, V, 'FR7', 'Each rule block titled with its route (which leg it covers)', ok(titled), blocks.map((b) => `"${b.title}"`).join(' '));
        const script = /<script|javascript:|onerror=/i.test(txt);
        add(J, V, 'FR6', 'Rule text has no script content (HTML formatting is allowed)', ok(!script), /<\/?(br|h2|table|p)\b/i.test(txt) ? 'HTML-formatted text' : 'plain text');
      } else {
        const documented = frHttp >= 400 && frHttp < 500 && fr?.error?.code === 'VENDOR_ERROR';
        add(J, V, 'FR1', 'Fare rules HTTP 200 with rule content', documented ? 'BUG' : 'BUG', `http=${frHttp} ${fr?.error?.code || ''} ${fr?.error?.message || ''}`);
      }

      // pricing
      const pr = load(`${T}-pricing`);
      const ph = pr?._capture?.http;
      add(J, V, 'P1', 'Pricing HTTP 200 with priceId + bookingContext', ok(ph === 200 && pr.priceId && pr.bookingContext), `http=${ph} ${pr?.error?.code || ''} ${pr?.error?.message || ''}`);
      if (ph === 200) {
        const pAmt = amt(pr.pricing);
        add(J, V, 'P2', 'Pricing total = search price (±₹1)', ok(near(pAmt, expected)), `search ₹${expected} · pricing ₹${pAmt}${pr.priceChange ? ` · priceChange ${JSON.stringify(pr.priceChange).slice(0, 80)}` : ''}`);
        add(J, V, 'P3', 'Pricing breakdown adds up', ok(near(sumParts(pr.pricing), pAmt, 1)), `parts ₹${sumParts(pr.pricing)} · total ₹${pAmt}`);
        const pax = (pr.passengerOptions || []).map((p) => amt(p.pricing)).filter(Number.isFinite);
        add(J, V, 'P4', '1 ADT passenger price = total', pax.length ? ok(near(pax[0], pAmt)) : 'NOT TESTED', pax.length ? `pax ₹${pax[0]}` : 'no passengerOptions');
        const flagged = pr.priceChange && (pr.priceChange.changed === true || pr.priceChange.isChanged === true);
        add(J, V, 'P5', 'If price differs from search, priceChange says so', near(pAmt, expected) ? 'PASS' : ok(flagged), JSON.stringify(pr.priceChange ?? null).slice(0, 100));
        add(J, V, 'P6', 'Pricing currency INR, no negative amounts', ok(pr.pricing?.currency === 'INR' && negPrice(pr).length === 0), `${pr.pricing?.currency} ${negPrice(pr).slice(0, 2).join(' ')}`);
        add(J, V, 'P7', 'gstBreakup is array or omitted', ok(pr.gstBreakup == null || Array.isArray(pr.gstBreakup)), typeof pr.gstBreakup);
        add(J, V, 'P8', 'No "Riya" in pricing / bookingContext', ok(!riyaLeak(pr)));
        add(J, V, 'P9', 'Pricing itinerary = picked flight(s)', ok(JSON.stringify(pr.itinerary ?? pr).includes(fl.onwardFare.fareBasisCode || '') || normFn(JSON.stringify(pr.itinerary)).includes(normFn(opts(load(`${J}-search-p0`)).find((o) => o.searchId === fl.onwardCard)?.segments?.[0]?.flightNumber))));

        // SSR
        const ssr = load(`${T}-ssr`);
        const sh = ssr?._capture?.http;
        add(J, V, 'SSR1', 'SSR HTTP 200 (meal / baggage catalog up)', ok(sh === 200), `http=${sh} ${ssr?.error?.code || ''} ${ssr?.error?.message || ''}`);
        if (sh === 200) {
          const t = JSON.stringify(ssr);
          const meals = (t.match(/"(meal|meals)"/gi) || []).length;
          const bags = (t.match(/"(baggage|baggages|excessBaggage)"/gi) || []).length;
          add(J, V, 'SSR2', 'SSR lists meal and/or baggage options', ok(meals + bags > 0), `meal keys ${meals} · baggage keys ${bags} · top ${Object.keys(ssr).filter((k) => k !== '_capture').slice(0, 8).join(',')}`);
          add(J, V, 'SSR3', 'SSR prices ≥ 0, no "Riya"', ok(negPrice(ssr).length === 0 && !riyaLeak(ssr)), negPrice(ssr).slice(0, 2).join(' '));
          const curs = new Set((t.match(/"currency"\s*:\s*"([A-Z]{3})"/g) || []).map((m) => m.slice(-4, -1)));
          add(J, V, 'SSR4', 'SSR prices in INR', curs.size ? ok(curs.size === 1 && curs.has('INR')) : 'NOT TESTED', fmt(curs));
        }
        // Seat map
        const sm = load(`${T}-seatmap`);
        const smh = sm?._capture?.http;
        add(J, V, 'SEAT1', 'Seat map HTTP 200 (not 5xx)', smh == null ? 'NOT TESTED' : ok(smh === 200), `http=${smh} ${sm?.error?.code || ''} ${sm?.error?.message || ''}`);
        if (smh === 200) {
          const segsSm = sm.data?.segments || [];
          const seats = segsSm.flatMap((s) => s.seatMap || []);
          const open = seats.filter((s) => ['true', 'open'].includes(String(s.seatAvailability).toLowerCase()));
          const supports = pr.passengerOptions?.[0]?.supportsSeats;
          add(J, V, 'SEAT2', 'Seat map has seats (pricing says supportsSeats)', supports === false ? 'PASS' : ok(seats.length > 0), `${seats.length} seats, ${open.length} available · supportsSeats ${supports}`);
          add(J, V, 'SEAT3', 'Seat prices ≥ 0, no "Riya"', ok(seats.every((s) => !(Number(s.amount) < 0)) && !riyaLeak(sm)));
          add(J, V, 'SEAT3b', 'Seat prices in INR', ok(sm.data?.currency === 'INR'), `${sm.data?.currency} · conversion ${JSON.stringify(sm.currencyConversion)}`);
          const flightSegs = (load(`${T}-details`)?.itinerary || []).flatMap((l) => l.segments || []).length;
          add(J, V, 'SEAT4', 'One seat map per flight segment', flightSegs ? ok(segsSm.length === flightSegs) : 'NOT TESTED', `${segsSm.length} seat maps · ${flightSegs} segments (${segsSm.map((s) => `${s.origin}-${s.destination}`).join(', ')})`);
          const dupSeat = segsSm.some((s) => { const n = (s.seatMap || []).map((x) => x.seatName); return new Set(n).size !== n.length; });
          add(J, V, 'SEAT5', 'No duplicate seat numbers within a segment', ok(!dupSeat));
          const vals = new Set(seats.map((x) => String(x.seatAvailability)));
          add(J, V, 'SEAT6', 'seatAvailability in the common format ("true"/"false") for both providers', ok([...vals].every((x) => x === 'true' || x === 'false')),
            `seatAvailability ${fmt(vals)} · seatStatus ${fmt(new Set(seats.map((x) => String(x.seatStatus))))}`);
        }
      }
    }
  }

  // negatives / boundaries
  const expect4xx = (id, how, extra = () => true) => {
    const n = neg[id];
    if (!n) { add('neg', 'Negative', id, how, 'NOT TESTED', 'not run'); return; }
    const good = n.http >= 400 && n.http < 500 && n.code && extra(n);
    add('neg', 'Negative', id, how, good ? 'PASS' : 'BUG', `http=${n.http} ${n.code || 'no error.code'} ${n.message ? `· ${n.message.slice(0, 90)}` : ''}`);
  };
  for (const api of ['details', 'fareRules', 'pricing']) {
    expect4xx(`${api}-empty-ids`, `${api}: empty selectedSearchIds → 4xx`);
    expect4xx(`${api}-unknown-id`, `${api}: unknown searchId → 4xx (not 500)`);
    expect4xx(`${api}-html-id`, `${api}: HTML in searchId → 4xx (not 500)`);
  }
  expect4xx('pricing-ow-id-as-RT', 'pricing: one-way searchId sent as ROUND_TRIP → 4xx');
  expect4xx('pricing-dup-id', 'pricing: same searchId twice → 4xx');
  expect4xx('pricing-bad-journeyType', 'pricing: journeyType "ONEWAY" → 4xx');
  expect4xx('details-omit-journeyType', 'details: journeyType missing → 4xx');
  expect4xx('pricing-RT-onward-only', 'pricing: round trip with onward id only → 4xx');
  expect4xx('pricing-RT-mixed-TBO-onward-Riya-return', 'pricing: TBO onward + Riya return → rejected (cross-vendor RT not bookable)');
  expect4xx('fareRules-RT-mixed-vendors', 'fareRules: TBO onward + Riya return → rejected');
  expect4xx('ssr-empty-priceId', 'ssr: empty priceId → 4xx');
  expect4xx('ssr-unknown-priceId', 'ssr: unknown priceId → 4xx (not 500)');
  expect4xx('ssr-html-priceId', 'ssr: HTML priceId → 4xx');
  expect4xx('seatmap-omit-requestReference', 'seatmap: requestReference missing → 4xx');
  expect4xx('seatmap-garbage-requestReference', 'seatmap: garbage requestReference → 4xx (not 500)');
  expect4xx('seatmap-empty-passengers', 'seatmap: empty passengers[] → 4xx');

  for (const [id, how] of [['E1', 'One vendor down'], ['E2', 'One vendor slow'], ['E3', 'Both vendors down']]) add('all', 'Not run', id, how, 'NOT TESTED', 'needs Dev fault injection');
  for (const [id, how] of [['F1-F5', 'Issue ticket / book / payment price'], ['D4', 'MULTI_CITY never merged'], ['A1/A2', 'Single-vendor tiers (known open bug)']]) {
    add('all', 'Not run', id, how, 'NOT TESTED', id === 'F1-F5' ? 'no booking on preprod' : id === 'D4' ? '/v1/flights/search accepts ONE_WAY and ROUND_TRIP only' : 'not re-searched to keep looks at 4; open from previous round');
  }

  const summary = { PASS: 0, BUG: 0, CHECK: 0, 'NOT TESTED': 0 };
  for (const r of rows) summary[r.status] += 1;
  const report = { evaluatedAt: new Date().toISOString(), capturedAt: cap.capturedAt, env: cap.env, tier: TIER, dates: cap.dates, l2b: cap.l2b, correlationId: cap.correlationId, summary, rows };
  fs.writeFileSync(path.join(OUT_DIR, `E2E-NOBOOK-RESULTS-${ONWARD}.json`), JSON.stringify(report, null, 2));
  const md = [
    '# Aggregation e2e (search → pricing, SSR, seat map) — no book',
    '',
    `Env \`${cap.env}\` · tier ${TIER} · captured **${cap.capturedAt.slice(0, 16)}Z** · dates **${cap.dates.onward}** / **${cap.dates.return}** · correlation \`${cap.correlationId}\``,
    `Looks: 4 searches · HTTP calls: search ${cap.l2b.searchHttp} (polls/pages/selections) · details ${cap.l2b.details} · fareRules ${cap.l2b.fareRules} · pricing ${cap.l2b.pricing} · ssr ${cap.l2b.ssr} · seatmap ${cap.l2b.seatmap} · booking 0`,
    '',
    `## Summary: ${summary.PASS} PASS · ${summary.BUG} BUG · ${summary.CHECK} CHECK · ${summary["NOT TESTED"]} NOT TESTED`,
    '',
    '| Journey | Area | Case | How tested | Status | Notes |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.journey} | ${r.sec} | ${r.id} | ${r.how.replace(/\|/g, '/')} | **${r.status}** | ${r.note.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 200)} |`),
  ];
  fs.writeFileSync(path.join(OUT_DIR, `E2E-NOBOOK-RESULTS-${ONWARD}.md`), `${md.join('\n')}\n`);
  for (const r of rows) if (r.status !== 'PASS') console.log(`${r.status === 'BUG' ? '✗' : '·'} [${r.journey}] ${r.sec} ${r.id} ${r.status} — ${r.note}`);
  console.log('\nSUMMARY', summary);
}

if (MODE === 'capture') await capture();
else if (MODE === 'evaluate') evaluate();
else { console.log('usage: capture | evaluate'); process.exit(1); }

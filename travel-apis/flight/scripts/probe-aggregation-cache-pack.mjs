/**
 * Flights multi-vendor aggregation (TBO 402T + Riya 422R) — capture once, score from cache.
 *
 * Sources: flights-aggregation-qa-tests (1).md (tiers 22157551 / 8 / 15 / 22101801)
 *          flights-how-results-are-combined.md
 *
 *   node travel-apis/flight/scripts/probe-aggregation-cache-pack.mjs capture   # live, ONE time per date pair
 *   node travel-apis/flight/scripts/probe-aggregation-cache-pack.mjs evaluate  # offline, zero HTTP
 *
 * Look-to-book rules:
 *   - one search per (tier, OD, journey, dates); polls only until progress COMPLETE
 *   - extra pages / selections re-use the same search (cache) — cacheTimeStamp is recorded to prove it
 *   - capture refuses to run again for the same dates unless --force
 *   - only /v1/flights/search | details | pricing are allowed — no ticketing, no cancel, no book
 *
 * Env pins: AGG_ONWARD=YYYY-MM-DD AGG_RETURN=YYYY-MM-DD (default +21 / +28 as per QA doc)
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const MODE = process.argv[2] || 'evaluate';
const FORCE = process.argv.includes('--force');

const BASE = (process.env.AGG_BASE_URL || 'https://preprod-api.travelvip.ai').replace(/\/$/, '');
const MERGED = 22101801;
const TBO_ONLY = 22157551;
const RIYA_8 = 8;
const RIYA_15 = 15;
const TBO = '402T';
const RIYA = '422R';

const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ONWARD = process.env.AGG_ONWARD || plusDays(21);
const RETURN = process.env.AGG_RETURN || plusDays(28);

const OUT_DIR = path.resolve('travel-apis/flight/reports/aggregation-tbo-riya-preprod');
const CACHE_DIR = path.join(OUT_DIR, `cache-${ONWARD}_${RETURN}`);
const MAX_SELECTIONS_RT_MERGED = 8;
const PAGE_SIZE = 50;
const ALLOWED_PATHS = /^\/(auth\/partner\/token|v1\/auth\/session|v1\/tiers|v1\/flights\/(search|details|pricing))(\?|$)/;

// ─── shared helpers ───────────────────────────────────────────────
const normFn = (fn) => String(fn || '').toUpperCase().replace(/[\s-]/g, '').replace(/^([A-Z0-9]{2})0+/, '$1');
const minute = (t) => String(t || '').slice(0, 16);
const scheduleKey = (o) => (o?.segments || []).map((s) => [
  normFn(s.flightNumber),
  s.departure?.airportCode || '',
  minute(s.departure?.time),
  s.arrival?.airportCode || '',
  minute(s.arrival?.time),
  String(s.cabinClass || '').toUpperCase(),
].join('|')).join('>');

const block = (d, dir) => (d?.results || []).find((r) => String(r.direction).toUpperCase() === dir);
const opts = (d, dir = 'ONWARD') => block(d, dir)?.options || [];
const total = (d, dir = 'ONWARD') => d?.totalResults?.[dir] ?? null;
const faresOf = (d, dir = null) => (d?.results || [])
  .filter((r) => !dir || String(r.direction).toUpperCase() === dir)
  .flatMap((r) => (r.options || []).flatMap((o) => (o.fares || []).map((f) => ({ f, o, dir: r.direction }))));
const codes = (d, dir = null) => new Set(faresOf(d, dir).map(({ f }) => f.sourceCode).filter((c) => c != null && c !== ''));
const optCodes = (o) => new Set((o.fares || []).map((f) => f.sourceCode).filter(Boolean));
const amt = (f) => Number(f?.pricing?.totalAmount);
const minFare = (o) => {
  const a = (o.fares || []).map(amt).filter(Number.isFinite);
  return a.length ? Math.min(...a) : null;
};
const display = (o) => Number(o?.displayPricing?.pricing?.totalAmount);
const combined = (o) => {
  const cp = o?.combinedPricing;
  if (!cp) return null;
  return Number(cp.pricing?.totalAmount ?? cp.totalAmount);
};
const fmtSet = (s) => `{${[...s].sort().join(',')}}`;
const eqSet = (s, arr) => s.size === arr.length && arr.every((x) => s.has(x));

// ─── capture ──────────────────────────────────────────────────────
async function capture() {
  if (fs.existsSync(path.join(CACHE_DIR, 'capture.json')) && !FORCE) {
    console.log(`Cache already captured for ${ONWARD}/${RETURN}: ${CACHE_DIR}`);
    console.log('Refusing a second live run (look-to-book). Use "evaluate", or pass --force deliberately.');
    process.exit(3);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const pmPath = `${process.env.USERPROFILE}/Downloads/B2B preprod.postman_environment.json`;
  const pm = fs.existsSync(pmPath) ? JSON.parse(fs.readFileSync(pmPath, 'utf8')) : { values: [] };
  const getPm = (k) => (pm.values || []).filter((v) => v.key === k && v.value).at(-1)?.value;
  const PARTNER_ID = getPm('partner_id') || process.env.PREPROD_PARTNER_ID || 'vgm';
  const PARTNER_SECRET = getPm('partner_secret') || process.env.PREPROD_PARTNER_SECRET;
  const SIGNING_KEY = getPm('signing_key') || process.env.PREPROD_SIGNING_KEY;
  if (!PARTNER_SECRET || !SIGNING_KEY) throw new Error('preprod partner_secret / signing_key not found (Postman env or PREPROD_* vars)');

  const correlationId = crypto.randomUUID();
  const ledger = []; // every HTTP call, for the L2B receipt
  const files = {};

  async function post(pathname, { body, access, auth, signed = false, tag } = {}) {
    if (!ALLOWED_PATHS.test(pathname)) throw new Error(`blocked non-allowlisted path ${pathname}`);
    const headers = {
      'content-type': 'application/json',
      'X-Request-Id': `req-${crypto.randomBytes(8).toString('hex')}`,
      'X-Correlation-ID': correlationId,
    };
    if (access) headers['X-Partner-Key'] = access;
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (signed && payload) {
      const ts = String(Math.floor(Date.now() / 1000));
      headers['X-Timestamp'] = ts;
      headers['X-Signature'] = crypto.createHmac('sha256', SIGNING_KEY).update(payload + ts).digest('hex');
    }
    const t0 = Date.now();
    const r = await fetch(`${BASE}${pathname}`, { method: 'POST', headers, body: payload });
    const ms = Date.now() - t0;
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    ledger.push({
      at: new Date(t0).toISOString(), tag, path: pathname.split('?')[0], query: pathname.split('?')[1] || '',
      http: r.status, ms, state: data?.progress?.state || data?.error?.code || null,
      cacheTimeStamp: data?.cacheTimeStamp ?? null,
    });
    return { http: r.status, data, ms };
  }

  const save = (name, obj) => {
    fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(obj, null, 2));
    files[name] = `${name}.json`;
  };

  const body = (journeyType, origin, destination, selected = []) => ({
    itinerary: journeyType === 'ROUND_TRIP'
      ? [{ origin, destination, date: ONWARD }, { origin: destination, destination: origin, date: RETURN }]
      : [{ origin, destination, date: ONWARD }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType,
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: selected },
    fareType: 'NORMAL',
  });
  const q = (page = 0) => `?lang=en&currency=INR&page=${page}&perpage=${PAGE_SIZE}&sortby=fare,asc`;

  async function search(tag, auth, b, page = 0, maxPolls = 12) {
    let last;
    let firstMs = null;
    let polls = 0;
    for (let i = 1; i <= maxPolls; i += 1) {
      last = await post(`/v1/flights/search${q(page)}`, { body: b, access, auth, signed: true, tag });
      polls = i;
      if (firstMs == null) firstMs = last.ms;
      const st = last.data?.progress?.state;
      console.log(`  ${tag} p${page} #${i} http=${last.http} ${st || last.data?.error?.code || ''} opts=${(last.data?.results || []).map((r) => r.options?.length || 0).join('/')}`);
      if (last.http >= 400 || st === 'COMPLETE' || st === 'FAILED' || !st) break;
      await new Promise((r) => setTimeout(r, last.data?.progress?.pollAfterMs || 2500));
    }
    return { ...last, polls, firstMs, searchedAt: new Date().toISOString() };
  }

  const keep = (name, res, extra = {}) => save(name, {
    _capture: { http: res.http, polls: res.polls, firstMs: res.firstMs, searchedAt: res.searchedAt, ...extra },
    ...res.data,
  });

  console.log('=== Aggregation capture (one live pass) ===', { BASE, ONWARD, RETURN, CACHE_DIR });
  const tok = await post('/auth/partner/token', { body: { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET }, tag: 'token' });
  const access = tok.data?.access_token;
  if (!access) throw new Error(`token failed http=${tok.http}`);

  const sess = {};
  // single-vendor tiers first, merged last (retest note: avoid any cross-tier bleed)
  for (const t of [TBO_ONLY, RIYA_8, RIYA_15, MERGED]) {
    const r = await post('/v1/auth/session', { body: { tierId: t }, access, tag: `session-${t}` });
    let jwtTier = null;
    try { jwtTier = JSON.parse(Buffer.from(String(r.data?.auth_token).split('.')[1], 'base64url').toString()).tierId; } catch { /* opaque token */ }
    sess[t] = { auth: r.data?.auth_token, http: r.http, jwtTier };
    console.log(`session ${t} http=${r.http} jwtTier=${jwtTier}`);
  }
  save('sessions', Object.fromEntries(Object.entries(sess).map(([k, v]) => [k, { http: v.http, jwtTier: v.jwtTier }])));

  // 1) OW DEL-DXB on all four tiers (A, B3/B4, B9/B10 cross-check)
  for (const [t, name] of [[TBO_ONLY, 'ow-dxb-tbo'], [RIYA_8, 'ow-dxb-riya8'], [RIYA_15, 'ow-dxb-riya15'], [MERGED, 'ow-dxb-merged-p0']]) {
    if (!sess[t].auth) continue;
    keep(name, await search(name, sess[t].auth, body('ONE_WAY', 'DEL', 'DXB')), { tier: t });
  }
  // 1b) remaining pages of the SAME merged search (B1/B6/B7/B8 on full list) — cache reads
  {
    const p0 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'ow-dxb-merged-p0.json'), 'utf8'));
    const pages = Math.ceil((p0.totalResults?.ONWARD || 0) / PAGE_SIZE);
    for (let p = 1; p < Math.min(pages, 10); p += 1) {
      keep(`ow-dxb-merged-p${p}`, await search(`ow-dxb-merged`, sess[MERGED].auth, body('ONE_WAY', 'DEL', 'DXB'), p, 1), { tier: MERGED, page: p });
    }
  }

  // 2) details + pricing (no book) for one fare per vendor on merged OW
  {
    const p0 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'ow-dxb-merged-p0.json'), 'utf8'));
    for (const code of [RIYA, TBO]) {
      const hit = faresOf(p0, 'ONWARD').find(({ f }) => f.sourceCode === code);
      if (!hit) continue;
      const sel = { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [hit.f.searchId] } };
      const det = await post('/v1/flights/details?lang=en&currency=INR', { body: sel, access, auth: sess[MERGED].auth, signed: true, tag: `details-${code}` });
      save(`details-ow-${code}`, { _capture: { http: det.http, fare: hit.f }, ...det.data });
      const pri = await post('/v1/flights/pricing?lang=en&currency=INR', { body: sel, access, auth: sess[MERGED].auth, signed: true, tag: `pricing-${code}` });
      const { refreshToken: _drop, ...priSafe } = pri.data || {}; // keep tokens out of the receipts
      save(`pricing-ow-${code}`, { _capture: { http: pri.http, fare: hit.f }, ...priSafe });
    }
  }

  // 3) RT DEL-DXB single tiers + one selection each (D1-D3)
  for (const [t, name] of [[TBO_ONLY, 'rt-dxb-tbo'], [RIYA_8, 'rt-dxb-riya8'], [RIYA_15, 'rt-dxb-riya15']]) {
    if (!sess[t].auth) continue;
    const res = await search(name, sess[t].auth, body('ROUND_TRIP', 'DEL', 'DXB'));
    keep(name, res, { tier: t });
    const f = opts(res.data, 'ONWARD')[0]?.fares?.[0];
    if (f) keep(`${name}-sel`, await search(`${name}-sel`, sess[t].auth, body('ROUND_TRIP', 'DEL', 'DXB', [f.searchId])), { tier: t, selectedFare: f });
  }

  // 4) RT DEL-DXB merged + bounded selections (C6-C12, C14, C15, D5)
  {
    const res = await search('rt-dxb-merged', sess[MERGED].auth, body('ROUND_TRIP', 'DEL', 'DXB'));
    keep('rt-dxb-merged', res, { tier: MERGED });
    const on = opts(res.data, 'ONWARD');
    const dual = on.find((o) => optCodes(o).size === 2) || on[0];
    const picks = [];
    const add = (f, why) => { if (f && !picks.some((p) => p.f.searchId === f.searchId)) picks.push({ f, why, card: dual === undefined ? null : null }); };
    if (dual) {
      const sorted = [...dual.fares].sort((a, b) => amt(a) - amt(b));
      add(sorted[0], 'card1-cheapest');
      add(sorted.at(-1), 'card1-dearest');
      add(dual.fares.find((f) => f.sourceCode === TBO), 'card1-tbo');
      add(dual.fares.find((f) => f.sourceCode === RIYA), 'card1-riya');
      for (const f of sorted) if (picks.length < 5) add(f, 'card1-fare');
    }
    for (const o of on.filter((x) => x !== dual).slice(0, 3)) add(o.fares?.[0], `card-${o.searchId.slice(-6)}`);
    const sels = [];
    for (const [i, p] of picks.slice(0, MAX_SELECTIONS_RT_MERGED).entries()) {
      const name = `rt-dxb-merged-sel${i}`;
      keep(name, await search(name, sess[MERGED].auth, body('ROUND_TRIP', 'DEL', 'DXB', [p.f.searchId])), { tier: MERGED, selectedFare: p.f, why: p.why, dualCard: dual?.searchId });
      sels.push(name);
    }
    save('rt-dxb-merged-selections', { names: sels });
  }

  // 5) RT DEL-BOM merged + one selection per vendor (C13)
  {
    const res = await search('rt-bom-merged', sess[MERGED].auth, body('ROUND_TRIP', 'DEL', 'BOM'));
    keep('rt-bom-merged', res, { tier: MERGED });
    for (const code of [TBO, RIYA]) {
      const hit = faresOf(res.data, 'ONWARD').find(({ f }) => f.sourceCode === code);
      if (hit) keep(`rt-bom-merged-sel-${code}`, await search(`rt-bom-sel-${code}`, sess[MERGED].auth, body('ROUND_TRIP', 'DEL', 'BOM', [hit.f.searchId])), { tier: MERGED, selectedFare: hit.f });
    }
  }

  // 6) MULTI_CITY merged (D4) — B2B endpoint may reject before any vendor call
  {
    const b = body('ONE_WAY', 'DEL', 'BOM');
    b.journeyType = 'MULTI_CITY';
    b.itinerary = [{ origin: 'DEL', destination: 'BOM', date: ONWARD }, { origin: 'BOM', destination: 'DXB', date: RETURN }];
    keep('mc-merged', await search('mc-merged', sess[MERGED].auth, b, 0, 1), { tier: MERGED });
  }

  // 7) validation negatives (rejected before vendor search)
  {
    const neg = {
      'G1-past-date': (() => { const b = body('ONE_WAY', 'DEL', 'DXB'); b.itinerary[0].date = plusDays(-3); return b; })(),
      'G2-return-before-onward': (() => { const b = body('ROUND_TRIP', 'DEL', 'DXB'); b.itinerary[1].date = plusDays(19); return b; })(),
      'G3-zero-adults': (() => { const b = body('ONE_WAY', 'DEL', 'DXB'); b.travellers.adults = 0; return b; })(),
      'G4-empty-body': {},
    };
    const out = {};
    for (const [k, b] of Object.entries(neg)) {
      const r = await post(`/v1/flights/search${q(0)}`, { body: b, access, auth: sess[MERGED].auth, signed: true, tag: k });
      out[k] = { http: r.http, code: r.data?.error?.code || null, message: r.data?.error?.message || null };
    }
    const g5 = await post('/v1/flights/search?lang=en&currency=INR&page=-1&perpage=20', { body: body('ONE_WAY', 'DEL', 'DXB'), access, auth: sess[MERGED].auth, signed: true, tag: 'G5-bad-page' });
    out['G5-bad-page'] = { http: g5.http, code: g5.data?.error?.code || null };
    save('negatives', out);
  }

  const searchCalls = ledger.filter((l) => l.path === '/v1/flights/search');
  const receipt = {
    capturedAt: new Date().toISOString(),
    env: BASE,
    partner: PARTNER_ID,
    correlationId,
    dates: { onward: ONWARD, return: RETURN },
    l2b: {
      uniqueLooks: 'OW DEL-DXB x4 tiers, RT DEL-DXB x4 tiers, RT DEL-BOM merged (+ MULTI_CITY, rejected by API)',
      httpSearchCalls: searchCalls.length,
      detailsCalls: ledger.filter((l) => l.path === '/v1/flights/details').length,
      pricingCalls: ledger.filter((l) => l.path === '/v1/flights/pricing').length,
      bookingCalls: 0,
    },
    files,
    ledger,
  };
  save('capture', receipt);
  console.log('\nCaptured →', CACHE_DIR);
  console.log('L2B receipt:', receipt.l2b);
}

// ─── evaluate (offline) ───────────────────────────────────────────
function evaluate() {
  const capPath = path.join(CACHE_DIR, 'capture.json');
  if (!fs.existsSync(capPath)) {
    console.log(`No cache at ${CACHE_DIR}. Run "capture" once first (or set AGG_ONWARD/AGG_RETURN to an existing cache).`);
    process.exit(2);
  }
  const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'));
  const load = (n) => {
    const p = path.join(CACHE_DIR, `${n}.json`);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  };
  const rows = [];
  const add = (sec, id, how, status, note = '', evidence = '') => rows.push({ sec, id, how, status, note: String(note), evidence });
  const ok = (c) => (c ? 'PASS' : 'BUG');

  const owT = load('ow-dxb-tbo');
  const ow8 = load('ow-dxb-riya8');
  const ow15 = load('ow-dxb-riya15');
  const owM = load('ow-dxb-merged-p0');
  const pages = [owM];
  for (let p = 1; load(`ow-dxb-merged-p${p}`); p += 1) pages.push(load(`ow-dxb-merged-p${p}`));
  const owAll = pages.flatMap((d) => opts(d, 'ONWARD'));
  const sessions = load('sessions') || {};

  // H — process / L2B
  add('H', 'H1', 'One pinned date pair for whole pack', 'PASS', `${cap.dates.onward} / ${cap.dates.return}`);
  add('H', 'H2', 'Tier comparison on same OD+dates', 'PASS', 'DEL-DXB all tiers same capture');
  add('H', 'H3', 'Only DEL-DXB and DEL-BOM', 'PASS');
  add('H', 'H4', 'No booking endpoint called', cap.l2b.bookingCalls === 0 ? 'PASS' : 'BUG', `search=${cap.l2b.httpSearchCalls} details=${cap.l2b.detailsCalls} pricing=${cap.l2b.pricingCalls}`);
  add('H', 'H5', 'Search time to the minute recorded', 'PASS', cap.ledger.find((l) => l.path === '/v1/flights/search')?.at?.slice(0, 16));
  {
    const pageCalls = cap.ledger.filter((l) => l.tag === 'ow-dxb-merged');
    const p0ts = owM?.cacheTimeStamp;
    const same = pageCalls.every((l) => l.cacheTimeStamp === p0ts);
    add('H', 'H6', 'Extra pages served from the same cached search', pageCalls.length ? ok(same) : 'NOT TESTED', `cacheTimeStamp ${p0ts}; pages=${pageCalls.length}`);
  }
  add('H', 'H7', 'Session JWT carries the requested tier', Object.entries(sessions).every(([k, v]) => v.jwtTier == null || String(v.jwtTier) === k) ? 'PASS' : 'BUG',
    Object.entries(sessions).map(([k, v]) => `${k}→${v.jwtTier}`).join(' '));

  // A — routing
  const routing = (d, expect) => (d ? (eqSet(codes(d), expect) ? 'PASS' : 'BUG') : 'NOT TESTED');
  add('A', 'A1', 'Tier 22157551 OW: CODES == {402T}', routing(owT, [TBO]), `got ${owT ? fmtSet(codes(owT)) : '-'}`, 'ow-dxb-tbo.json');
  add('A', 'A2', 'Tier 8 OW: CODES == {422R}', routing(ow8, [RIYA]), `got ${ow8 ? fmtSet(codes(ow8)) : '-'}`, 'ow-dxb-riya8.json');
  add('A', 'A2b', 'Tier 15 OW: CODES == {422R}', routing(ow15, [RIYA]), `got ${ow15 ? fmtSet(codes(ow15)) : '-'}`, 'ow-dxb-riya15.json');
  const mCodes = new Set(owAll.flatMap((o) => [...optCodes(o)]));
  add('A', 'A3', 'Tier 22101801 OW: CODES == {402T,422R}', ok(eqSet(mCodes, [TBO, RIYA])), `got ${fmtSet(mCodes)}`, 'ow-dxb-merged-p*.json');
  const duals = owAll.filter((o) => optCodes(o).size === 2);
  add('A', 'A4', '∃ option with both vendor codes', ok(duals.length > 0), `${duals.length} dual cards of ${owAll.length}`);
  {
    const all = ['ow-dxb-tbo', 'ow-dxb-riya8', 'ow-dxb-riya15', 'rt-dxb-tbo', 'rt-dxb-riya8', 'rt-dxb-riya15', 'rt-dxb-merged', 'rt-bom-merged'].map(load).filter(Boolean).concat(pages);
    const nulls = all.flatMap((d) => faresOf(d)).filter(({ f }) => f.sourceCode == null || f.sourceCode === '').length;
    const foreign = new Set(all.flatMap((d) => [...codes(d)]).filter((c) => c !== TBO && c !== RIYA));
    add('A', 'A5', 'No fare with null sourceCode (all captures)', ok(nulls === 0), `nulls=${nulls}`);
    add('A', 'A5b', 'No third sourceCode', ok(foreign.size === 0), foreign.size ? fmtSet(foreign) : '');
  }

  // B — merge one-way (full list from all pages)
  const singlesClean = owT && ow8 && eqSet(codes(owT), [TBO]) && eqSet(codes(ow8), [RIYA]);
  {
    const keys = owAll.map(scheduleKey);
    const dupKeys = keys.length - new Set(keys).size;
    add('B', 'B1', 'No duplicate scheduleKey (full ONWARD list)', ok(dupKeys === 0), `N=${owAll.length} dupes=${dupKeys}`);
    const mism = owAll.filter((o) => display(o) !== minFare(o));
    add('B', 'B2', 'displayPrice == min(fares) ∀ cards', ok(mism.length === 0), mism.length ? `${mism.length} cards e.g. ${mism[0].searchId} display=${display(mism[0])} min=${minFare(mism[0])}` : `${owAll.length} cards`);
    const nM = total(owM);
    const nT = total(owT);
    const n8 = total(ow8);
    if (!singlesClean) {
      add('B', 'B3', 'N(merged) >= max(N(TBO), N(Riya))', 'NOT TESTED', `blocked by A1/A2 — single tiers are not single-vendor (totals M=${nM} T=${nT} R8=${n8})`);
      add('B', 'B4', 'N(merged) <= N(TBO) + N(Riya)', 'NOT TESTED', 'blocked by A1/A2');
    } else {
      add('B', 'B3', 'N(merged) >= max(N(TBO), N(Riya)) [totalResults]', ok(nM >= Math.max(nT, n8)), `M=${nM} T=${nT} R8=${n8}`);
      add('B', 'B4', 'N(merged) <= N(TBO) + N(Riya) [totalResults]', ok(nM <= nT + n8), `M=${nM} sum=${nT + n8}`);
      add('B', 'B4b', 'Merging happening (N(merged) < sum)', ok(nM < nT + n8), `merged away=${nT + n8 - nM}`);
    }
    const facet = owM?.filters?.ONWARD?.airlines;
    const names = facet ? (Array.isArray(facet) ? facet.map((v) => v?.name || v) : Object.keys(facet)) : [];
    const lower = names.map((v) => String(v).toLowerCase());
    add('B', 'B5', 'Airline facet case-unique', names.length ? ok(lower.length === new Set(lower).size) : 'NOT TESTED', `${names.length} airlines`);
    let nonDec = true;
    let prev = -Infinity;
    for (const o of owAll) { const m = minFare(o); if (m < prev - 0.01) { nonDec = false; break; } prev = m; }
    add('B', 'B6', 'sortby=fare,asc non-decreasing over full list', ok(nonDec), `${owAll.length} cards / ${pages.length} pages`);
    const ids = owAll.map((o) => o.searchId);
    const dupIds = ids.length - new Set(ids).size;
    add('B', 'B7', `Paging perpage=${PAGE_SIZE}: no dup searchId and concat == totalResults`, ok(dupIds === 0 && ids.length === nM), `concat=${ids.length} total=${nM} dupIds=${dupIds}`);
    const bad = owAll.flatMap((o) => o.fares || []).filter((f) => !(amt(f) > 0)).length;
    add('B', 'B8', 'All fare totals > 0', ok(bad === 0), `bad=${bad}`);
    const phantom = owAll.filter((o) => !(o.fares || []).some((f) => amt(f) === display(o))).length;
    add('B', 'B-N1', 'Display price is a real selectable fare (never higher)', ok(phantom === 0), `phantom=${phantom}`);

    // B9/B10 genuine merge — cross-check dual cards against single-vendor tier pages
    const idx = (d, code) => new Map(opts(d).filter((o) => optCodes(o).has(code)).map((o) => [scheduleKey(o), o]));
    const tIdx = owT ? idx(owT, TBO) : new Map();
    const rIdx = ow8 ? idx(ow8, RIYA) : new Map();
    const checked = duals.filter((o) => tIdx.has(scheduleKey(o)) && rIdx.has(scheduleKey(o)));
    if (!singlesClean) {
      add('B', 'B9', 'Dual card = same physical flight on both vendor tiers', 'NOT TESTED', 'blocked by A1/A2 — single tiers return the merged list, so cross-check is circular');
    } else {
      add('B', 'B9', 'Dual card = same physical flight on both vendor tiers', checked.length ? 'PASS' : (duals.length ? 'NOT TESTED' : 'BUG'),
        `${checked.length}/${duals.length} dual cards found in TBO + Riya single-tier page 0 by scheduleKey`);
    }
    {
      const same = owT && owM && owT.cacheTimeStamp === owM.cacheTimeStamp && opts(owT)[0]?.searchId === opts(owM)[0]?.searchId;
      add('A', 'A-N6', 'Tiers do not share one search cache (searchIds / cacheTimeStamp differ)', owT && owM ? ok(!same) : 'NOT TESTED',
        same ? `tier ${TBO_ONLY} and ${MERGED} returned identical searchIds, cacheTimeStamp ${new Date(Number(owM.cacheTimeStamp)).toISOString()}` : '');
    }
    if (!singlesClean) {
      add('B', 'B10', 'No fare dropped on merge', 'NOT TESTED', 'blocked by A1/A2 — single-tier cards already mixed');
    } else {
      const dropped = checked.filter((o) => {
        const have = new Set((o.fares || []).map((f) => `${f.sourceCode}|${f.fareType}|${amt(f)}`));
        const need = [...(tIdx.get(scheduleKey(o)).fares || []), ...(rIdx.get(scheduleKey(o)).fares || [])].map((f) => `${f.sourceCode}|${f.fareType}|${amt(f)}`);
        return need.some((k) => !have.has(k));
      });
      add('B', 'B10', 'No fare dropped on merge (vs single tiers)', checked.length ? ok(dropped.length === 0) : 'NOT TESTED', `${dropped.length} of ${checked.length} cards missing a single-tier fare`);
    }
    const cheaper = checked.filter((o) => display(o) <= Math.min(display(tIdx.get(scheduleKey(o))), display(rIdx.get(scheduleKey(o)))) + 0.01);
    add('B', 'B11', 'Merged card price never dearer than either vendor alone',
      !singlesClean ? 'NOT TESTED' : (checked.length ? ok(cheaper.length === checked.length) : 'NOT TESTED'),
      !singlesClean ? 'blocked by A1/A2' : `${cheaper.length}/${checked.length}`);
  }

  // C — round trip merged
  const rtCase = (prefix, rt, selNames, route) => {
    if (!rt || rt._capture?.http >= 400) { add('C', `${prefix}C1`, `${route} RT search`, 'BUG', `http=${rt?._capture?.http}`); return; }
    const on = opts(rt, 'ONWARD');
    const re = opts(rt, 'RETURN');
    add('C', `${prefix}C1`, `${route} directions ONWARD+RETURN non-empty`, ok(on.length > 0 && re.length > 0), `onward=${total(rt, 'ONWARD')} return=${total(rt, 'RETURN')}`);
    const empty = [...on, ...re].filter((o) => !(o.fares || []).length).length;
    add('C', `${prefix}C2`, `${route} no option with empty fares[]`, ok(empty === 0), `empty=${empty} (page 0, ${on.length}+${re.length} cards)`);
    add('C', `${prefix}C3`, `${route} CODES == {402T,422R}`, ok(eqSet(codes(rt), [TBO, RIYA])), `got ${fmtSet(codes(rt))}`);
    const nullFt = faresOf(rt).filter(({ f }) => f.fareType == null || f.fareType === '').length;
    add('C', `${prefix}C4`, `${route} fareType non-null`, ok(nullFt === 0), `null=${nullFt}`);
    const mism = [...on, ...re].filter((o) => display(o) !== minFare(o)).length;
    add('C', `${prefix}C5`, `${route} displayPrice == min(fares)`, ok(mism === 0), `mismatch=${mism}`);

    const sels = selNames.map(load).filter(Boolean);
    if (!sels.length) { add('C', `${prefix}C6`, `${route} selection`, 'NOT TESTED', 'no selection captured'); return; }
    const res = sels.map((s) => {
      const f = s._capture.selectedFare;
      const ret = opts(s, 'RETURN');
      const rc = codes(s, 'RETURN');
      const cps = ret.map(combined).filter((x) => x != null);
      return {
        f, why: s._capture.why || f.sourceCode,
        c6: ret.length > 0,
        c7: (total(s, 'RETURN') ?? ret.length) <= (total(rt, 'RETURN') ?? Infinity),
        c8: rc.size === 1 && rc.has(f.sourceCode),
        c9: ret.some((o) => o.combinedPricing?.type === 'COMBINATION'),
        c10: cps.length > 0 && cps.every((c) => Math.abs(c - 2 * amt(f)) > 0.01),
        c11: cps.length > 0 && cps.every((c) => c >= amt(f) - 0.01),
        d5: codes(s).size === 1,
        d5ret: rc.size === 1,
        rc: fmtSet(rc), all: fmtSet(codes(s)), nRet: total(s, 'RETURN'),
      };
    });
    const sum = (k) => `${res.filter((r) => r[k]).length}/${res.length}`;
    const all = (k) => ok(res.every((r) => r[k]));
    add('C', `${prefix}C6`, `${route} RETURN non-empty after selection`, all('c6'), sum('c6'));
    add('C', `${prefix}C7`, `${route} N(RETURN after) <= before [totalResults]`, all('c7'), res.map((r) => r.nRet).join(','));
    add('C', `${prefix}C8`, `${route} RETURN codes == selected onward code (mixed = fail)`, all('c8'), res.map((r) => `${r.f.sourceCode}→${r.rc}`).join(' '));
    add('C', `${prefix}C9`, `${route} ∃ RETURN combinedPricing.type == COMBINATION`, all('c9'), sum('c9'));
    add('C', `${prefix}C10`, `${route} combined != 2 × onward fare`, all('c10'), sum('c10'));
    add('C', `${prefix}C11`, `${route} combined >= onward fare`, all('c11'), sum('c11'));
    if (!prefix) {
      add('C', 'C12', 'C6–C11 for each fare on one card + 3 other cards', ok(res.every((r) => r.c6 && r.c7 && r.c8 && r.c9 && r.c10 && r.c11)),
        `${res.length} selections: ${res.map((r) => r.why).join(', ')}`);
      const t = res.find((r) => r.f.sourceCode === TBO);
      const r8 = res.find((r) => r.f.sourceCode === RIYA);
      add('C', 'C14', 'Cheapest vs dearest onward fare → single-vendor returns', (res.find((r) => r.why === 'card1-cheapest') && res.find((r) => r.why === 'card1-dearest')) ? ok(res.filter((r) => /cheapest|dearest/.test(r.why)).every((r) => r.c8)) : 'NOT TESTED');
      add('C', 'C15', 'TBO onward → TBO returns; Riya onward → Riya returns', t && r8 ? ok(t.c8 && r8.c8) : 'NOT TESTED', `tbo=${t?.rc || '-'} riya=${r8?.rc || '-'}`);
      add('D', 'D5', 'Selection request: len(CODES) == 1 (whole response, per doc)', all('d5'), res.map((r) => r.all).join(' '));
      add('D', 'D5b', 'Selection request: RETURN single vendor', all('d5ret'), sum('d5ret'));
    }
  };
  const selList = load('rt-dxb-merged-selections')?.names || [];
  rtCase('', load('rt-dxb-merged'), selList, 'DEL-DXB');
  rtCase('C13-', load('rt-bom-merged'), [`rt-bom-merged-sel-${TBO}`, `rt-bom-merged-sel-${RIYA}`], 'DEL-BOM');

  // D — single-vendor RT regression
  for (const [name, tier] of [['rt-dxb-tbo', TBO_ONLY], ['rt-dxb-riya8', RIYA_8], ['rt-dxb-riya15', RIYA_15]]) {
    const d = load(name);
    const s = load(`${name}-sel`);
    if (!d) { add('D', `D1-${tier}`, `tier ${tier} RT`, 'NOT TESTED'); continue; }
    const empty = [...opts(d, 'ONWARD'), ...opts(d, 'RETURN')].filter((o) => !(o.fares || []).length).length;
    add('D', `D1-${tier}`, `tier ${tier} RT: no empty fares[]`, ok(empty === 0), `empty=${empty}`);
    add('D', `D2-${tier}`, `tier ${tier} RT: len(CODES) == 1`, ok(codes(d).size === 1), `got ${fmtSet(codes(d))}`);
    add('D', `D3-${tier}`, `tier ${tier} selection → RETURN non-empty`, s ? ok(opts(s, 'RETURN').length > 0) : 'NOT TESTED', s ? `return=${total(s, 'RETURN')}` : '');
  }
  {
    const mc = load('mc-merged');
    const st = mc?._capture?.http;
    if (st >= 400) add('D', 'D4', 'MULTI_CITY merged: len(CODES) == 1', 'NOT TESTED', `B2B /v1/flights/search rejects MULTI_CITY: ${mc?.error?.details?.[0] || mc?.error?.code}`);
    else add('D', 'D4', 'MULTI_CITY merged: len(CODES) == 1', ok(codes(mc).size <= 1), `got ${fmtSet(codes(mc))}`);
  }

  // DET / pricing (no book)
  for (const code of [RIYA, TBO]) {
    const det = load(`details-ow-${code}`);
    const pri = load(`pricing-ow-${code}`);
    if (!det) { add('P', `DET-${code}`, `details ${code}`, 'NOT TESTED', 'no fare of this vendor'); continue; }
    add('P', `DET-${code}`, `details ${code} HTTP 200`, ok(det._capture.http === 200), `http=${det._capture.http} ${det.error?.code || ''}`);
    add('P', `PRI-${code}`, `pricing ${code} HTTP 200`, ok(pri?._capture?.http === 200), `http=${pri?._capture?.http} ${pri?.error?.code || ''} ${pri?.error?.message || ''}`);
    const searchAmt = amt(pri?._capture?.fare);
    const priAmt = Number(pri?.pricing?.totalAmount ?? pri?.fare?.pricing?.totalAmount ?? pri?.totalAmount ?? pri?.data?.pricing?.totalAmount);
    add('P', `F5p-${code}`, `search total == pricing total (${code})`, Number.isFinite(priAmt) ? ok(Math.abs(priAmt - searchAmt) <= 1) : 'NOT TESTED',
      Number.isFinite(priAmt) ? `search=${searchAmt} pricing=${priAmt}` : 'pricing total not found');
  }

  // G — negatives + leak + timing
  const neg = load('negatives') || {};
  for (const [k, v] of Object.entries(neg)) {
    add('G', k.split('-')[0], k.slice(k.indexOf('-') + 1), v.http >= 400 && v.http < 500 && v.code ? 'PASS' : 'BUG', `http=${v.http} ${v.code || 'no error.code'}`);
  }
  {
    const leaks = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json') && f !== 'capture.json')
      // whole-word only: "RIyA" inside base64 bookingCode blobs is random, not a vendor leak
      // scan the API payload only — drop our own _capture labels (e.g. why: "card1-riya")
      .filter((f) => {
        const { _capture, ...apiOnly } = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
        return /(^|[^A-Za-z0-9+/])riya([^A-Za-z0-9+/=]|$)/i.test(JSON.stringify(apiOnly));
      });
    add('G', 'G10', 'No "Riya" string in any captured response', ok(leaks.length === 0), leaks.join(', '));
    const ms = (n) => load(n)?._capture?.firstMs;
    const m = ms('ow-dxb-merged-p0');
    const s = Math.max(ms('ow-dxb-tbo') || 0, ms('ow-dxb-riya8') || 0);
    const warm = owT && owM && owT.cacheTimeStamp === owM.cacheTimeStamp;
    add('G', 'G9', 'Merged first-hit time not several × single (flag > 3×)', warm ? 'NOT TESTED' : (m && s ? ok(m <= 3 * s) : 'NOT TESTED'),
      warm ? `merged served from the cache the TBO-tier search built (merged=${m}ms, first single=${s}ms) — not comparable` : `merged=${m}ms single max=${s}ms`);
  }

  // E / F — out of scope for this run
  for (const [id, how] of [['E1', 'One vendor down'], ['E2', 'One vendor slow'], ['E3', 'Both vendors down']]) add('E', id, how, 'NOT TESTED', 'needs Dev fault injection');
  for (const [id, how] of [['F1', 'OW book 422R'], ['F2', 'OW book 402T'], ['F3', 'RT book'], ['F4', 'single-tier RT book'], ['F5', 'search == payment price']]) add('F', id, how, 'NOT TESTED', 'no booking on preprod (by instruction)');

  const summary = { PASS: 0, BUG: 0, 'NOT TESTED': 0 };
  for (const r of rows) summary[r.status] += 1;
  const report = { evaluatedAt: new Date().toISOString(), cache: CACHE_DIR, capturedAt: cap.capturedAt, dates: cap.dates, l2b: cap.l2b, summary, rows };
  fs.writeFileSync(path.join(OUT_DIR, `CACHE-PACK-RESULTS-${ONWARD}.json`), JSON.stringify(report, null, 2));
  const lines = [
    '# Aggregation pack — capture once, scored from cache',
    '',
    `Env \`${cap.env}\` · captured **${cap.capturedAt.slice(0, 16)}Z** · dates **${cap.dates.onward}** / **${cap.dates.return}** · no book`,
    `L2B: ${cap.l2b.httpSearchCalls} search HTTP calls (incl. polls, pages, selections) · ${cap.l2b.detailsCalls} details · ${cap.l2b.pricingCalls} pricing · 0 booking`,
    '',
    `## Summary: ${summary.PASS} PASS · ${summary.BUG} BUG · ${summary['NOT TESTED']} NOT TESTED`,
    '',
    '| Sec | Case | How tested | Status | Notes |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.sec} | ${r.id} | ${r.how.replace(/\|/g, '/')} | **${r.status}** | ${r.note.replace(/\|/g, '/').slice(0, 220)} |`),
    '',
    `Cache: \`${path.relative(process.cwd(), CACHE_DIR)}\``,
  ];
  fs.writeFileSync(path.join(OUT_DIR, `CACHE-PACK-RESULTS-${ONWARD}.md`), `${lines.join('\n')}\n`);
  for (const r of rows) console.log(`${r.status === 'PASS' ? '✓' : r.status === 'BUG' ? '✗' : '·'} ${r.id} ${r.status} ${r.note}`);
  console.log('\nSUMMARY', summary);
}

if (MODE === 'capture') await capture();
else if (MODE === 'evaluate') evaluate();
else { console.log('usage: capture | evaluate'); process.exit(1); }

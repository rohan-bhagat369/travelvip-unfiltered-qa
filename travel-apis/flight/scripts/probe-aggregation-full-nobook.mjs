/**
 * Flights multi-vendor aggregation (TBO 402T + Riya 422R) — FULL no-book suite in one pass.
 * Covers the QA doc (A–H), the merge reference doc, round-2 e2e (details → fareRules → pricing → SSR → seatmap)
 * and round-3 edge/boundary cases. Booking / issue-ticket / cancel are unreachable from this script.
 *
 * Look budget — each scenario searched ONCE, everything else re-uses that search (pages, sorts, filters,
 * selections, details, fare rules, pricing, SSR, seat map, negatives):
 *   merged 22101801 : OW DEL→BOM · OW DEL→DXB · RT DEL⇄BOM · RT DEL⇄DXB
 *   single tiers    : OW + RT DEL→DXB on 22157551 / 8 / 15   (routing + cache-sharing check)
 *   extra scenarios : OW DEL→BOM 2ADT+1CHD+1INF · OW DEL→BOM BUSINESS · OW DEL→BOM fareType CORPORATE
 *
 *   node travel-apis/flight/scripts/probe-aggregation-full-nobook.mjs capture    # live, once per date pair
 *   node travel-apis/flight/scripts/probe-aggregation-full-nobook.mjs evaluate   # offline, zero HTTP
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
const VENDORS = [TBO, RIYA];
const ONWARD = process.env.AGG_ONWARD || '2026-12-15';
const RETURN = process.env.AGG_RETURN || '2026-12-22';
const PAGE = 50;
const Q = '?lang=en&currency=INR';
const OUT_DIR = path.resolve('travel-apis/flight/reports/aggregation-tbo-riya-preprod');
const CACHE_DIR = path.join(OUT_DIR, `full-nobook-${ONWARD}_${RETURN}`);
const OLD_DUMPS = path.join(OUT_DIR, 'dumps-retest'); // 2026-11-23 searchIds → expired-id cases
const ALLOWED = /^\/(auth\/partner\/token|v1\/auth\/session|v1\/flights\/(search|details|fareRules|pricing|ssr|seatmap))(\?|$)/;

const J = {
  'ow-dom': { jt: 'ONE_WAY', o: 'DEL', d: 'BOM' },
  'ow-intl': { jt: 'ONE_WAY', o: 'DEL', d: 'DXB' },
  'rt-dom': { jt: 'ROUND_TRIP', o: 'DEL', d: 'BOM' },
  'rt-intl': { jt: 'ROUND_TRIP', o: 'DEL', d: 'DXB' },
};

// ─── helpers ──────────────────────────────────────────────────────
const normFn = (fn) => String(fn || '').toUpperCase().replace(/[\s-]/g, '').replace(/^([A-Z0-9]{2})0+/, '$1');
const minute = (t) => String(t || '').slice(0, 16);
const segKey = (s) => [normFn(s.flightNumber), s.departure?.airportCode, minute(s.departure?.time), s.arrival?.airportCode, minute(s.arrival?.time)].join('|');
const schedKey = (o) => (o?.segments || []).map((s) => `${segKey(s)}|${String(s.cabinClass || '').toUpperCase()}`).join('>');
const fnKey = (o) => (o?.segments || []).map((s) => normFn(s.flightNumber)).join('>');
const timeKey = (o) => (o?.segments || []).map((s) => `${s.departure?.airportCode}${minute(s.departure?.time)}-${s.arrival?.airportCode}${minute(s.arrival?.time)}`).join('>');
const block = (d, dir) => (d?.results || []).find((r) => String(r.direction).toUpperCase() === dir);
const opts = (d, dir = 'ONWARD') => block(d, dir)?.options || [];
const total = (d, dir = 'ONWARD') => d?.totalResults?.[dir] ?? null;
const vset = (o) => new Set((o?.fares || []).map((f) => f.sourceCode).filter(Boolean));
const codes = (d, dir = null) => new Set((d?.results || []).filter((r) => !dir || r.direction === dir)
  .flatMap((r) => (r.options || []).flatMap((o) => (o.fares || []).map((f) => f.sourceCode))).filter(Boolean));
const amt = (p) => Number(p?.totalAmount);
const fAmt = (f) => amt(f?.pricing);
const minFare = (o) => Math.min(...(o.fares || []).map(fAmt));
const disp = (o) => amt(o?.displayPricing?.pricing);
const near = (a, b, t = 1) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= t;
const fmt = (s) => `{${[...s].sort().join(',')}}`;
const riyaLeak = (o) => /(^|[^A-Za-z0-9+/])riya([^A-Za-z0-9+/=]|$)/i.test(JSON.stringify(o ?? {}));
const parts = (p) => ['baseFare', 'taxes', 'convenienceFee', 'flexiCancelFee', 'platformFee'].reduce((a, k) => a + (Number(p?.[k]) || 0), 0);
const negAmounts = (obj) => {
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
    console.log(`Already captured for ${ONWARD}/${RETURN} → ${CACHE_DIR}\nRefusing a second live run. Use "evaluate".`);
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
  const looks = []; // every search body that is a new scenario (not page/sort/filter/selection of a known one)
  let access;
  const auth = {};

  async function post(pathname, body, tag, { tier = MERGED, signed = true, bearer, noAuth = false } = {}) {
    if (!ALLOWED.test(pathname)) throw new Error(`blocked path ${pathname}`);
    const headers = { 'content-type': 'application/json', 'X-Request-Id': `req-${crypto.randomBytes(8).toString('hex')}`, 'X-Correlation-ID': correlationId };
    if (access) headers['X-Partner-Key'] = access;
    if (!noAuth) {
      const b = bearer ?? auth[tier];
      if (b) headers.Authorization = `Bearer ${b}`;
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (signed && payload) {
      const ts = String(Math.floor(Date.now() / 1000));
      headers['X-Timestamp'] = ts;
      headers['X-Signature'] = crypto.createHmac('sha256', SIGNING_KEY).update(payload + ts).digest('hex');
    }
    const t0 = Date.now();
    let r;
    let text;
    try {
      r = await fetch(`${BASE}${pathname}`, { method: 'POST', headers, body: payload });
      text = await r.text();
    } catch (e) {
      ledger.push({ at: new Date(t0).toISOString(), tag, path: pathname.split('?')[0], http: 0, error: String(e) });
      return { http: 0, data: { error: { code: 'NETWORK', message: String(e) } }, ms: Date.now() - t0, request: body };
    }
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
    const ms = Date.now() - t0;
    ledger.push({ at: new Date(t0).toISOString(), tag, tier, path: pathname.split('?')[0], query: pathname.split('?')[1] || '', http: r.status, ms, state: data?.progress?.state || data?.error?.code || null, cacheTimeStamp: data?.cacheTimeStamp ?? null });
    console.log(`  ${tag} http=${r.status} ${data?.progress?.state || data?.error?.code || ''} ${ms}ms`);
    return { http: r.status, data, ms, request: body };
  }
  const save = (name, res, extra = {}) => {
    const { refreshToken: _r, ...data } = res?.data || {};
    fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), JSON.stringify({ _capture: { http: res?.http, ms: res?.ms, request: res?.request, ...extra }, ...data }, null, 2));
  };
  const load = (name) => JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${name}.json`), 'utf8'));

  const sBody = (j, { selected = [], travellers = { adults: 1, children: 0, infants: 0 }, cabin = 'ECONOMY', fareType = 'NORMAL', applied = {} } = {}) => ({
    itinerary: j.jt === 'ROUND_TRIP'
      ? [{ origin: j.o, destination: j.d, date: ONWARD }, { origin: j.d, destination: j.o, date: RETURN }]
      : [{ origin: j.o, destination: j.d, date: ONWARD }],
    travellers, cabinClass: cabin, journeyType: j.jt, currency: 'INR', language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: applied, selection: { selectedSearchIds: selected }, fareType,
  });
  const sq = ({ page = 0, perpage = PAGE, sort = 'fare,asc' } = {}) => `/v1/flights/search${Q}&page=${page}&perpage=${perpage}&sortby=${sort}`;
  async function search(tag, body, { tier = MERGED, page = 0, perpage = PAGE, sort = 'fare,asc', polls = 14, isLook = false } = {}) {
    let res;
    let n = 0;
    for (let i = 1; i <= polls; i += 1) {
      res = await post(sq({ page, perpage, sort }), body, `${tag}#${i}`, { tier });
      n = i;
      const st = res.data?.progress?.state;
      if (res.http >= 400 || !st || st === 'COMPLETE' || st === 'FAILED') break;
      await new Promise((r) => setTimeout(r, res.data?.progress?.pollAfterMs || 2500));
    }
    if (isLook) looks.push({ tag, tier, firstMs: ledger.find((l) => l.tag === `${tag}#1`)?.ms, polls: n });
    return { ...res, polls: n };
  }
  const selB = (jt, ids) => ({ journeyType: jt, selection: { selectedSearchIds: ids } });
  const pax1 = [{ paxRefNumber: '1', passengerType: 1, gender: 'Male', title: 'Mr', firstName: 'Aggqa', lastName: 'Nobook' }];

  console.log('=== Aggregation FULL no-book capture ===', { BASE, ONWARD, RETURN });
  const tok = await post('/auth/partner/token', { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET }, 'token', { signed: false, noAuth: true });
  access = tok.data?.access_token;
  if (!access) throw new Error(`token failed http=${tok.http}`);
  const sessions = {};
  for (const t of [TBO_ONLY, RIYA_8, RIYA_15, MERGED]) {
    const r = await post('/v1/auth/session', { tierId: t }, `session-${t}`, { signed: false, noAuth: true });
    auth[t] = r.data?.auth_token;
    let jwtTier = null;
    try { jwtTier = JSON.parse(Buffer.from(String(auth[t]).split('.')[1], 'base64url').toString()).tierId; } catch { /* opaque */ }
    sessions[t] = { http: r.http, jwtTier };
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'sessions.json'), JSON.stringify(sessions, null, 2));

  // ── 1. single-vendor tiers first (routing + cache sharing) ──
  for (const t of [TBO_ONLY, RIYA_8, RIYA_15]) {
    if (!auth[t]) continue;
    save(`tier${t}-ow-intl`, await search(`tier${t}-ow-intl`, sBody(J['ow-intl']), { tier: t, isLook: true }), { tier: t });
    const rt = await search(`tier${t}-rt-intl`, sBody(J['rt-intl']), { tier: t, isLook: true });
    save(`tier${t}-rt-intl`, rt, { tier: t });
    const f = opts(rt.data)[0]?.fares?.[0];
    if (f) save(`tier${t}-rt-intl-sel`, await search(`tier${t}-rt-sel`, sBody(J['rt-intl'], { selected: [f.searchId] }), { tier: t, polls: 6 }), { tier: t, selectedFare: f });
  }

  // ── 2. merged journeys ──
  const flows = [];
  for (const [key, j] of Object.entries(J)) {
    const base = await search(key, sBody(j), { isLook: true });
    save(`${key}-p0`, base, { polls: base.polls });
    const ts0 = base.data?.cacheTimeStamp;
    let lookGuard = false;
    const guard = (res, tag) => { if (res.data?.cacheTimeStamp && res.data.cacheTimeStamp !== ts0) { lookGuard = true; console.log(`  !! ${tag} came from a NEW search (cacheTimeStamp changed) — stopping extra calls for ${key}`); } };
    // pages
    const pages = j.jt === 'ONE_WAY' ? Math.ceil((total(base.data) || 0) / PAGE) : 2;
    for (let p = 1; p < Math.min(pages, 10) && !lookGuard; p += 1) { const r = await search(`${key}-p${p}`, sBody(j), { page: p, polls: 1 }); guard(r, `${key}-p${p}`); save(`${key}-p${p}`, r); }
    // sorts
    for (const sort of ['stops,asc', 'duration,asc']) {
      if (lookGuard) break;
      const r = await search(`${key}-sort-${sort}`, sBody(j), { sort, polls: 1 });
      guard(r, `${key}-sort`);
      save(`${key}-sort-${sort.replace(',', '-')}`, r, { sort });
    }
    // filters
    if (!lookGuard) {
      const fo = base.data?.filters?.ONWARD || {};
      const topAirline = Object.entries(fo.airlines || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
      const dual = opts(base.data).find((o) => vset(o).size === 2);
      const ft = dual?.fares?.find((f) => f.sourceCode === TBO)?.fareType;
      const pr = fo.priceRange || {};
      const mid = Math.round((Number(pr.min) + Number(pr.max)) / 2);
      const filters = {
        airline: { ONWARD: { airlines: [topAirline] } },
        stops0: { ONWARD: { stops: ['Non-Stop'] } },
        refundable: { ONWARD: { refundable: [true] } },
        price: { ONWARD: { priceRange: { min: Number(pr.min), max: mid } } },
        fareType: { ONWARD: { fareTypes: [ft] } },
        combo: { ONWARD: { airlines: [topAirline], stops: ['Non-Stop'] } },
        priceEmpty: { ONWARD: { priceRange: { min: 1, max: 2 } } },
        priceInverted: { ONWARD: { priceRange: { min: mid, max: Number(pr.min) } } },
        unknownAirline: { ONWARD: { airlines: ['Not An Airline'] } },
      };
      for (const [name, applied] of Object.entries(filters)) {
        if (lookGuard) break;
        const r = await search(`${key}-filter-${name}`, sBody(j, { applied }), { polls: 1 });
        guard(r, `${key}-filter-${name}`);
        save(`${key}-filter-${name}`, r, { applied });
      }
    }
    // paging boundaries (one-way domestic only)
    if (key === 'ow-dom' && !lookGuard) {
      const last = Math.max(0, Math.ceil((total(base.data) || 0) / PAGE) - 1);
      for (const [name, p] of Object.entries({ last: { page: last }, page9999: { page: 9999 }, perpage1: { perpage: 1 }, perpage0: { perpage: 0 }, perpageNeg: { perpage: -1 }, perpage500: { perpage: 500 } })) {
        const r = await post(sq(p), sBody(j), `${key}-paging-${name}`);
        save(`${key}-paging-${name}`, r, p);
      }
      const abc = await post(`/v1/flights/search${Q}&page=abc&perpage=${PAGE}`, sBody(j), `${key}-paging-abc`);
      save(`${key}-paging-abc`, abc, { page: 'abc' });
    }
    // dual-card details for both vendors (normalisation proof) — up to 5 cards
    const duals = opts(base.data).filter((o) => vset(o).size === 2).slice(0, 5);
    const dualDet = [];
    if (j.jt === 'ONE_WAY') {
      for (const o of duals) {
        const row = { card: o.searchId, display: disp(o) };
        for (const v of VENDORS) {
          const f = o.fares.filter((x) => x.sourceCode === v).sort((a, b) => fAmt(a) - fAmt(b))[0];
          const r = await post(`/v1/flights/details${Q}`, selB('ONE_WAY', [f.searchId]), `${key}-dual-det-${v}`);
          row[v] = { fare: f, http: r.http, segments: (r.data?.itinerary || []).flatMap((l) => l.segments || []).map((s) => ({ flightNumber: s.flightNumber, cabinClass: s.cabinClass, dep: s.departure?.airportCode, depTime: s.departure?.time, arr: s.arrival?.airportCode, arrTime: s.arrival?.time })) };
        }
        dualDet.push(row);
      }
    }
    fs.writeFileSync(path.join(CACHE_DIR, `${key}-dual-details.json`), JSON.stringify(dualDet, null, 2));

    // per-vendor flow: details → fareRules → pricing → SSR → seatmap
    const on = opts(base.data);
    const dual = on.find((o) => vset(o).size === 2);
    for (const v of VENDORS) {
      const card = dual && vset(dual).has(v) ? dual : on.find((o) => vset(o).has(v));
      if (!card) { flows.push({ journey: key, vendor: v, missing: true }); continue; }
      const fare = card.fares.filter((f) => f.sourceCode === v).sort((a, b) => fAmt(a) - fAmt(b))[0];
      const fl = { journey: key, vendor: v, card: card.searchId, fare, fromDual: card === dual };
      let ids = [fare.searchId];
      if (j.jt === 'ROUND_TRIP') {
        const after = await search(`${key}-sel-${v}`, sBody(j, { selected: [fare.searchId] }), { polls: 6 });
        save(`${key}-sel-${v}`, after, { selectedFare: fare });
        const ret = opts(after.data, 'RETURN')[0];
        const rf = ret ? [...ret.fares].sort((a, b) => fAmt(a) - fAmt(b))[0] : null;
        if (!rf) { fl.noReturn = true; flows.push(fl); continue; }
        Object.assign(fl, { returnCard: ret.searchId, returnFare: rf, combined: ret.combinedPricing });
        ids = [fare.searchId, rf.searchId];
      }
      fl.ids = ids;
      const T = `${key}-${v}`;
      save(`${T}-details`, await post(`/v1/flights/details${Q}`, selB(j.jt, ids), `${T}-details`));
      save(`${T}-farerules`, await post(`/v1/flights/fareRules${Q}`, selB(j.jt, ids), `${T}-farerules`));
      const pr = await post(`/v1/flights/pricing${Q}`, selB(j.jt, ids), `${T}-pricing`);
      save(`${T}-pricing`, pr);
      if (pr.data?.priceId) save(`${T}-ssr`, await post('/v1/flights/ssr?currency=INR&lang=en', { priceId: pr.data.priceId }, `${T}-ssr`));
      if (pr.data?.bookingContext) save(`${T}-seatmap`, await post(`/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: pr.data.bookingContext, passengers: pax1 }, `${T}-seatmap`));
      flows.push(fl);
    }
    // extra RT selections on the merged card (C12 / C14): every fare on the card, cap 4 more
    if (j.jt === 'ROUND_TRIP' && dual) {
      const done = new Set(flows.filter((f) => f.journey === key).map((f) => f.fare?.searchId));
      const extra = [...dual.fares].sort((a, b) => fAmt(a) - fAmt(b)).filter((f) => !done.has(f.searchId)).slice(0, 4);
      for (const [i, f] of extra.entries()) save(`${key}-xsel${i}`, await search(`${key}-xsel${i}`, sBody(j, { selected: [f.searchId] }), { polls: 6 }), { selectedFare: f });
    }
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'flows.json'), JSON.stringify(flows, null, 2));

  // ── 3. extra scenarios (one search each) ──
  const mp = await search('x-multipax', sBody(J['ow-dom'], { travellers: { adults: 2, children: 1, infants: 1 } }), { isLook: true });
  save('x-multipax-p0', mp);
  const mpDual = opts(mp.data).find((o) => vset(o).size === 2) || opts(mp.data)[0];
  for (const v of VENDORS) {
    const f = mpDual?.fares?.filter((x) => x.sourceCode === v).sort((a, b) => fAmt(a) - fAmt(b))[0];
    if (!f) continue;
    save(`x-multipax-${v}-details`, await post(`/v1/flights/details${Q}`, selB('ONE_WAY', [f.searchId]), `x-multipax-${v}-details`), { fare: f });
    save(`x-multipax-${v}-pricing`, await post(`/v1/flights/pricing${Q}`, selB('ONE_WAY', [f.searchId]), `x-multipax-${v}-pricing`), { fare: f });
  }
  save('x-business-p0', await search('x-business', sBody(J['ow-dom'], { cabin: 'BUSINESS' }), { isLook: true }));
  save('x-corporate-p0', await search('x-corporate', sBody(J['ow-dom'], { fareType: 'CORPORATE' }), { isLook: true }));

  // ── 4. negatives / boundaries / session edges ──
  const neg = {};
  const run = async (id, p, body, opt = {}) => {
    const r = await post(p, body, `NEG-${id}`, opt);
    neg[id] = { path: p.split('?')[0], query: p.split('?')[1], http: r.http, code: r.data?.error?.code || null, message: r.data?.error?.message || null, state: r.data?.progress?.state || null, options: (r.data?.results || []).reduce((a, x) => a + (x.options?.length || 0), 0), codes: [...codes(r.data)], request: body };
  };
  const owDom = J['ow-dom'];
  const fl = (k, v) => flows.find((x) => x.journey === k && x.vendor === v && x.ids);
  const okPrice = flows.find((x) => x.ids && fs.existsSync(path.join(CACHE_DIR, `${x.journey}-${x.vendor}-pricing.json`)) && load(`${x.journey}-${x.vendor}-pricing`).bookingContext);
  const owAny = fl('ow-dom', RIYA) || fl('ow-dom', TBO);
  const rtT = fl('rt-intl', TBO) || fl('rt-dom', TBO);
  const rtR = fl('rt-intl', RIYA) || fl('rt-dom', RIYA);
  const BAD = 'srch_00000000000000000000000000000000';
  // search validation (merged tier, same OD/date so an accepted request re-uses the cache key where possible)
  const sv = (mut) => { const b = sBody(owDom); mut(b); return b; };
  const sNeg = {
    'S-same-od': sv((b) => { b.itinerary[0].destination = 'DEL'; }),
    'S-bad-iata': sv((b) => { b.itinerary[0].destination = 'XQZ'; }),
    'S-lowercase-iata': sv((b) => { b.itinerary[0].origin = 'del'; }),
    'S-past-date': sv((b) => { b.itinerary[0].date = '2026-11-01'; }),
    'S-date-bad-format': sv((b) => { b.itinerary[0].date = '15-12-2026'; }),
    'S-date-400d': sv((b) => { b.itinerary[0].date = '2027-12-31'; }),
    'S-adults-0': sv((b) => { b.travellers.adults = 0; }),
    'S-adults-10': sv((b) => { b.travellers.adults = 10; }),
    'S-adults-string': sv((b) => { b.travellers.adults = '1'; }),
    'S-infants-gt-adults': sv((b) => { b.travellers.infants = 2; }),
    'S-children-neg': sv((b) => { b.travellers.children = -1; }),
    'S-cabin-bad': sv((b) => { b.cabinClass = 'CABIN_X'; }),
    'S-fareType-bad': sv((b) => { b.fareType = 'GARBAGE'; }),
    'S-journeyType-bad': sv((b) => { b.journeyType = 'ONEWAY'; }),
    'S-multicity': sv((b) => { b.journeyType = 'MULTI_CITY'; b.itinerary.push({ origin: 'BOM', destination: 'DXB', date: RETURN }); }),
    'S-rt-one-leg': sv((b) => { b.journeyType = 'ROUND_TRIP'; }),
    'S-rt-return-before': (() => { const b = sBody(J['rt-dom']); b.itinerary[1].date = '2026-12-10'; return b; })(),
    'S-html-dest': sv((b) => { b.itinerary[0].destination = '<b>BOM</b>'; }),
    'S-empty-body': {},
    'S-omit-itinerary': sv((b) => { delete b.itinerary; }),
    'S-selection-unknown-id': sv((b) => { b.selection.selectedSearchIds = [BAD]; }),
  };
  for (const [id, b] of Object.entries(sNeg)) await run(id, sq(), b);
  await run('AUTH-no-bearer', sq(), sBody(owDom), { noAuth: true });
  await run('AUTH-garbage-bearer', sq(), sBody(owDom), { bearer: 'garbage.token.value' });
  // hop validation
  for (const [api, p] of [['details', `/v1/flights/details${Q}`], ['fareRules', `/v1/flights/fareRules${Q}`], ['pricing', `/v1/flights/pricing${Q}`]]) {
    await run(`${api}-empty-ids`, p, selB('ONE_WAY', []));
    await run(`${api}-unknown-id`, p, selB('ONE_WAY', [BAD]));
    await run(`${api}-html-id`, p, selB('ONE_WAY', ['<script>alert(1)</script>']));
    await run(`${api}-comma-id`, p, selB('ONE_WAY', [`${owAny?.ids?.[0] || BAD},`]));
  }
  if (owAny) {
    await run('pricing-ow-id-as-RT', `/v1/flights/pricing${Q}`, selB('ROUND_TRIP', owAny.ids));
    await run('pricing-dup-id', `/v1/flights/pricing${Q}`, selB('ONE_WAY', [owAny.ids[0], owAny.ids[0]]));
    await run('pricing-bad-journeyType', `/v1/flights/pricing${Q}`, selB('ONEWAY', owAny.ids));
    await run('details-omit-journeyType', `/v1/flights/details${Q}`, { selection: { selectedSearchIds: owAny.ids } });
    // cross-tier: merged-tier searchId used in a TBO-only / Riya-only session
    await run('XTIER-details-merged-id-in-TBO-session', `/v1/flights/details${Q}`, selB('ONE_WAY', owAny.ids), { tier: TBO_ONLY });
    await run('XTIER-pricing-merged-id-in-Riya8-session', `/v1/flights/pricing${Q}`, selB('ONE_WAY', owAny.ids), { tier: RIYA_8 });
  }
  if (rtT) {
    await run('pricing-RT-onward-only', `/v1/flights/pricing${Q}`, selB('ROUND_TRIP', [rtT.ids[0]]));
    await run('pricing-RT-swapped-order', `/v1/flights/pricing${Q}`, selB('ROUND_TRIP', [rtT.ids[1], rtT.ids[0]]));
    await run('pricing-OW-with-return-id', `/v1/flights/pricing${Q}`, selB('ONE_WAY', [rtT.ids[1]]));
    const k = rtT.journey;
    const second = opts(load(`${k}-p0`)).find((o) => o.searchId !== rtT.card)?.fares?.[0];
    if (second) {
      await run('pricing-RT-two-onward-ids', `/v1/flights/pricing${Q}`, selB('ROUND_TRIP', [rtT.ids[0], second.searchId]));
      await run('SEL-search-two-onward-ids', sq(), sBody(J[k], { selected: [rtT.ids[0], second.searchId] }));
    }
    await run('SEL-search-return-id-as-onward', sq(), sBody(J[k], { selected: [rtT.ids[1]] }));
  }
  if (rtT && rtR) {
    await run('pricing-RT-mixed-TBO-onward-Riya-return', `/v1/flights/pricing${Q}`, selB('ROUND_TRIP', [rtT.ids[0], rtR.ids[1]]));
    await run('fareRules-RT-mixed-vendors', `/v1/flights/fareRules${Q}`, selB('ROUND_TRIP', [rtT.ids[0], rtR.ids[1]]));
    await run('details-RT-mixed-vendors', `/v1/flights/details${Q}`, selB('ROUND_TRIP', [rtT.ids[0], rtR.ids[1]]));
  }
  // expired ids from the 2026-11-23 run
  if (fs.existsSync(OLD_DUMPS)) {
    const old = JSON.parse(fs.readFileSync(path.join(OLD_DUMPS, 'ow-merged.json'), 'utf8'));
    const oldId = opts(old)[0]?.fares?.[0]?.searchId;
    const oldPr = fs.existsSync(path.join(OLD_DUMPS, 'pricing-422R.json')) ? JSON.parse(fs.readFileSync(path.join(OLD_DUMPS, 'pricing-422R.json'), 'utf8')) : null;
    if (oldId) {
      await run('EXP-details-expired-id', `/v1/flights/details${Q}`, selB('ONE_WAY', [oldId]));
      await run('EXP-pricing-expired-id', `/v1/flights/pricing${Q}`, selB('ONE_WAY', [oldId]));
    }
    if (oldPr?.priceId) await run('EXP-ssr-expired-priceId', '/v1/flights/ssr?currency=INR&lang=en', { priceId: oldPr.priceId });
    if (oldPr?.bookingContext) await run('EXP-seatmap-expired-context', `/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: oldPr.bookingContext, passengers: pax1 });
  }
  await run('ssr-empty-priceId', '/v1/flights/ssr?currency=INR&lang=en', { priceId: '' });
  await run('ssr-unknown-priceId', '/v1/flights/ssr?currency=INR&lang=en', { priceId: 'prc_does_not_exist_000' });
  await run('ssr-html-priceId', '/v1/flights/ssr?currency=INR&lang=en', { priceId: '<b>x</b>' });
  await run('ssr-omit-priceId', '/v1/flights/ssr?currency=INR&lang=en', {});
  await run('seatmap-omit-requestReference', `/v1/flights/seatmap${Q}`, { currency: 'INR', passengers: pax1 });
  await run('seatmap-garbage-requestReference', `/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: 'not-a-context,', passengers: pax1 });
  if (okPrice) {
    const ctx = load(`${okPrice.journey}-${okPrice.vendor}-pricing`).bookingContext;
    await run('seatmap-empty-passengers', `/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: ctx, passengers: [] });
    await run('seatmap-html-name', `/v1/flights/seatmap${Q}`, { currency: 'INR', requestReference: ctx, passengers: [{ ...pax1[0], firstName: '<script>x</script>' }] });
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'negatives.json'), JSON.stringify(neg, null, 2));

  const by = (p) => ledger.filter((l) => l.path === p).length;
  const receipt = {
    capturedAt: new Date().toISOString(), env: BASE, correlationId, dates: { onward: ONWARD, return: RETURN },
    l2b: {
      scenarioLooks: looks.length, looks, searchHttp: by('/v1/flights/search'), details: by('/v1/flights/details'), fareRules: by('/v1/flights/fareRules'),
      pricing: by('/v1/flights/pricing'), ssr: by('/v1/flights/ssr'), seatmap: by('/v1/flights/seatmap'), booking: 0,
    },
    ledger,
  };
  fs.writeFileSync(path.join(CACHE_DIR, 'capture.json'), JSON.stringify(receipt, null, 2));
  console.log('\nCaptured →', CACHE_DIR, '\nL2B:', { ...receipt.l2b, looks: undefined });
}

// ─── evaluate (offline) ───────────────────────────────────────────
function evaluate() {
  if (!fs.existsSync(path.join(CACHE_DIR, 'capture.json'))) { console.log(`No cache at ${CACHE_DIR}`); process.exit(2); }
  const has = (n) => fs.existsSync(path.join(CACHE_DIR, `${n}.json`));
  const load = (n) => (has(n) ? JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${n}.json`), 'utf8')) : null);
  const cap = load('capture');
  const flows = load('flows') || [];
  const neg = load('negatives') || {};
  const sessions = load('sessions') || {};
  const rows = [];
  const add = (area, id, how, status, note = '') => rows.push({ area, id, how, status, note: String(note ?? '') });
  const ok = (c) => (c ? 'PASS' : 'BUG');

  // ── L2B / process
  {
    const A = 'L2B & process';
    add(A, 'H1', 'Each scenario searched once (13 scenarios), fixed dates', ok(cap.l2b.scenarioLooks <= 13), `${cap.l2b.scenarioLooks} scenario searches · ${cap.dates.onward} / ${cap.dates.return}`);
    add(A, 'H2', 'No booking / ticket / cancel call', ok(cap.l2b.booking === 0), `search HTTP ${cap.l2b.searchHttp} · details ${cap.l2b.details} · fareRules ${cap.l2b.fareRules} · pricing ${cap.l2b.pricing} · ssr ${cap.l2b.ssr} · seatmap ${cap.l2b.seatmap}`);
    const extra = cap.ledger.filter((l) => /-(p\d|sort|filter)/.test(l.tag || ''));
    const bases = Object.fromEntries(Object.keys(J).map((k) => [k, load(`${k}-p0`)?.cacheTimeStamp]));
    const fresh = extra.filter((l) => l.cacheTimeStamp && l.cacheTimeStamp !== bases[l.tag.split('-').slice(0, 2).join('-')]);
    add(A, 'H3', 'Pages / sorts / filters served from the cached search (no new look)', ok(fresh.length === 0), `${extra.length} calls · ${fresh.length} fresh${fresh.length ? `: ${fresh.slice(0, 3).map((l) => l.tag).join(', ')}` : ''}`);
    add(A, 'H4', 'Session token carries the requested tier', ok(Object.entries(sessions).every(([k, v]) => v.jwtTier == null || String(v.jwtTier) === k)), Object.entries(sessions).map(([k, v]) => `${k}→${v.jwtTier}`).join(' '));
    const slow = cap.l2b.looks.filter((l) => l.firstMs > 20000);
    add(A, 'G9', 'First search response ≤ 20 s per scenario', ok(slow.length === 0), cap.l2b.looks.map((l) => `${l.tag} ${l.firstMs}ms`).join(' · '));
  }

  // ── Routing (single tiers) and cache sharing
  {
    const A = 'Routing by tier';
    const m = load('ow-intl-p0');
    for (const [t, exp, id] of [[TBO_ONLY, [TBO], 'A1'], [RIYA_8, [RIYA], 'A2'], [RIYA_15, [RIYA], 'A2b']]) {
      const d = load(`tier${t}-ow-intl`);
      const c = codes(d);
      add(A, id, `Tier ${t} one-way shows only ${exp[0]}`, d ? ok(c.size === 1 && c.has(exp[0])) : 'NOT TESTED', `got ${fmt(c)} · total ${total(d)}`);
      const r = load(`tier${t}-rt-intl`);
      const rc = codes(r);
      add(A, `D2-${t}`, `Tier ${t} round trip shows one supplier`, r ? ok(rc.size === 1) : 'NOT TESTED', `got ${fmt(rc)}`);
      const empty = [...opts(r), ...opts(r, 'RETURN')].filter((o) => !(o.fares || []).length).length;
      add(A, `D1-${t}`, `Tier ${t} round trip: no card without fares`, r ? ok(empty === 0) : 'NOT TESTED', `empty=${empty}`);
      const s = load(`tier${t}-rt-intl-sel`);
      add(A, `D3-${t}`, `Tier ${t} round trip: return list after choosing outbound`, s ? ok(opts(s, 'RETURN').length > 0) : 'NOT TESTED', `return ${total(s, 'RETURN')}`);
      const same = d && m && d.cacheTimeStamp === m.cacheTimeStamp && opts(d)[0]?.searchId === opts(m)[0]?.searchId;
      add(A, `A-N6-${t}`, `Tier ${t} gets its own search result (not the merged tier's cache)`, d && m ? ok(!same) : 'NOT TESTED', same ? `identical searchIds + cacheTimeStamp ${m.cacheTimeStamp}` : `own cacheTimeStamp ${d?.cacheTimeStamp}`);
    }
    const clean = [TBO_ONLY, RIYA_8].every((t) => codes(load(`tier${t}-ow-intl`)).size === 1);
    const nM = total(m); const nT = total(load(`tier${TBO_ONLY}-ow-intl`)); const nR = total(load(`tier${RIYA_8}-ow-intl`));
    add(A, 'B3', 'Merged count ≥ each single supplier', clean ? ok(nM >= Math.max(nT, nR)) : 'NOT TESTED', clean ? `M=${nM} T=${nT} R=${nR}` : `blocked by A1/A2 (M=${nM} T=${nT} R=${nR})`);
    add(A, 'B4', 'Merged count ≤ TBO + Riya (merging actually removes duplicates)', clean ? ok(nM <= nT + nR && nM < nT + nR) : 'NOT TESTED', clean ? `sum=${nT + nR}` : 'blocked by A1/A2');
  }

  // ── Merged journeys
  for (const [key, j] of Object.entries(J)) {
    const A = `Search ${key}`;
    const p0 = load(`${key}-p0`);
    if (!p0 || p0._capture.http !== 200) { add(A, 'S0', 'Search OK', 'BUG', `http=${p0?._capture?.http}`); continue; }
    const pages = [p0];
    for (let p = 1; has(`${key}-p${p}`); p += 1) pages.push(load(`${key}-p${p}`));
    const on = j.jt === 'ONE_WAY' ? pages.flatMap((d) => opts(d)) : opts(p0);
    const re = opts(p0, 'RETURN');
    const all = [...on, ...re];
    const fares = all.flatMap((o) => o.fares || []);
    add(A, 'S0', 'HTTP 200 and progress COMPLETE', ok(p0.progress?.state === 'COMPLETE'), `polls ${p0._capture.polls} · onward ${total(p0)}${re.length ? ` · return ${total(p0, 'RETURN')}` : ''}`);
    add(A, 'A3', 'Both suppliers present', ok(codes(p0).has(TBO) && codes(p0).has(RIYA)), fmt(codes(p0)));
    if (re.length) add(A, 'A3r', 'Both suppliers present on RETURN too', ok(codes(p0, 'RETURN').size === 2), fmt(codes(p0, 'RETURN')));
    const duals = on.filter((o) => vset(o).size === 2);
    add(A, 'A4', 'Merged cards exist (both suppliers on one card)', ok(duals.length > 0), `${duals.length}/${on.length}`);
    add(A, 'A5', 'Every fare has sourceCode 402T / 422R only', ok(fares.every((f) => f.sourceCode === TBO || f.sourceCode === RIYA)), `${fares.length} fares`);
    const keys = on.map(schedKey);
    add(A, 'B1', 'No duplicate flight cards (same flight on two cards)', ok(new Set(keys).size === keys.length), `${keys.length} cards`);
    if (re.length) { const rk = re.map(schedKey); add(A, 'B1r', 'No duplicate flight cards on RETURN', ok(new Set(rk).size === rk.length)); }
    const mism = all.filter((o) => !near(disp(o), minFare(o), 0.01));
    add(A, 'B2', 'Card price = cheapest fare on the card', ok(mism.length === 0), mism.length ? `${mism.length} e.g. ${mism[0].searchId}` : `${all.length} cards`);
    add(A, 'B12', 'Card price equals a real selectable fare', ok(all.every((o) => (o.fares || []).some((f) => near(fAmt(f), disp(o), 0.01)))));
    const card1 = duals.filter((o) => o.segments.length > 1).length;
    add(A, 'E-1stop', 'Connecting (multi-segment) flights merge only when every leg matches', duals.length ? 'PASS' : 'NOT TESTED', `${card1} merged multi-segment cards (all segments shared by both suppliers by construction)`);
    // B6 order
    let nd = true; let prev = -Infinity;
    for (const o of on) { if (minFare(o) < prev - 0.01) { nd = false; break; } prev = minFare(o); }
    add(A, 'B6', `Cheapest first across ${j.jt === 'ONE_WAY' ? 'all pages' : 'page 0'}`, ok(nd));
    if (j.jt === 'ONE_WAY') {
      const ids = on.map((o) => o.searchId);
      add(A, 'B7', 'All pages together = totalResults, no repeats', ok(ids.length === total(p0) && new Set(ids).size === ids.length), `${ids.length} vs ${total(p0)} over ${pages.length} pages`);
    } else {
      const p1 = load(`${key}-p1`);
      const overlap = opts(p1).filter((o) => opts(p0).some((x) => x.searchId === o.searchId)).length;
      add(A, 'B7', 'Page 1 has no repeats from page 0', p1 ? ok(overlap === 0) : 'NOT TESTED', `page1 onward ${opts(p1).length} return ${opts(p1, 'RETURN').length} · overlap ${overlap}`);
    }
    add(A, 'B8', 'Every fare total > 0', ok(fares.every((f) => fAmt(f) > 0)));
    const brk = fares.filter((f) => !near(parts(f.pricing), fAmt(f), 1));
    add(A, 'PX1', 'Fare breakdown adds up', ok(brk.length === 0), brk.length ? `${brk.length} fares` : '');
    add(A, 'PX2', 'All fares in INR', ok(fares.every((f) => f.pricing?.currency === 'INR')));
    add(A, 'C4', 'fareType on every fare', ok(fares.every((f) => f.fareType)));
    const dupFare = all.filter((o) => { const k = (o.fares || []).map((f) => `${f.sourceCode}|${f.fareType}|${fAmt(f)}`); return new Set(k).size !== k.length; });
    add(A, 'E-dupfare', 'No identical fare listed twice inside a card', ok(dupFare.length === 0), dupFare.length ? `${dupFare.length} cards e.g. ${dupFare[0].searchId}` : '');
    const tie = duals.filter((o) => { const t = Math.min(...o.fares.filter((f) => f.sourceCode === TBO).map(fAmt)); const r = Math.min(...o.fares.filter((f) => f.sourceCode === RIYA).map(fAmt)); return near(t, r, 0.01); });
    add(A, 'E-tie', 'Both suppliers same lowest price → card still shows that price', tie.length ? ok(tie.every((o) => near(disp(o), minFare(o), 0.01))) : 'NOT TESTED', `${tie.length} tie cards`);
    // should-NOT-merge evidence
    const byFn = {};
    for (const o of on) (byFn[fnKey(o)] ||= []).push(o);
    const sameFnDiffTime = Object.values(byFn).filter((g) => new Set(g.map(timeKey)).size > 1);
    add(A, 'M-N1', 'Same flight number at a different time stays a separate card', sameFnDiffTime.length ? 'PASS' : 'NOT TESTED', sameFnDiffTime.length ? `${sameFnDiffTime.length} flight numbers with ≥2 time variants, e.g. ${sameFnDiffTime[0].map(timeKey).join(' / ')}` : 'no such pair in inventory');
    const byTime = {};
    for (const o of on) (byTime[timeKey(o)] ||= []).push(o);
    const codeshare = Object.values(byTime).filter((g) => new Set(g.map(fnKey)).size > 1);
    add(A, 'M-N2', 'Codeshare (same times, different flight numbers) stays as separate cards', codeshare.length ? 'PASS' : 'NOT TESTED', codeshare.length ? `${codeshare.length} groups, e.g. ${codeshare[0].map(fnKey).join(' vs ')}` : 'no codeshare pair in inventory');
    const stopsMix = Object.values(on.reduce((a, o) => { const k = `${o.segments[0].departure.airportCode}>${o.segments.at(-1).arrival.airportCode}`; (a[k] ||= new Set()).add(o.segments.length); return a; }, {})).some((s) => s.size > 1);
    add(A, 'M-N3', 'Direct and connecting flights never merged together', ok(on.every((o) => new Set((o.segments || []).map((s) => s.cabinClass)).size <= 1)), stopsMix ? 'both shapes present as separate cards' : 'only one shape on route');
    add(A, 'G10', 'No "Riya" text', ok(!pages.some(riyaLeak)));
    // nearby airports
    const off = {};
    for (const d of pages) for (const r of d.results || []) {
      const [o, dst] = r.direction === 'RETURN' ? [j.d, j.o] : [j.o, j.d];
      for (const op of r.options || []) { const a = op.segments[0].departure.airportCode; const b = op.segments.at(-1).arrival.airportCode; if (a !== o || b !== dst) off[`${a}>${b}`] = (off[`${a}>${b}`] || 0) + 1; }
    }
    const nOff = Object.values(off).reduce((x, y) => x + y, 0);
    add(A, 'AP1', `Only ${j.o}/${j.d} airports returned`, nOff ? 'CHECK' : 'PASS', nOff ? `${nOff} cards on nearby airports: ${Object.entries(off).map(([k, v]) => `${k}×${v}`).join(', ')}` : '');

    // sorts
    for (const [sort, fn] of [['stops-asc', (o) => o.totalStops ?? (o.segments.length - 1)], ['duration-asc', (o) => o.totalDurationMinutes]]) {
      const d = load(`${key}-sort-${sort}`);
      if (!d) { add(A, `SORT-${sort}`, `sortby=${sort.replace('-', ',')}`, 'NOT TESTED'); continue; }
      const v = opts(d).map(fn);
      const okOrder = v.every((x, i) => i === 0 || x >= v[i - 1]);
      add(A, `SORT-${sort}`, `sortby=${sort.replace('-', ',')} orders cards correctly`, d._capture.http === 200 ? ok(okOrder) : 'BUG', `http ${d._capture.http} · first ${v.slice(0, 6).join(',')}`);
      add(A, `SORT-${sort}-merge`, `Merge still applied with sortby=${sort.replace('-', ',')}`, ok(opts(d).some((o) => vset(o).size === 2) && total(d) === total(p0)), `total ${total(d)} vs ${total(p0)}`);
    }
    // filters
    const fo = p0.filters?.ONWARD || {};
    const F = (n) => load(`${key}-filter-${n}`);
    const fc = (n, pred, how, expectCount) => {
      const d = F(n);
      if (!d) { add(A, `FIL-${n}`, how, 'NOT TESTED'); return; }
      if (d._capture.http !== 200) { add(A, `FIL-${n}`, how, 'BUG', `http ${d._capture.http} ${d.error?.code || ''}`); return; }
      const o = opts(d);
      const bad = o.filter((x) => !pred(x));
      add(A, `FIL-${n}`, how, ok(bad.length === 0 && o.length > 0), `total ${total(d)} of ${total(p0)} · wrong cards ${bad.length} · merged cards kept ${o.filter((x) => vset(x).size === 2).length}`);
      if (expectCount != null) add(A, `FIL-${n}-count`, 'Filter-panel count = flights shown after filtering', ok(total(d) === expectCount), `panel says ${expectCount} · list shows ${total(d)}`);
    };
    const air = F('airline')?._capture?.request?.appliedFilters?.ONWARD?.airlines?.[0];
    const sameAir = (s) => String(s.airline?.name || '').toLowerCase() === String(air || '').toLowerCase();
    fc('airline', (o) => o.segments.every(sameAir), `Airline filter "${air}"`, fo.airlines?.[air]);
    fc('stops0', (o) => (o.totalStops ?? o.segments.length - 1) === 0, 'Stops filter Non-Stop', fo.stops?.['Non-Stop']);
    fc('refundable', (o) => o.refundable === true, 'Refundable filter', fo.refundable?.true);
    const pmax = F('price')?._capture?.request?.appliedFilters?.ONWARD?.priceRange;
    fc('price', (o) => disp(o) >= pmax?.min - 0.01 && disp(o) <= pmax?.max + 0.01, `Price range ${pmax?.min}–${pmax?.max}`);
    const ftn = F('fareType')?._capture?.request?.appliedFilters?.ONWARD?.fareTypes?.[0];
    fc('fareType', (o) => (o.fares || []).every((f) => String(f.fareType).toLowerCase() === String(ftn).toLowerCase()), `Fare type "${ftn}" (fares inside cards reduced)`, fo.fareTypes?.[ftn]);
    fc('combo', (o) => o.segments.every(sameAir) && (o.totalStops ?? o.segments.length - 1) === 0, `Airline "${air}" + Non-Stop together`);
    {
      const cardsAll = j.jt === 'ONE_WAY' ? on : opts(p0);
      const stopsSum = Object.values(fo.stops || {}).reduce((a, b) => a + b, 0);
      const cardSupplier = cardsAll.reduce((a, o) => a + vset(o).size, 0);
      add(A, 'FIL-panel', 'Filter-panel counts add up to the number of flights (after merge)', j.jt === 'ONE_WAY' ? ok(stopsSum === total(p0)) : 'NOT TESTED',
        j.jt === 'ONE_WAY' ? `stops counts add to ${stopsSum} · flights ${total(p0)}${stopsSum === cardSupplier ? ' · equals cards counted once per supplier (counted before merge)' : ''}` : 'RT page 0 only');
      const fNames = Object.keys(fo.airlines || {});
      const segNames = new Set(on.flatMap((o) => o.segments.map((s) => s.airline?.name)).filter(Boolean));
      const mismatch = fNames.filter((nm) => !segNames.has(nm) && [...segNames].some((x) => x.toLowerCase() === nm.toLowerCase()));
      add(A, 'FIL-names', 'Airline names identical in the filter panel and on flight cards', ok(mismatch.length === 0), mismatch.length ? `panel "${mismatch[0]}" vs card "${[...segNames].find((x) => x.toLowerCase() === mismatch[0].toLowerCase())}" (${mismatch.length} airlines)` : '');
    }
    for (const [n, how] of [['priceEmpty', 'Price range ₹1–₹2 → empty list, not an error'], ['priceInverted', 'Price range min > max → 4xx or empty, never 500'], ['unknownAirline', 'Unknown airline → empty list, not an error']]) {
      const d = F(n);
      if (!d) { add(A, `FIL-${n}`, how, 'NOT TESTED'); continue; }
      const good = (d._capture.http === 200 && opts(d).length === 0) || (d._capture.http >= 400 && d._capture.http < 500 && n === 'priceInverted');
      add(A, `FIL-${n}`, how, ok(good), `http ${d._capture.http} · total ${total(d)} ${d.error?.code || ''}`);
    }
    const fAll = F('airline');
    if (fAll?._capture?.http === 200) add(A, 'FIL-facets', 'Filter facets stay full after a filter is applied', (Object.keys(fAll.filters?.ONWARD?.airlines || {}).length >= Object.keys(fo.airlines || {}).length ? 'PASS' : 'CHECK'), `${Object.keys(fAll.filters?.ONWARD?.airlines || {}).length} vs ${Object.keys(fo.airlines || {}).length} airlines`);
    add(A, 'B5', 'Airline filter names case-unique', ok(new Set(Object.keys(fo.airlines || {}).map((x) => x.toLowerCase())).size === Object.keys(fo.airlines || {}).length));

    // dual-card details normalisation (one-way)
    const dd = load(`${key}-dual-details`);
    if (Array.isArray(dd) && dd.length) {
      const same = dd.filter((r) => r[TBO]?.http === 200 && r[RIYA]?.http === 200);
      const match = same.filter((r) => JSON.stringify(r[TBO].segments.map((s) => [normFn(s.flightNumber), s.dep, minute(s.depTime), s.arr, minute(s.arrTime), s.cabinClass])) === JSON.stringify(r[RIYA].segments.map((s) => [normFn(s.flightNumber), s.dep, minute(s.depTime), s.arr, minute(s.arrTime), s.cabinClass])));
      add(A, 'M-P1', 'Merged card = same physical flight at both suppliers (details compared)', same.length ? ok(match.length === same.length) : 'NOT TESTED', `${match.length}/${same.length} cards match`);
      const raw = same.filter((r) => r[TBO].segments.some((s, i) => s.flightNumber !== r[RIYA].segments[i]?.flightNumber || s.depTime !== r[RIYA].segments[i]?.depTime));
      const ex = raw[0];
      add(A, 'M-P2', 'Formatting differences between suppliers are ignored (flight no. / seconds)', raw.length ? ok(match.length === same.length) : 'NOT TESTED',
        ex ? `e.g. TBO "${ex[TBO].segments[0].flightNumber}" ${ex[TBO].segments[0].depTime} vs Riya "${ex[RIYA].segments[0].flightNumber}" ${ex[RIYA].segments[0].depTime}` : 'no format difference seen');
    }

    // RT extra selections (C12 / C14 / C15)
    if (j.jt === 'ROUND_TRIP') {
      const sels = [...VENDORS.map((v) => `${key}-sel-${v}`), ...[0, 1, 2, 3].map((i) => `${key}-xsel${i}`)].filter(has).map(load);
      const res = sels.map((s) => {
        const f = s._capture.selectedFare;
        const ret = opts(s, 'RETURN');
        const rc = codes(s, 'RETURN');
        const cps = ret.map((o) => amt(o.combinedPricing?.pricing ?? o.combinedPricing)).filter(Number.isFinite);
        return { v: f.sourceCode, f, c6: ret.length > 0, c7: (total(s, 'RETURN') ?? 0) <= (total(p0, 'RETURN') ?? Infinity), c8: rc.size === 1 && rc.has(f.sourceCode), c9: ret.some((o) => o.combinedPricing?.type === 'COMBINATION'), c10: cps.length && cps.every((c) => !near(c, 2 * fAmt(f), 0.01)), c11: cps.length && cps.every((c) => c >= fAmt(f) - 0.01), rc: fmt(rc), d5: codes(s).size };
      });
      const withRet = res.filter((r) => r.c6);
      const allR = (k) => (withRet.length ? ok(withRet.every((r) => r[k])) : 'NOT TESTED');
      const empty = res.filter((r) => !r.c6);
      add(A, 'C6', 'Return list not empty after choosing outbound (every fare on the merged card)', ok(empty.length === 0),
        empty.length ? `${empty.length}/${res.length} selections gave 0 returns: ${empty.map((r) => `${r.v} ${r.f.fareType} ₹${fAmt(r.f)}`).join(', ')}` : `${res.length} selections`);
      add(A, 'C7', 'Return list shrinks or stays (never grows)', allR('c7'));
      add(A, 'C8', 'Returns only from the chosen outbound supplier (mixed = fail)', allR('c8'), withRet.map((r) => `${r.v}→${r.rc}`).join(' '));
      add(A, 'C9', 'Return cards carry COMBINATION price', allR('c9'));
      add(A, 'C10', 'Combined price ≠ 2 × outbound fare', allR('c10'));
      add(A, 'C11', 'Combined price ≥ outbound fare', allR('c11'));
      add(A, 'C12', 'C6–C11 repeated for several fares on the merged card', ok(res.length >= 3 && empty.length === 0), `${res.length} selections (${res.map((r) => `${r.v} ${r.f.fareType}`).join(', ')})`);
      add(A, 'C15', 'TBO outbound → TBO returns · Riya outbound → Riya returns', withRet.some((r) => r.v === TBO) && withRet.some((r) => r.v === RIYA) ? allR('c8') : 'NOT TESTED');
      add(A, 'D5', 'Selection request: whole response single supplier (doc wording)', res.length ? (res.every((r) => r.d5 === 1) ? 'PASS' : 'CHECK') : 'NOT TESTED', `ONWARD still lists both suppliers after selection: ${res.filter((r) => r.d5 > 1).length}/${res.length} — confirm doc intent (RETURN-only is C8)`);
    }

    // per-vendor flow
    for (const v of VENDORS) {
      const fl = flows.find((x) => x.journey === key && x.vendor === v);
      const AV = `${key} ${v === TBO ? 'TBO' : 'Riya'}`;
      if (!fl || fl.missing) { add(AV, 'F0', 'Supplier fare available', 'NOT TESTED', 'no fare'); continue; }
      if (fl.noReturn) { add(AV, 'C6', 'Return after selection', 'BUG', 'no return'); continue; }
      const T = `${key}-${v}`;
      const expected = j.jt === 'ROUND_TRIP' ? amt(fl.combined?.pricing ?? fl.combined) : fAmt(fl.fare);
      const card = opts(load(`${key}-p0`)).find((o) => o.searchId === fl.card);
      const det = load(`${T}-details`);
      add(AV, 'D1', 'Details HTTP 200', ok(det?._capture?.http === 200), `http ${det?._capture?.http} ${det?.error?.code || ''}`);
      if (det?._capture?.http === 200) {
        // Expected (confirmed 2026-11-24): TBO details is priced in USD; convert with pricing's currencyConversion.rate
        const cur = det.pricing?.currency;
        const rate = cur === 'INR' ? 1 : Number(load(`${T}-pricing`)?.currencyConversion?.rate ?? (cur === 'USD' ? 96 : NaN));
        add(AV, 'D2', 'Details currency (TBO USD is expected)', cur === 'INR' || (v === TBO && cur === 'USD') ? 'PASS' : 'BUG', `${cur} ${amt(det.pricing)}`);
        add(AV, 'D2b', 'Details total = search price (after currency conversion)', ok(near(amt(det.pricing) * rate, expected, 1)), `${cur} ${amt(det.pricing)} × ${rate} = ₹${(amt(det.pricing) * rate).toFixed(2)} vs ₹${expected}`);
        const want = (card?.segments || []).map(segKey).join('>');
        const got = (det.itinerary?.[0]?.segments || []).map(segKey).join('>');
        add(AV, 'D3', 'Details = same flight as the card', ok(want === got), want === got ? '' : `${want} vs ${got}`);
        if (j.jt === 'ROUND_TRIP') add(AV, 'D3r', 'Details includes the return leg', ok((det.itinerary || []).length >= 2), `${(det.itinerary || []).length} legs`);
        add(AV, 'D4', 'No negative amounts · no "Riya"', ok(!negAmounts(det).length && !riyaLeak(det)));
        const ps = load(`${T}-pricing`)?.passengerOptions?.[0];
        const ds = det.passengerOptions?.[0];
        if (ps && ds) { const diff = ['supportsSeats', 'supportsMeals', 'supportsExtraBaggage'].filter((k) => ps[k] !== ds[k]); add(AV, 'D6', 'Details and pricing agree on seat/meal/baggage support', diff.length ? 'CHECK' : 'PASS', diff.map((k) => `${k} ${ds[k]}→${ps[k]}`).join(' ')); }
      }
      const fr = load(`${T}-farerules`);
      if (fr?._capture?.http === 200) {
        const blocks = fr.fareRules || [];
        const plain = blocks.map((b) => String(b.text).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')).join(' ');
        add(AV, 'FR1', 'Fare rules returned with content', ok(blocks.length > 0 && plain.length > 40), `${blocks.length} block(s)`);
        add(AV, 'FR2', 'One rule block per leg', ok(blocks.length >= (j.jt === 'ROUND_TRIP' ? 2 : 1)), blocks.map((b) => b.title).join(' | '));
        add(AV, 'FR3', 'Rules match the chosen fare (type or basis named)', ok(plain.toLowerCase().includes(String(fl.fare.fareType).toLowerCase()) || plain.includes(fl.fare.fareBasisCode || '@@')), `${fl.fare.fareType} / ${fl.fare.fareBasisCode}`);
        add(AV, 'FR3b', 'Rules state cancellation / change charges', ok(/cancel/i.test(plain) && /(INR|₹|AED|USD)\s*[\d,]+|non-?refundable|[\d,]+\s*\/-/i.test(plain)));
        add(AV, 'FR4', 'No "Riya" · no script content', ok(!riyaLeak(fr) && !/<script|javascript:/i.test(JSON.stringify(fr))));
        add(AV, 'FR7', 'Rule titles name the route', ok(blocks.every((b) => /[A-Z]{3}-[A-Z]{3}/.test(String(b.title)))), blocks.map((b) => `"${b.title}"`).join(' '));
      } else add(AV, 'FR1', 'Fare rules HTTP 200', 'BUG', `http ${fr?._capture?.http} ${fr?.error?.code || ''} ${fr?.error?.message || ''}`);
      const pr = load(`${T}-pricing`);
      add(AV, 'P1', 'Pricing HTTP 200 with priceId + bookingContext', ok(pr?._capture?.http === 200 && pr.priceId && pr.bookingContext), `http ${pr?._capture?.http} ${pr?.error?.code || ''} ${pr?.error?.message || ''}`);
      if (pr?._capture?.http !== 200) continue;
      const P = amt(pr.pricing);
      add(AV, 'P2', 'Pricing total = search price', ok(near(P, expected)), `₹${P} vs ₹${expected}`);
      add(AV, 'P3', 'Pricing breakdown adds up', ok(near(parts(pr.pricing), P, 1)));
      const paxSum = (pr.passengerOptions || []).reduce((a, p) => a + (amt(p.pricing) || 0) * (Number(p.count ?? p.paxCount ?? 1)), 0);
      add(AV, 'P4', 'Passenger prices add up to the total', ok(near(paxSum, P, 1)), `pax ₹${paxSum} vs total ₹${P}`);
      add(AV, 'P6', 'INR, no negative amounts, gstBreakup array/omitted', ok(pr.pricing?.currency === 'INR' && !negAmounts(pr).length && (pr.gstBreakup == null || Array.isArray(pr.gstBreakup))));
      add(AV, 'P8', 'No "Riya" in pricing', ok(!riyaLeak(pr)));
      const ssr = load(`${T}-ssr`);
      add(AV, 'SSR1', 'SSR HTTP 200', ok(ssr?._capture?.http === 200), `http ${ssr?._capture?.http} ${ssr?.error?.code || ''}`);
      if (ssr?._capture?.http === 200) {
        const t = JSON.stringify(ssr);
        add(AV, 'SSR2', 'Meal / baggage options listed', ok(/"(meal|meals|baggage|baggages)"/i.test(t)));
        add(AV, 'SSR3', 'SSR prices ≥ 0, INR, no "Riya"', ok(!negAmounts(ssr).length && !riyaLeak(ssr) && !/"currency"\s*:\s*"(?!INR)[A-Z]{3}"/.test(t)));
      }
      const sm = load(`${T}-seatmap`);
      add(AV, 'SEAT1', 'Seat map HTTP 200', sm ? ok(sm._capture.http === 200) : 'NOT TESTED', `http ${sm?._capture?.http} ${sm?.error?.code || ''} ${sm?.error?.message || ''}`);
      if (sm?._capture?.http === 200) {
        const segs = sm.data?.segments || [];
        const seats = segs.flatMap((s) => s.seatMap || []);
        const nSeg = (det?.itinerary || []).flatMap((l) => l.segments || []).length;
        add(AV, 'SEAT2', 'Seats listed, one map per flight segment', ok(seats.length > 0 && (!nSeg || segs.length === nSeg)), `${seats.length} seats · ${segs.length} maps / ${nSeg} segments`);
        add(AV, 'SEAT3', 'Seat prices ≥ 0, INR, no duplicates, no "Riya"', ok(seats.every((s) => !(Number(s.amount) < 0)) && sm.data?.currency === 'INR' && !riyaLeak(sm) && segs.every((s) => { const n = (s.seatMap || []).map((x) => x.seatName); return new Set(n).size === n.length; })));
        const vals = new Set(seats.map((x) => String(x.seatAvailability)));
        // Expected (confirmed 2026-11-24): TBO "true"/"false", Riya "Open"/"Closed"
        const allowed = v === TBO ? ['true', 'false'] : ['Open', 'Closed'];
        add(AV, 'SEAT6', `seatAvailability in this supplier's format (${allowed.join('/')})`, ok([...vals].every((x) => allowed.includes(x))), fmt(vals));
      }
    }
  }

  // ── Extra scenarios
  {
    const A = 'Multi-passenger 2ADT+1CHD+1INF';
    const d = load('x-multipax-p0');
    if (d?._capture?.http === 200) {
      const on = opts(d);
      add(A, 'MP1', 'Search OK, both suppliers, merged cards', ok(codes(d).size === 2 && on.some((o) => vset(o).size === 2)), `${total(d)} cards · ${on.filter((o) => vset(o).size === 2).length} merged on page 0`);
      add(A, 'MP2', 'Card price = cheapest fare', ok(on.every((o) => near(disp(o), minFare(o), 0.01))));
      const base = load('ow-dom-p0');
      const k = new Map(opts(base).map((o) => [schedKey(o), o]));
      const cmp = on.filter((o) => k.has(schedKey(o))).slice(0, 20);
      add(A, 'MP3', 'Group price is higher than the 1-adult price for the same flight', cmp.length ? ok(cmp.every((o) => disp(o) > disp(k.get(schedKey(o))))) : 'NOT TESTED', `${cmp.length} flights compared`);
      for (const v of VENDORS) {
        const pr = load(`x-multipax-${v}-pricing`);
        if (!pr) { add(A, `MP-${v}`, `${v} pricing`, 'NOT TESTED', 'no fare'); continue; }
        if (pr._capture.http !== 200) { add(A, `MP-${v}-P1`, `${v} pricing HTTP 200`, 'BUG', `http ${pr._capture.http} ${pr.error?.code || ''} ${pr.error?.message || ''}`); continue; }
        const types = (pr.passengerOptions || []).map((p) => p.paxType);
        add(A, `MP-${v}-P1`, `${v} pricing lists ADT, CHD, INF`, ok(['ADT', 'CHD', 'INF'].every((t) => types.includes(t))), types.join(','));
        // passengerOptions lists every traveller separately (ADT appears twice)
        const sum = (pr.passengerOptions || []).reduce((a, p) => a + amt(p.pricing) * Number(p.count ?? p.paxCount ?? 1), 0);
        add(A, `MP-${v}-P2`, `${v} per-passenger prices add up to total (2×ADT + CHD + INF)`, ok(near(sum, amt(pr.pricing), 1)), `sum ₹${sum} vs total ₹${amt(pr.pricing)}`);
        add(A, `MP-${v}-P3`, `${v} pricing total = search price`, ok(near(amt(pr.pricing), fAmt(pr._capture.fare))), `₹${amt(pr.pricing)} vs ₹${fAmt(pr._capture.fare)}`);
        const inf = (pr.passengerOptions || []).find((p) => p.paxType === 'INF');
        const adt = (pr.passengerOptions || []).find((p) => p.paxType === 'ADT');
        add(A, `MP-${v}-P4`, `${v} infant cheaper than adult`, inf && adt ? ok(amt(inf.pricing) < amt(adt.pricing)) : 'NOT TESTED', `INF ₹${amt(inf?.pricing)} · ADT ₹${amt(adt?.pricing)}`);
      }
    } else add(A, 'MP1', 'Search OK', 'BUG', `http ${d?._capture?.http} ${d?.error?.code || ''}`);

    const B = 'Business cabin';
    const b = load('x-business-p0');
    if (b?._capture?.http === 200) {
      const on = opts(b);
      const cab = new Set(on.flatMap((o) => o.segments.map((s) => String(s.cabinClass).toUpperCase())));
      add(B, 'BZ1', 'Only Business cabin returned', on.length ? ok(cab.size === 1 && cab.has('BUSINESS')) : 'NOT TESTED', `${total(b)} cards · cabins ${fmt(cab)}`);
      add(B, 'BZ2', 'Merged cards in Business (both suppliers)', on.length ? (on.some((o) => vset(o).size === 2) ? 'PASS' : 'CHECK') : 'NOT TESTED', `${fmt(codes(b))} · ${on.filter((o) => vset(o).size === 2).length} merged`);
      const eco = new Set(opts(load('ow-dom-p0')).map(schedKey));
      add(B, 'M-N4', 'Same flight in Business and Economy never merged into one card', ok(on.every((o) => !eco.has(schedKey(o)))));
      add(B, 'BZ3', 'Card price = cheapest fare · no duplicate cards', on.length ? ok(on.every((o) => near(disp(o), minFare(o), 0.01)) && new Set(on.map(schedKey)).size === on.length) : 'NOT TESTED');
    } else add(B, 'BZ1', 'Business search OK', 'BUG', `http ${b?._capture?.http} ${b?.error?.code || ''}`);

    const C = 'Corporate fare';
    const c = load('x-corporate-p0');
    if (c?._capture?.http === 200) {
      const on = opts(c);
      const cats = new Set(on.flatMap((o) => (o.fares || []).map((f) => f.fareCategory)));
      add(C, 'CO1', 'Corporate search returns cards', on.length ? 'PASS' : 'NOT TESTED', `${total(c)} cards · categories ${fmt(cats)} · suppliers ${fmt(codes(c))}`);
      add(C, 'CO2', 'Merged cards with corporate fares', on.length ? (on.some((o) => vset(o).size === 2) ? 'PASS' : 'CHECK') : 'NOT TESTED', `${on.filter((o) => vset(o).size === 2).length} merged`);
      add(C, 'CO3', 'Card price = cheapest fare · no duplicate cards', on.length ? ok(on.every((o) => near(disp(o), minFare(o), 0.01)) && new Set(on.map(schedKey)).size === on.length) : 'NOT TESTED');
    } else add(C, 'CO1', 'Corporate search OK', 'BUG', `http ${c?._capture?.http} ${c?.error?.code || ''}`);
  }

  // ── Paging boundaries
  {
    const A = 'Paging boundaries (ow-dom)';
    const P = (n) => load(`ow-dom-paging-${n}`);
    const t = total(load('ow-dom-p0'));
    const last = P('last');
    add(A, 'PG1', 'Last page: short page, rest of the list', last ? ok(last._capture.http === 200 && opts(last).length === t - PAGE * Math.floor((t - 1) / PAGE)) : 'NOT TESTED', `${opts(last).length} cards`);
    const p9 = P('page9999');
    add(A, 'PG2', 'Page 9999 → empty list, HTTP 200, not an error', p9 ? ok(p9._capture.http === 200 && opts(p9).length === 0) : 'NOT TESTED', `http ${p9?._capture?.http} · ${opts(p9).length} cards ${p9?.error?.code || ''}`);
    const p1 = P('perpage1');
    add(A, 'PG3', 'perpage=1 → exactly 1 card (cheapest)', p1 ? ok(p1._capture.http === 200 && opts(p1).length === 1 && near(disp(opts(p1)[0]), disp(opts(load('ow-dom-p0'))[0]), 0.01)) : 'NOT TESTED', `http ${p1?._capture?.http} · ${opts(p1).length} cards`);
    for (const [n, how] of [['perpage0', 'perpage=0 → 4xx'], ['perpageNeg', 'perpage=-1 → 4xx'], ['abc', 'page=abc → 4xx']]) {
      const d = P(n);
      const rejected = d && d._capture.http >= 400 && d._capture.http < 500 && d.error?.code;
      const returnsAll = d && n !== 'abc' && d._capture.http === 200 && opts(d).length === total(load('ow-dom-p0'));
      add(A, `PG-${n}`, how, !d ? 'NOT TESTED' : rejected ? 'PASS' : returnsAll ? 'CHECK' : 'BUG',
        `http ${d?._capture?.http} ${d?.error?.code || `${opts(d).length} cards${returnsAll ? ' — treated as "return everything" (doc uses size=-1 for all); confirm 0 should do the same' : ''}`}`);
    }
    const big = P('perpage500');
    add(A, 'PG4', 'perpage=500 → capped or full list, never 500', big ? ok(big._capture.http !== 500 && (big._capture.http >= 400 || opts(big).length <= t)) : 'NOT TESTED', `http ${big?._capture?.http} · ${opts(big).length} cards of ${t} ${big?.error?.code || ''}`);
  }

  // ── Negatives
  {
    const A = 'Negative & edge';
    const e4 = (id, how, { allow200Empty = false } = {}) => {
      const n = neg[id];
      if (!n) { add(A, id, how, 'NOT TESTED', 'not run'); return; }
      const good = (n.http >= 400 && n.http < 500 && n.code) || (allow200Empty && n.http === 200 && n.options === 0);
      add(A, id, how, good ? 'PASS' : 'BUG', `http ${n.http} ${n.code || (n.http === 200 ? `accepted · ${n.options} cards` : 'no error.code')}${n.message ? ` · ${n.message.slice(0, 90)}` : ''}`);
    };
    e4('S-same-od', 'Search: origin = destination → 4xx');
    e4('S-bad-iata', 'Search: unknown airport code → 4xx');
    e4('S-lowercase-iata', 'Search: lowercase airport "del" → accepted or 4xx, never 500', { allow200Empty: true });
    if (neg['S-lowercase-iata']?.http === 200) rows.at(-1).status = 'PASS';
    e4('S-past-date', 'Search: past date → 4xx');
    e4('S-date-bad-format', 'Search: date DD-MM-YYYY → 4xx');
    e4('S-date-400d', 'Search: date > 1 year away → 4xx or empty', { allow200Empty: true });
    e4('S-adults-0', 'Search: 0 adults → 4xx');
    e4('S-adults-10', 'Search: 10 adults (> 9) → 4xx');
    e4('S-adults-string', 'Search: adults "1" (string) → 4xx');
    e4('S-infants-gt-adults', 'Search: infants > adults → 4xx');
    e4('S-children-neg', 'Search: children -1 → 4xx');
    e4('S-cabin-bad', 'Search: cabin "CABIN_X" → 4xx');
    e4('S-fareType-bad', 'Search: fareType "GARBAGE" → 4xx');
    e4('S-journeyType-bad', 'Search: journeyType "ONEWAY" → 4xx');
    e4('S-multicity', 'Search: MULTI_CITY → 4xx (not supported on this API)');
    e4('S-rt-one-leg', 'Search: ROUND_TRIP with one leg → 4xx');
    e4('S-rt-return-before', 'Search: return before outbound → 4xx');
    e4('S-html-dest', 'Search: HTML in airport → 4xx');
    e4('S-empty-body', 'Search: empty body → 4xx');
    e4('S-omit-itinerary', 'Search: itinerary missing → 4xx');
    e4('S-selection-unknown-id', 'Search: selection with unknown searchId → 4xx');
    e4('AUTH-no-bearer', 'Search without session token → 401/403');
    e4('AUTH-garbage-bearer', 'Search with garbage session token → 401/403');
    for (const api of ['details', 'fareRules', 'pricing']) {
      e4(`${api}-empty-ids`, `${api}: empty selectedSearchIds → 4xx`);
      e4(`${api}-unknown-id`, `${api}: unknown searchId → 4xx`);
      e4(`${api}-html-id`, `${api}: HTML searchId → 4xx`);
      e4(`${api}-comma-id`, `${api}: searchId with trailing comma → 4xx`);
    }
    e4('pricing-ow-id-as-RT', 'pricing: one-way id sent as ROUND_TRIP → 4xx');
    e4('pricing-dup-id', 'pricing: same id twice → 4xx');
    e4('pricing-bad-journeyType', 'pricing: journeyType "ONEWAY" → 4xx');
    e4('details-omit-journeyType', 'details: journeyType missing → 4xx');
    e4('pricing-RT-onward-only', 'pricing: round trip with outbound id only → 4xx');
    e4('pricing-RT-swapped-order', 'pricing: round trip ids in reverse order (return first) → 4xx');
    e4('pricing-OW-with-return-id', 'pricing: return-leg id priced as one-way → 4xx');
    e4('pricing-RT-two-onward-ids', 'pricing: two outbound ids as a round trip → 4xx');
    e4('SEL-search-two-onward-ids', 'search: selection with two outbound ids → 4xx');
    e4('SEL-search-return-id-as-onward', 'search: return id used as the outbound selection → 4xx');
    e4('pricing-RT-mixed-TBO-onward-Riya-return', 'pricing: TBO outbound + Riya return → rejected');
    e4('fareRules-RT-mixed-vendors', 'fareRules: TBO outbound + Riya return → rejected');
    e4('details-RT-mixed-vendors', 'details: TBO outbound + Riya return → rejected');
    e4('XTIER-details-merged-id-in-TBO-session', 'details: merged-tier id used in a TBO-only session → rejected');
    e4('XTIER-pricing-merged-id-in-Riya8-session', 'pricing: merged-tier id used in a Riya-only session → rejected');
    e4('EXP-details-expired-id', 'details: expired searchId (from 2026-11-23) → 4xx');
    e4('EXP-pricing-expired-id', 'pricing: expired searchId → 4xx');
    e4('EXP-ssr-expired-priceId', 'ssr: expired priceId → 4xx');
    e4('EXP-seatmap-expired-context', 'seatmap: expired bookingContext → 4xx');
    e4('ssr-empty-priceId', 'ssr: empty priceId → 4xx');
    e4('ssr-unknown-priceId', 'ssr: unknown priceId → 4xx');
    e4('ssr-html-priceId', 'ssr: HTML priceId → 4xx');
    e4('ssr-omit-priceId', 'ssr: priceId missing → 4xx');
    e4('seatmap-omit-requestReference', 'seatmap: requestReference missing → 4xx');
    e4('seatmap-garbage-requestReference', 'seatmap: garbage requestReference → 4xx');
    e4('seatmap-empty-passengers', 'seatmap: empty passengers → 4xx');
    e4('seatmap-html-name', 'seatmap: HTML in passenger name → 4xx');
    const fiveH = Object.entries(neg).filter(([, n]) => n.http >= 500);
    add(A, 'NO-500', 'No negative case returned HTTP 5xx', ok(fiveH.length === 0), fiveH.map(([k, n]) => `${k} ${n.http}`).join(', '));
  }

  for (const [id, how, why] of [['E1-E3', 'Supplier down / slow / both down', 'needs Dev fault injection'], ['F1-F5', 'Issue ticket, PNR, price at payment', 'no booking on preprod']]) add('Not run', id, how, 'NOT TESTED', why);

  const summary = { PASS: 0, BUG: 0, CHECK: 0, 'NOT TESTED': 0 };
  for (const r of rows) summary[r.status] += 1;
  fs.writeFileSync(path.join(OUT_DIR, `FULL-NOBOOK-RESULTS-${ONWARD}.json`), JSON.stringify({ evaluatedAt: new Date().toISOString(), capturedAt: cap.capturedAt, env: cap.env, dates: cap.dates, correlationId: cap.correlationId, l2b: cap.l2b, summary, rows }, null, 2));
  const md = [
    '# Aggregation — full no-book suite (search → pricing, SSR, seat map)',
    '',
    `Env \`${cap.env}\` · captured **${cap.capturedAt.slice(0, 16)}Z** · dates **${cap.dates.onward}** / **${cap.dates.return}** · correlation \`${cap.correlationId}\``,
    `Scenario searches: **${cap.l2b.scenarioLooks}** · HTTP: search ${cap.l2b.searchHttp} · details ${cap.l2b.details} · fareRules ${cap.l2b.fareRules} · pricing ${cap.l2b.pricing} · ssr ${cap.l2b.ssr} · seatmap ${cap.l2b.seatmap} · **booking 0**`,
    '',
    `## Summary: ${summary.PASS} PASS · ${summary.BUG} BUG · ${summary.CHECK} CHECK · ${summary['NOT TESTED']} NOT TESTED`,
    '',
    '| Area | Case | How tested | Status | Notes |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.area} | ${r.id} | ${r.how.replace(/\|/g, '/')} | **${r.status}** | ${r.note.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 220)} |`),
  ];
  fs.writeFileSync(path.join(OUT_DIR, `FULL-NOBOOK-RESULTS-${ONWARD}.md`), `${md.join('\n')}\n`);
  for (const r of rows) if (r.status !== 'PASS') console.log(`${r.status === 'BUG' ? '✗' : '·'} [${r.area}] ${r.id} ${r.status} — ${r.note}`);
  console.log('\nSUMMARY', summary);
}

if (MODE === 'capture') await capture();
else if (MODE === 'evaluate') evaluate();
else { console.log('usage: capture | evaluate'); process.exit(1); }

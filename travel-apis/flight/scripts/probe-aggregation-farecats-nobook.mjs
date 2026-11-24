/**
 * Aggregation × fare categories — does TBO + Riya merging happen for NORMAL, SME and CORPORATE fares?
 * Merged tier 22101801 · fareType "NORMAL,SME,CORPORATE" · search only (no details/pricing/book).
 *
 * Looks: OW DEL→BOM and OW DEL→DXB, once each. All pages and every fareCategories filter re-use that search.
 *   node travel-apis/flight/scripts/probe-aggregation-farecats-nobook.mjs capture
 *   node travel-apis/flight/scripts/probe-aggregation-farecats-nobook.mjs evaluate
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const MODE = process.argv[2] || 'evaluate';
const BASE = 'https://preprod-api.travelvip.ai';
const TIER = 22101801;
const ONWARD = process.env.AGG_ONWARD || '2026-12-15';
const FARE_TYPE = 'NORMAL,SME,CORPORATE';
const CATS = ['NORMAL', 'SME', 'CORPORATE'];
const PAGE = 50;
const OUT = path.resolve('travel-apis/flight/reports/aggregation-tbo-riya-preprod');
const DIR = path.join(OUT, `farecats-nobook-${ONWARD}`);
const ROUTES = { dom: ['DEL', 'BOM'], intl: ['DEL', 'DXB'] };
const FILTERS = { NORMAL: ['NORMAL'], SME: ['SME'], CORPORATE: ['CORPORATE'], ALL3: CATS };

const opts = (d) => (d?.results || []).find((r) => r.direction === 'ONWARD')?.options || [];
const vset = (o) => new Set((o.fares || []).map((f) => f.sourceCode));
const cat = (f) => String(f.fareCategory || '').toUpperCase() || '(empty)';
const fn = (s) => String(s.flightNumber).toUpperCase().replace(/[\s-]/g, '');
const key = (o) => o.segments.map((s) => `${fn(s)}|${s.departure.airportCode}|${String(s.departure.time).slice(0, 16)}|${s.arrival.airportCode}|${String(s.arrival.time).slice(0, 16)}|${s.cabinClass}`).join('>');
const amt = (f) => Number(f?.pricing?.totalAmount);
const disp = (o) => Number(o?.displayPricing?.pricing?.totalAmount);

async function capture() {
  if (fs.existsSync(path.join(DIR, 'capture.json'))) { console.log('Already captured — use evaluate.'); process.exit(3); }
  fs.mkdirSync(DIR, { recursive: true });
  const pm = JSON.parse(fs.readFileSync(`${process.env.USERPROFILE}/Downloads/B2B preprod.postman_environment.json`, 'utf8'));
  const g = (k) => (pm.values || []).filter((v) => v.key === k && v.value).at(-1)?.value;
  const SIGN = g('signing_key');
  const corr = crypto.randomUUID();
  const ledger = [];
  let access; let auth;
  const post = async (p, body, tag, signed = true) => {
    if (!/^\/(auth\/partner\/token|v1\/auth\/session|v1\/flights\/search)(\?|$)/.test(p)) throw new Error(`blocked ${p}`);
    const h = { 'content-type': 'application/json', 'X-Request-Id': `req-${crypto.randomBytes(8).toString('hex')}`, 'X-Correlation-ID': corr };
    if (access) h['X-Partner-Key'] = access;
    if (auth) h.Authorization = `Bearer ${auth}`;
    const payload = JSON.stringify(body);
    if (signed) { const ts = String(Math.floor(Date.now() / 1000)); h['X-Timestamp'] = ts; h['X-Signature'] = crypto.createHmac('sha256', SIGN).update(payload + ts).digest('hex'); }
    const t0 = Date.now();
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: h, body: payload });
    const data = await r.json().catch(() => ({}));
    ledger.push({ at: new Date(t0).toISOString(), tag, http: r.status, ms: Date.now() - t0, state: data?.progress?.state || data?.error?.code, cacheTimeStamp: data?.cacheTimeStamp ?? null });
    console.log(`  ${tag} http=${r.status} ${data?.progress?.state || data?.error?.code || ''} ${Date.now() - t0}ms total=${JSON.stringify(data?.totalResults || '')}`);
    return { http: r.status, data };
  };
  access = (await post('/auth/partner/token', { partner_id: g('partner_id') || 'vgm', partner_secret: g('partner_secret') }, 'token', false)).data.access_token;
  auth = (await post('/v1/auth/session', { tierId: TIER }, 'session', false)).data.auth_token;
  const body = (o, d, applied = {}) => ({
    itinerary: [{ origin: o, destination: d, date: ONWARD }], travellers: { adults: 1, children: 0, infants: 0 }, cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY', currency: 'INR', language: 'en', preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: applied, selection: { selectedSearchIds: [] }, fareType: FARE_TYPE,
  });
  const q = (page) => `/v1/flights/search?lang=en&currency=INR&page=${page}&perpage=${PAGE}&sortby=fare,asc`;
  for (const [r, [o, d]] of Object.entries(ROUTES)) {
    let base;
    for (let i = 1; i <= 14; i += 1) {
      base = await post(q(0), body(o, d), `${r}-p0#${i}`);
      const st = base.data?.progress?.state;
      if (base.http >= 400 || !st || st === 'COMPLETE') break;
      await new Promise((x) => setTimeout(x, base.data?.progress?.pollAfterMs || 2500));
    }
    fs.writeFileSync(path.join(DIR, `${r}-p0.json`), JSON.stringify(base.data, null, 2));
    const ts = base.data?.cacheTimeStamp;
    const pages = Math.ceil((base.data?.totalResults?.ONWARD || 0) / PAGE);
    for (let p = 1; p < Math.min(pages, 12); p += 1) {
      const x = await post(q(p), body(o, d), `${r}-p${p}`);
      if (x.data?.cacheTimeStamp !== ts) { console.log('  !! page came from a new search — stopping'); break; }
      fs.writeFileSync(path.join(DIR, `${r}-p${p}.json`), JSON.stringify(x.data, null, 2));
    }
    for (const [name, cats] of Object.entries(FILTERS)) {
      const x = await post(q(0), body(o, d, { ONWARD: { fareCategories: cats } }), `${r}-filter-${name}`);
      fs.writeFileSync(path.join(DIR, `${r}-filter-${name}.json`), JSON.stringify({ _applied: cats, ...x.data }, null, 2));
    }
  }
  fs.writeFileSync(path.join(DIR, 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), env: BASE, tier: TIER, fareType: FARE_TYPE, date: ONWARD, correlationId: corr, booking: 0, ledger }, null, 2));
}

function evaluate() {
  const L = (n) => (fs.existsSync(path.join(DIR, `${n}.json`)) ? JSON.parse(fs.readFileSync(path.join(DIR, `${n}.json`), 'utf8')) : null);
  const cap = L('capture');
  const out = { capturedAt: cap.capturedAt, fareType: FARE_TYPE, date: ONWARD, routes: {} };
  for (const r of Object.keys(ROUTES)) {
    const p0 = L(`${r}-p0`);
    const pages = [p0];
    for (let p = 1; L(`${r}-p${p}`); p += 1) pages.push(L(`${r}-p${p}`));
    const cards = pages.flatMap(opts);
    const fares = cards.flatMap((o) => o.fares);
    const catBySup = {};
    for (const f of fares) { const k = `${f.sourceCode} ${cat(f)}`; catBySup[k] = (catBySup[k] || 0) + 1; }
    const ftBySup = {};
    for (const f of fares) { const k = `${f.sourceCode} ${cat(f)} · ${f.fareType}`; ftBySup[k] = (ftBySup[k] || 0) + 1; }
    const merged = cards.filter((o) => vset(o).size === 2);
    // per category: cards where BOTH suppliers have a fare of that category on the same card
    const perCat = {};
    for (const c of [...CATS, '(empty)']) {
      const withCat = cards.filter((o) => o.fares.some((f) => cat(f) === c));
      const bothSup = withCat.filter((o) => new Set(o.fares.filter((f) => cat(f) === c).map((f) => f.sourceCode)).size === 2);
      const supOnly = {};
      for (const o of withCat) { const s = [...new Set(o.fares.filter((f) => cat(f) === c).map((f) => f.sourceCode))].sort().join('+'); supOnly[s] = (supOnly[s] || 0) + 1; }
      perCat[c] = { cardsWithThisCategory: withCat.length, cardsWhereBothSuppliersHaveIt: bothSup.length, bySupplier: supOnly, example: bothSup[0] ? { flight: bothSup[0].segments.map((s) => s.flightNumber).join('+'), fares: bothSup[0].fares.filter((f) => cat(f) === c).map((f) => `${f.sourceCode} ${f.fareType} ₹${amt(f)}`) } : null };
    }
    // duplicates of same physical flight across cards (merge failure)
    const byKey = {};
    for (const o of cards) (byKey[key(o)] ||= []).push(o);
    const dupFlights = Object.entries(byKey).filter(([, v]) => v.length > 1).map(([k, v]) => ({ flight: k, cards: v.map((o) => [...vset(o)].join('+')) }));
    const priceOk = cards.filter((o) => Math.abs(disp(o) - Math.min(...o.fares.map(amt))) > 0.01).length;
    // same flight with corporate fares from one supplier and normal from the other — kept on one card?
    const mixedCatCards = merged.filter((o) => {
      const t = new Set(o.fares.filter((f) => f.sourceCode === '402T').map(cat));
      const rr = new Set(o.fares.filter((f) => f.sourceCode === '422R').map(cat));
      return [...t].some((x) => !rr.has(x)) || [...rr].some((x) => !t.has(x));
    }).length;
    const facet = p0.filters?.ONWARD?.fareCategories;
    const filters = {};
    for (const name of Object.keys(FILTERS)) {
      const f = L(`${r}-filter-${name}`);
      const o = opts(f);
      const wrong = o.filter((x) => x.fares.some((fa) => !f._applied.includes(cat(fa))));
      filters[name] = {
        http: f?.error ? f.error.code : 'ok', applied: f._applied, total: f.totalResults?.ONWARD, page0Cards: o.length,
        mergedCards: o.filter((x) => vset(x).size === 2).length, suppliers: [...new Set(o.flatMap((x) => [...vset(x)]))],
        cardsWithFaresOutsideFilter: wrong.length, facetSays: name === 'ALL3' ? null : facet?.[name] ?? 0,
      };
    }
    out.routes[r] = {
      route: ROUTES[r].join('→'), searchState: p0.progress?.state, totalResults: p0.totalResults?.ONWARD, cardsRead: cards.length,
      suppliers: [...new Set(fares.map((f) => f.sourceCode))], mergedCards: merged.length, faresByCategory: catBySup, facetFareCategories: facet,
      perCategory: perCat, duplicateFlightCards: dupFlights.length, duplicateExamples: dupFlights.slice(0, 3),
      cardsWherePriceNotCheapest: priceOk, mergedCardsMixingCategoriesAcrossSuppliers: mixedCatCards, filters, fareTypesBySupplier: ftBySup,
    };
  }
  fs.writeFileSync(path.join(OUT, `FARECATS-RESULTS-${ONWARD}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, (k, v) => (k === 'fareTypesBySupplier' ? undefined : v), 1));
}

if (MODE === 'capture') await capture();
else evaluate();

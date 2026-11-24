/**
 * Cross-tier check: search on tier A, then details + pricing with a session for tier B.
 * Tiers: 22101801 (TBO+Riya) · 22157551 (TBO only) · 8 (Riya only) · 15 (Riya only).
 *
 * Look budget: OW DEL→BOM 2026-12-15 on each tier, same criteria as today's earlier runs (served from cache).
 * For each search tier: one TBO (402T) fare + one Riya (422R) fare → details + pricing under all 4 tier sessions.
 * No booking: only search / details / pricing are reachable.
 *
 *   node travel-apis/flight/scripts/probe-aggregation-crosstier-nobook.mjs capture
 *   node travel-apis/flight/scripts/probe-aggregation-crosstier-nobook.mjs evaluate
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MODE = process.argv[2] || 'evaluate';
const BASE = 'https://preprod-api.travelvip.ai';
const TIERS = { 22101801: ['402T', '422R'], 22157551: ['402T'], 8: ['422R'], 15: ['422R'] };
const NAME = { 22101801: 'merged TBO+Riya', 22157551: 'TBO only', 8: 'Riya only', 15: 'Riya only' };
const ONWARD = '2026-12-15';
const OUT = path.resolve('travel-apis/flight/reports/aggregation-tbo-riya-preprod');
const DIR = path.join(OUT, `crosstier-nobook-${ONWARD}`);
const Q = '?lang=en&currency=INR';

async function capture() {
  if (fs.existsSync(path.join(DIR, 'capture.json'))) { console.log('Already captured — use evaluate.'); process.exit(3); }
  fs.mkdirSync(DIR, { recursive: true });
  const pm = JSON.parse(fs.readFileSync(`${process.env.USERPROFILE}/Downloads/B2B preprod.postman_environment.json`, 'utf8'));
  const g = (k) => (pm.values || []).filter((v) => v.key === k && v.value).at(-1)?.value;
  const SIGN = g('signing_key');
  const corr = crypto.randomUUID();
  const ledger = [];
  let access;
  const auth = {};
  const post = async (p, body, tag, tier, signed = true) => {
    if (!/^\/(auth\/partner\/token|v1\/auth\/session|v1\/flights\/(search|details|pricing))(\?|$)/.test(p)) throw new Error(`blocked ${p}`);
    const h = { 'content-type': 'application/json', 'X-Request-Id': `req-${crypto.randomBytes(8).toString('hex')}`, 'X-Correlation-ID': corr };
    if (access) h['X-Partner-Key'] = access;
    if (tier && auth[tier]) h.Authorization = `Bearer ${auth[tier]}`;
    const payload = JSON.stringify(body);
    if (signed) { const ts = String(Math.floor(Date.now() / 1000)); h['X-Timestamp'] = ts; h['X-Signature'] = crypto.createHmac('sha256', SIGN).update(payload + ts).digest('hex'); }
    const t0 = Date.now();
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: h, body: payload });
    const data = await r.json().catch(() => ({}));
    ledger.push({ at: new Date(t0).toISOString(), tag, tier, http: r.status, ms: Date.now() - t0, code: data?.error?.code || null, state: data?.progress?.state || null, cacheTimeStamp: data?.cacheTimeStamp ?? null });
    console.log(`  ${tag} [session ${tier}] http=${r.status} ${data?.progress?.state || data?.error?.code || ''} ${Date.now() - t0}ms`);
    return { http: r.status, data };
  };
  access = (await post('/auth/partner/token', { partner_id: g('partner_id') || 'vgm', partner_secret: g('partner_secret') }, 'token', null, false)).data.access_token;
  for (const t of Object.keys(TIERS)) auth[t] = (await post('/v1/auth/session', { tierId: Number(t) }, `session-${t}`, null, false)).data.auth_token;

  const body = {
    itinerary: [{ origin: 'DEL', destination: 'BOM', date: ONWARD }], travellers: { adults: 1, children: 0, infants: 0 }, cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY', currency: 'INR', language: 'en', preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {}, selection: { selectedSearchIds: [] }, fareType: 'NORMAL',
  };
  const out = { searches: {}, calls: [] };
  for (const st of Object.keys(TIERS)) {
    let s;
    for (let i = 1; i <= 12; i += 1) {
      s = await post(`/v1/flights/search${Q}&page=0&perpage=50&sortby=fare,asc`, body, `search#${i}`, st);
      if (s.http >= 400 || !s.data?.progress?.state || s.data.progress.state === 'COMPLETE') break;
      await new Promise((x) => setTimeout(x, s.data?.progress?.pollAfterMs || 2500));
    }
    fs.writeFileSync(path.join(DIR, `search-tier${st}.json`), JSON.stringify(s.data, null, 2));
    const opts = s.data?.results?.[0]?.options || [];
    const pick = (v) => opts.flatMap((o) => o.fares.map((f) => ({ f, card: o }))).find(({ f }) => f.sourceCode === v);
    out.searches[st] = { http: s.http, total: s.data?.totalResults?.ONWARD, cacheTimeStamp: s.data?.cacheTimeStamp, firstSearchId: opts[0]?.searchId, suppliers: [...new Set(opts.flatMap((o) => o.fares.map((f) => f.sourceCode)))] };
    for (const v of ['402T', '422R']) {
      const hit = pick(v);
      if (!hit) { out.calls.push({ searchTier: st, vendor: v, missing: true }); continue; }
      for (const session of Object.keys(TIERS)) {
        const prev = out.calls.find((c) => c.searchId === hit.f.searchId && c.sessionTier === session && !c.reusedFrom);
        if (prev) { out.calls.push({ ...prev, searchTier: st, reusedFrom: prev.searchTier }); continue; } // identical searchId already tried — no extra supplier hit
        const sel = { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [hit.f.searchId] } };
        const d = await post(`/v1/flights/details${Q}`, sel, `details ${v} searched-on ${st}`, session);
        const p = await post(`/v1/flights/pricing${Q}`, sel, `pricing ${v} searched-on ${st}`, session);
        out.calls.push({
          searchTier: st, sessionTier: session, vendor: v, searchId: hit.f.searchId, fare: { fareType: hit.f.fareType, total: hit.f.pricing.totalAmount, flight: hit.card.segments.map((x) => x.flightNumber).join('+') },
          details: { http: d.http, code: d.data?.error?.code || null, message: d.data?.error?.message || null, total: d.data?.pricing?.totalAmount ?? null, currency: d.data?.pricing?.currency ?? null },
          pricing: { http: p.http, code: p.data?.error?.code || null, message: p.data?.error?.message || null, priceId: Boolean(p.data?.priceId), bookingContext: Boolean(p.data?.bookingContext), total: p.data?.pricing?.totalAmount ?? null },
        });
      }
    }
  }
  fs.writeFileSync(path.join(DIR, 'matrix.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(DIR, 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), correlationId: corr, booking: 0, ledger }, null, 2));
}

function evaluate() {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'matrix.json'), 'utf8'));
  const cap = JSON.parse(fs.readFileSync(path.join(DIR, 'capture.json'), 'utf8'));
  console.log(`captured ${cap.capturedAt} · correlation ${cap.correlationId}`);
  console.log('\nSEARCHES');
  for (const [t, s] of Object.entries(m.searches)) console.log(`  tier ${t} (${NAME[t]}) http=${s.http} total=${s.total} suppliers=${s.suppliers.join('+')} cacheTS=${s.cacheTimeStamp} firstId=${s.firstSearchId}`);
  console.log('\nMATRIX  (allowed = the session tier has this supplier configured AND it is the tier that searched)');
  const rows = [];
  for (const c of m.calls) {
    if (c.missing) { rows.push({ ...c, verdict: 'NOT TESTED' }); continue; }
    const supplierAllowed = TIERS[c.sessionTier].includes(c.vendor);
    const sameTier = c.searchTier === c.sessionTier;
    const accepted = c.pricing.http === 200 && c.pricing.priceId;
    const detAccepted = c.details.http === 200;
    let verdict;
    if (sameTier && supplierAllowed) verdict = accepted ? 'PASS (own tier)' : `VENDOR (${c.pricing.code})`;
    else if (!supplierAllowed) verdict = accepted || detAccepted ? 'BUG — supplier not configured on session tier, still accepted' : 'PASS — rejected';
    else verdict = accepted || detAccepted ? 'BUG — searchId from another tier accepted' : 'PASS — rejected';
    rows.push({ ...c, verdict });
    console.log(`  search ${String(c.searchTier).padEnd(8)} → session ${String(c.sessionTier).padEnd(8)} ${c.vendor}  details ${c.details.http} ${c.details.code || ''}  pricing ${c.pricing.http} ${c.pricing.code || (c.pricing.priceId ? 'priceId' : '')} ₹${c.pricing.total ?? '-'}  → ${verdict}`);
  }
  fs.writeFileSync(path.join(OUT, `CROSSTIER-RESULTS-${ONWARD}.json`), JSON.stringify({ capturedAt: cap.capturedAt, searches: m.searches, rows }, null, 2));
}

if (MODE === 'capture') await capture();
else evaluate();

/**
 * Focused retest after TBO returned — A1/A3/A4/B9/B10/DET3/C3/C15 + related.
 * Through details/pricing. No book.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const pm = JSON.parse(
  fs.readFileSync(`${process.env.USERPROFILE}/Downloads/B2B preprod.postman_environment.json`, 'utf8'),
);
const getPm = (k) => {
  const hits = (pm.values || []).filter((v) => v.key === k && v.value);
  return hits[hits.length - 1]?.value;
};

const BASE = 'https://preprod-api.travelvip.ai';
const PARTNER_ID = getPm('partner_id') || 'vgm';
const PARTNER_SECRET = getPm('partner_secret') || process.env.PARTNER_SECRET;
const SIGNING_KEY = getPm('signing_key') || process.env.SIGNING_KEY;
const MERGED = 22101801;
const TBO_ONLY = 22157551;
const RIYA = 8;
const ONWARD = '2026-12-14';
const RETURN = '2026-12-21';
const OUT = path.resolve('travel-apis/flight/reports/aggregation-tbo-riya-preprod');
const DUMP = path.join(OUT, 'dumps-retest');
fs.mkdirSync(DUMP, { recursive: true });

const rows = [];
const dumps = {};
const rid = () => `req-${crypto.randomBytes(8).toString('hex')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function add(id, how, status, evidence = {}) {
  rows.push({ id, how, status, ...evidence });
  console.log(`${status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·'} ${id} ${status}${evidence.note ? ` — ${evidence.note}` : ''}`);
}

function save(name, obj) {
  const p = path.join(DUMP, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  dumps[name] = p;
}

async function post(pathname, { body, access, auth, signed = false } = {}) {
  const headers = {
    'content-type': 'application/json',
    'X-Request-Id': rid(),
    'X-Correlation-ID': crypto.randomUUID(),
  };
  if (access) headers['X-Partner-Key'] = access;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (signed && payload) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers['X-Timestamp'] = ts;
    headers['X-Signature'] = crypto.createHmac('sha256', SIGNING_KEY).update(payload + ts).digest('hex');
  }
  const r = await fetch(`${BASE}${pathname}`, { method: 'POST', headers, body: payload });
  const data = await r.json().catch(() => ({}));
  return { http: r.status, data };
}

function owBody(o = 'DEL', d = 'DXB') {
  return {
    itinerary: [{ origin: o, destination: d, date: ONWARD }],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ONE_WAY',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function rtBody(o = 'DEL', d = 'DXB') {
  return {
    itinerary: [
      { origin: o, destination: d, date: ONWARD },
      { origin: d, destination: o, date: RETURN },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
    fareType: 'NORMAL',
  };
}

function opts(data, dir = 'ONWARD') {
  const block = (data?.results || []).find((r) => String(r.direction).toUpperCase() === dir)
    || (dir === 'ONWARD' ? data?.results?.[0] : null);
  return block?.options || [];
}

function codes(data, dir = null) {
  const s = new Set();
  for (const r of data?.results || []) {
    if (dir && String(r.direction).toUpperCase() !== dir) continue;
    for (const o of r.options || []) {
      for (const f of o.fares || []) if (f.sourceCode) s.add(String(f.sourceCode));
    }
  }
  return s;
}

function pickFare(data, sourceCode) {
  for (const r of data?.results || []) {
    for (const o of r.options || []) {
      for (const f of o.fares || []) {
        if (String(f.sourceCode) === sourceCode && f.searchId) return { fare: f, option: o };
      }
    }
  }
  return null;
}

function pickDual(data) {
  for (const o of opts(data)) {
    const s = new Set((o.fares || []).map((f) => f.sourceCode).filter(Boolean));
    if (s.has('402T') && s.has('422R')) return o;
  }
  return null;
}

async function searchUntil(access, auth, body, label, maxAttempts = 12) {
  let last = null;
  for (let i = 1; i <= maxAttempts; i += 1) {
    last = await post('/v1/flights/search?lang=en&currency=INR&page=0&perpage=50&sortby=fare,asc', {
      body, access, auth, signed: true,
    });
    const state = last.data?.progress?.state;
    const n = (last.data?.results || []).reduce((a, r) => a + (r.options?.length || 0), 0);
    console.log(`  ${label} #${i} ${last.http} ${state || last.data?.error?.code} opts=${n}`);
    if (last.http >= 400 || state === 'COMPLETE' || state === 'FAILED') return last;
    await sleep(last.data?.progress?.pollAfterMs || 2000);
  }
  return last;
}

async function session(access, tierId) {
  const res = await post('/v1/auth/session', { body: { tierId }, access });
  return { ok: Boolean(res.data?.auth_token), auth: res.data?.auth_token, http: res.http, err: res.data };
}

const tok = await post('/auth/partner/token', {
  body: { partner_id: PARTNER_ID, partner_secret: PARTNER_SECRET },
});
const access = tok.data.access_token;
console.log('token', Boolean(access));

const sess = {};
// Isolate TBO first (avoid cross-tier session/cache bleed seen when priming merged before TBO)
for (const t of [TBO_ONLY, RIYA, MERGED]) {
  sess[t] = await session(access, t);
  console.log('session', t, sess[t].http, sess[t].ok, 'tier_id', sess[t].err?.tier_id || 'auth_ok');
}

// A1 TBO-only — search immediately after its session
const owTbo = await searchUntil(access, sess[TBO_ONLY].auth, owBody(), 'OW-TBO');
save('ow-tbo', { sessionTier: TBO_ONLY, ...owTbo.data });
{
  const c = codes(owTbo.data);
  add('A1', 'TBO-only 22157551 CODES=={402T}', c.size === 1 && c.has('402T') ? 'PASS' : 'BUG', {
    codes: [...c], opts: opts(owTbo.data).length,
  });
}

// A2 Riya
const owRiya = await searchUntil(access, sess[RIYA].auth, owBody(), 'OW-Riya8');
save('ow-riya8', { sessionTier: RIYA, ...owRiya.data });
{
  const c = codes(owRiya.data);
  add('A2', 'Riya tier 8 CODES=={422R}', c.size === 1 && c.has('422R') ? 'PASS' : 'BUG', {
    codes: [...c], opts: opts(owRiya.data).length,
  });
}

// A3/A4 merged OW
const owMerged = await searchUntil(access, sess[MERGED].auth, owBody(), 'OW-merged');
save('ow-merged', { sessionTier: MERGED, ...owMerged.data });
const cMerged = codes(owMerged.data);
const dual = pickDual(owMerged.data);
const nMerged = opts(owMerged.data).length;
const nTbo = opts(owTbo.data).length;
const nRiya = opts(owRiya.data).length;

add('A3', 'Merged CODES both vendors', cMerged.has('402T') && cMerged.has('422R') ? 'PASS' : 'BUG', {
  codes: [...cMerged], opts: nMerged,
});
add('A4', '∃ dual-vendor option', dual ? 'PASS' : 'BUG', {
  dual: Boolean(dual), searchId: dual?.searchId,
});

if (dual) {
  const segs = dual.segments || [];
  const okSeg = segs.every((s) => s.flightNumber && s.departure?.time && s.arrival?.time && s.cabinClass);
  add('B9', 'Merged card segments FN/times/cabin', okSeg ? 'PASS' : 'BUG', { segs: segs.length });
  const per = {};
  for (const f of dual.fares || []) per[f.sourceCode] = (per[f.sourceCode] || 0) + 1;
  add('B10', 'Merged card keeps both vendor fares', per['402T'] > 0 && per['422R'] > 0 ? 'PASS' : 'BUG', { per });
} else {
  add('B9', 'Merged card segments', 'NOT TESTED', { note: 'no dual' });
  add('B10', 'Fare retention', 'NOT TESTED', { note: 'no dual' });
}

add('B3', 'N(merged) >= max(N(TBO),N(Riya))', nMerged >= Math.max(nTbo, nRiya) ? 'PASS' : 'BUG', {
  nMerged, nTbo, nRiya,
});
add('B4', 'N(merged) <= N(TBO)+N(Riya)', nMerged <= nTbo + nRiya ? 'PASS' : 'BUG', {
  nMerged, nTbo, nRiya,
});

// Details both vendors
for (const code of ['422R', '402T']) {
  const picked = pickFare(owMerged.data, code);
  if (!picked) {
    add(`DET-${code}`, `Details ${code}`, 'NOT TESTED', { note: 'fare missing' });
    continue;
  }
  const d = await post('/v1/flights/details?lang=en&currency=INR', {
    body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [picked.fare.searchId] } },
    access,
    auth: sess[MERGED].auth,
    signed: true,
  });
  save(`details-${code}`, d.data);
  add(code === '402T' ? 'DET3' : 'DET1', `Details API ${code}`, d.http === 200 && !d.data?.error ? 'PASS' : 'BUG', {
    http: d.http, code: d.data?.error?.code, searchId: picked.fare.searchId,
  });
  const p = await post('/v1/flights/pricing?lang=en&currency=INR', {
    body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [picked.fare.searchId] } },
    access,
    auth: sess[MERGED].auth,
    signed: true,
  });
  save(`pricing-${code}`, p.data);
  const searchAmt = Number(picked.fare.pricing?.totalAmount);
  const priceAmt = Number(p.data?.pricing?.totalAmount ?? p.data?.price?.totalAmount);
  const fee = Number(p.data?.pricing?.convenienceFee ?? 0);
  add(code === '402T' ? 'DET4' : 'DET2', `Pricing API ${code}`, p.http === 200 && !p.data?.error ? 'PASS' : 'BUG', {
    http: p.http, searchAmt, priceAmt, convenienceFee: fee,
  });
}

// RT merged — C3 + C15
const rt = await searchUntil(access, sess[MERGED].auth, rtBody(), 'RT-merged', 18);
save('rt-merged', rt.data);
{
  const c = codes(rt.data);
  const nOn = opts(rt.data, 'ONWARD').length;
  const nRet = opts(rt.data, 'RETURN').length;
  add('C1', 'RT ONWARD+RETURN', nOn > 0 && nRet > 0 ? 'PASS' : 'BUG', { nOn, nRet });
  add('C3', 'RT CODES both vendors', c.has('402T') && c.has('422R') ? 'PASS' : 'BUG', { codes: [...c] });

  const onward = opts(rt.data, 'ONWARD');
  const dualRt = onward.find((o) => {
    const s = new Set((o.fares || []).map((f) => f.sourceCode));
    return s.has('402T') && s.has('422R');
  }) || onward[0];

  async function select(fare, tag) {
    const after = await searchUntil(access, sess[MERGED].auth, {
      ...rtBody(),
      selection: { selectedSearchIds: [fare.searchId] },
    }, `RT-sel-${tag}`, 10);
    save(`rt-sel-${tag}`, after.data);
    const nAfter = opts(after.data, 'RETURN').length;
    const rc = codes(after.data, 'RETURN');
    return { nAfter, rc, selected: fare.sourceCode };
  }

  if (dualRt) {
    const tboF = (dualRt.fares || []).find((f) => f.sourceCode === '402T');
    const riyaF = (dualRt.fares || []).find((f) => f.sourceCode === '422R');
    if (tboF) {
      const r = await select(tboF, 'tbo');
      add('C15a', 'Select TBO onward → return follows 402T', r.nAfter > 0 && r.rc.size === 1 && r.rc.has('402T') ? 'PASS' : 'BUG', {
        nAfter: r.nAfter, returnCodes: [...r.rc],
      });
    } else add('C15a', 'Select TBO onward', 'NOT TESTED', { note: 'no 402T on card' });
    if (riyaF) {
      const r = await select(riyaF, 'riya');
      add('C15b', 'Select Riya onward → return follows 422R', r.nAfter > 0 && r.rc.size === 1 && r.rc.has('422R') ? 'PASS' : 'BUG', {
        nAfter: r.nAfter, returnCodes: [...r.rc],
      });
    } else add('C15b', 'Select Riya onward', 'NOT TESTED', { note: 'no 422R on card' });
    const c15 = rows.filter((r) => r.id.startsWith('C15'));
    add('C15', 'TBO vs Riya onward selection', c15.every((r) => r.status === 'PASS') ? 'PASS' : (c15.some((r) => r.status === 'BUG') ? 'BUG' : 'NOT TESTED'));
  } else {
    add('C15', 'TBO vs Riya onward', 'NOT TESTED', { note: 'no onward options' });
  }
}

// C13 DEL-BOM quick
const rtBom = await searchUntil(access, sess[MERGED].auth, rtBody('DEL', 'BOM'), 'RT-BOM', 15);
save('rt-bom', rtBom.data);
{
  const c = codes(rtBom.data);
  const nOn = opts(rtBom.data, 'ONWARD').length;
  const nRet = opts(rtBom.data, 'RETURN').length;
  add('C13', 'DEL-BOM RT both vendors + both dirs', nOn > 0 && nRet > 0 && c.has('402T') && c.has('422R') ? 'PASS' : 'BUG', {
    nOn, nRet, codes: [...c],
  });
}

const summary = {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
  NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
};
const report = {
  checkedAt: new Date().toISOString(),
  searchMinute: new Date().toISOString().slice(0, 16),
  env: BASE,
  dates: { onward: ONWARD, return: RETURN },
  note: 'Focused TBO-back retest through details/pricing; no book',
  summary,
  rows,
  dumps,
};
fs.writeFileSync(path.join(OUT, 'TBO-RETEST-RESULTS.json'), JSON.stringify(report, null, 2));
const md = [
  '# TBO-back retest results',
  '',
  `Checked: **${report.checkedAt}** · \`${BASE}\` · DEL–DXB/BOM ${ONWARD}/${RETURN}`,
  '',
  `## Summary: ${summary.PASS} PASS · ${summary.BUG} BUG · ${summary.NOT_TESTED} NOT TESTED`,
  '',
  '| Case | How | Status | Notes |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.how} | **${r.status}** | ${(r.note || (r.codes ? `codes=${JSON.stringify(r.codes)}` : '') || '').toString().slice(0, 140)} |`),
  '',
];
fs.writeFileSync(path.join(OUT, 'TBO-RETEST-RESULTS.md'), md.join('\n'));
console.log('\n=== SUMMARY ===', summary);
console.log('Report:', path.join(OUT, 'TBO-RETEST-RESULTS.md'));

/**
 * First-page search latency: 10 cities — preprod vs prod (Postman-style cold compare).
 * Same dates on both envs, fired in parallel so neither warms the other.
 * Captures: ms, fromCache, totalResults, page n, approx bytes, 5★ facet count, EARLY/FULL shape.
 * Search only, no book.
 *
 *   node scripts/probe-hotel-first-page-timing-10cities.js
 *   SAME_DATES=0  → different dates per env (legacy)
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const PRE = 'https://preprod-api.travelvip.ai';
const PROD = 'https://api.travelvip.ai';
const PID = 'vgm';
const SAME_DATES = String(process.env.SAME_DATES || '1') !== '0';
const OUT_JSON = path.join('reports', 'hotel-first-page-timing-10cities.json');
const OUT_MD = path.join('reports', 'hotel-first-page-timing-10cities.md');

process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const CITIES = [
  { key: 'Delhi', entityId: '227760:IN', size: 'large' },
  { key: 'Mumbai', entityId: '357389:IN', size: 'large' },
  { key: 'Dubai', entityId: '221688:AE', size: 'large' },
  { key: 'Bangkok', entityId: '328619:TH', size: 'large' },
  { key: 'Paris', entityId: '437227:FR', size: 'large' },
  { key: 'Jaipur', entityId: '227736:IN', size: 'mid' },
  { key: 'Kochi', entityId: '329184:IN', size: 'mid' },
  { key: 'Pune', entityId: '228371:IN', size: 'mid' },
  { key: 'Manali', entityId: '334045:IN', size: 'small' },
  { key: 'Rishikesh', entityId: '329199:IN', size: 'small' },
];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/** Fresh cold dates — bump high so we don't collide with prior Oct/Dec probes. */
function dates(seed, envBump = 0) {
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + 220 + seed * 4 + envBump);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + 1);
  return { checkin: ymd(checkin), checkout: ymd(checkout) };
}

function body(entityId, d) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: d.checkin,
    checkout: d.checkout,
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
}

function starFacetMap(data) {
  const filters = Array.isArray(data.filters) ? data.filters : [];
  const star = filters.find((f) =>
    /star/i.test(`${f.name || ''}${f.indexField || ''}${f.facetField || ''}`),
  );
  const out = {};
  for (const x of star?.facets || []) {
    const key = String(x.facetKey ?? x.name ?? '').replace(/\s*Star\s*/i, '').trim() || '?';
    out[key] = Number(x.count ?? x.docCount ?? 0);
  }
  return out;
}

function shapeOf(total) {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 'EMPTY';
  if (t < 80) return 'EARLY';
  if (t >= 200) return 'FULL';
  return 'MID';
}

async function auth(base) {
  process.env.BASE_URL = base;
  clearSession();
  const s = await authenticate(true);
  s.client.setPartnerKey(s.accessToken);
  return { hotel: new HotelService(s.client), correlationId: s.client.correlationId, base };
}

async function firstPage(hotel, entityId, d) {
  const t0 = Date.now();
  const res = await hotel.search(body(entityId, d), {
    pid: PID,
    page: 0,
    perpage: 20,
    sort: 'price_DESC',
  });
  const ms = Date.now() - t0;
  const data = res.data || {};
  const raw = JSON.stringify(data);
  const stars = starFacetMap(data);
  const total = data.totalResults ?? null;
  return {
    ms,
    http: res.status,
    ok: Boolean(res.ok),
    total,
    n: Array.isArray(data.results) ? data.results.length : 0,
    fromCache: data.fromCache ?? null,
    cacheTimeStamp: data.cacheTimeStamp ?? null,
    bytes: Buffer.byteLength(raw, 'utf8'),
    star5: stars['5'] ?? stars['5 Star'] ?? null,
    star4: stars['4'] ?? stars['4 Star'] ?? null,
    stars,
    shape: shapeOf(total),
    top3: (data.results || []).slice(0, 3).map((h) => h.name),
  };
}

function fmt(r) {
  return `${r.ms}ms · t=${r.total} · n=${r.n} · cache=${r.fromCache} · 5★=${r.star5 ?? '-'} · ${r.bytes}B · ${r.shape}`;
}

async function main() {
  console.log(
    `=== First-page timing: 10 cities · preprod vs prod · SAME_DATES=${SAME_DATES} (parallel cold) ===`,
  );
  const preAuth = await auth(PRE);
  const prodAuth = await auth(PROD);
  const rows = [];

  for (let i = 0; i < CITIES.length; i += 1) {
    const city = CITIES[i];
    const preDates = dates(i, 0);
    const prodDates = SAME_DATES ? preDates : dates(i, 19);

    console.log(`\n${city.key} [${city.size}] entityId=${city.entityId}`);
    console.log(`  dates PRE ${preDates.checkin}→${preDates.checkout} | PROD ${prodDates.checkin}→${prodDates.checkout}`);

    // Parallel cold: neither env warms the other for the same criteria
    const [pre, prod] = await Promise.all([
      firstPage(preAuth.hotel, city.entityId, preDates),
      firstPage(prodAuth.hotel, city.entityId, prodDates),
    ]);

    console.log(`  PRE  ${fmt(pre)}`);
    console.log(`  PROD ${fmt(prod)}`);

    rows.push({
      city: city.key,
      size: city.size,
      entityId: city.entityId,
      preprod: { base: PRE, dates: preDates, ...pre },
      prod: { base: PROD, dates: prodDates, ...prod },
      deltaMs: prod.ms - pre.ms,
      faster: pre.ms < prod.ms ? 'preprod' : prod.ms < pre.ms ? 'prod' : 'tie',
    });
  }

  const summary = {
    sameDates: SAME_DATES,
    preAvg: Math.round(rows.reduce((s, r) => s + r.preprod.ms, 0) / rows.length),
    prodAvg: Math.round(rows.reduce((s, r) => s + r.prod.ms, 0) / rows.length),
    preEarly: rows.filter((r) => r.preprod.shape === 'EARLY').length,
    prodEarly: rows.filter((r) => r.prod.shape === 'EARLY').length,
    preFull: rows.filter((r) => r.preprod.shape === 'FULL').length,
    prodFull: rows.filter((r) => r.prod.shape === 'FULL').length,
    bothCacheFalse: rows.filter((r) => r.preprod.fromCache === false && r.prod.fromCache === false).length,
    preprodFaster: rows.filter((r) => r.faster === 'preprod').length,
    prodFaster: rows.filter((r) => r.faster === 'prod').length,
  };

  const report = {
    at: new Date().toISOString(),
    noBook: true,
    note:
      'Postman-style first page. SAME_DATES=1 fires pre+prod in parallel. EARLY=total<80, FULL=total>=200. Includes 5★ facet + bytes.',
    preCorrelation: preAuth.correlationId,
    prodCorrelation: prodAuth.correlationId,
    summary,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [];
  md.push('# First-page search — 10 cities (preprod vs prod, cold)');
  md.push('');
  md.push(`- Preprod: \`${PRE}\``);
  md.push(`- Prod: \`${PROD}\``);
  md.push(
    `- Dates: **${SAME_DATES ? 'same on both envs, parallel cold' : 'different per env'}**`,
  );
  md.push(`- Avg: **preprod ${summary.preAvg}ms** · **prod ${summary.prodAvg}ms**`);
  md.push(
    `- Shape EARLY: preprod **${summary.preEarly}/10** · prod **${summary.prodEarly}/10** · FULL: pre **${summary.preFull}** / prod **${summary.prodFull}**`,
  );
  md.push(`- Both \`fromCache:false\`: **${summary.bothCacheFalse}/10**`);
  md.push('');
  md.push(
    '| # | City | Size | Dates | Preprod | Prod | Faster |',
  );
  md.push('|---|------|------|-------|---------|------|--------|');
  rows.forEach((r, idx) => {
    const d = `${r.preprod.dates.checkin}`;
    md.push(
      `| ${idx + 1} | ${r.city} | ${r.size} | ${d} | **${(r.preprod.ms / 1000).toFixed(1)}s** · t=${r.preprod.total} · cache=${r.preprod.fromCache} · 5★=${r.preprod.star5 ?? '-'} · ${r.preprod.shape} | **${(r.prod.ms / 1000).toFixed(1)}s** · t=${r.prod.total} · cache=${r.prod.fromCache} · 5★=${r.prod.star5 ?? '-'} · ${r.prod.shape} | ${r.faster} |`,
    );
  });
  md.push('');
  md.push('Legend: **EARLY** = totalResults &lt; 80 (progressive first batch) · **FULL** = total ≥ 200 · cache = `fromCache` · 5★ = star facet count.');
  fs.writeFileSync(OUT_MD, md.join('\n'));

  console.log('\n======== COMPARE ========');
  console.log(`Avg PRE ${summary.preAvg}ms | Avg PROD ${summary.prodAvg}ms`);
  console.log(
    `EARLY PRE ${summary.preEarly}/10 | PROD ${summary.prodEarly}/10 | both cache=false ${summary.bothCacheFalse}/10`,
  );
  for (const r of rows) {
    console.log(
      `${r.city.padEnd(10)} PRE ${(r.preprod.ms / 1000).toFixed(1).padStart(5)}s t=${String(r.preprod.total).padStart(5)} ${r.preprod.shape.padEnd(5)} | PROD ${(r.prod.ms / 1000).toFixed(1).padStart(5)}s t=${String(r.prod.total).padStart(5)} ${r.prod.shape.padEnd(5)} | ${r.faster}`,
    );
  }
  console.log('Wrote', OUT_MD, OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

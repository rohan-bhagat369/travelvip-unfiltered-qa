/**
 * Progressive hotel search — preprod vs prod (search only, no book).
 * Fresh dates; poll same criteria to see if totalResults grows (early → full).
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const PRE = 'https://preprod-api.travelvip.ai';
const PROD = 'https://api.travelvip.ai';
const PID = 'vgm';
const OUT = path.join('reports', 'hotel-riya-progressive-preprod-vs-prod.json');
const OUT_MD = path.join('reports', 'hotel-riya-progressive-preprod-vs-prod.md');

process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const CITIES = [
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Dubai', entityId: '221688:AE' },
];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function freshDates(offset) {
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + 45 + offset);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + 2);
  return { checkin: ymd(checkin), checkout: ymd(checkout), adults: 1 + (offset % 2) };
}

function body(entityId, dates) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: dates.checkin,
    checkout: dates.checkout,
    type: 'CITY',
    rooms: [{ adults: dates.adults, children: 0, childrenAges: [] }],
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

async function auth(baseUrl) {
  process.env.BASE_URL = baseUrl;
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  return {
    hotel: new HotelService(session.client),
    correlationId: session.client.correlationId,
  };
}

async function search(hotel, entityId, dates) {
  const t0 = Date.now();
  const res = await hotel.search(body(entityId, dates), { pid: PID, offset: 0, limit: 20 });
  const ms = Date.now() - t0;
  const d = res.data || {};
  return {
    http: res.status,
    ok: Boolean(res.ok),
    ms,
    total: Number(d.totalResults ?? NaN),
    n: Array.isArray(d.results) ? d.results.length : 0,
    fromCache: d.fromCache ?? null,
    requestId: d.requestId || null,
    top: (d.results || []).slice(0, 3).map((h) => ({
      id: h.id,
      name: h.name,
      price: h.price?.totalAmount ?? h.price?.baseFare,
    })),
  };
}

/** Cold search + polls every 4s to detect early→full growth. */
async function progressiveProbe(hotel, entityId, dates, polls = 6) {
  const series = [];
  for (let i = 0; i < polls; i += 1) {
    series.push(await search(hotel, entityId, dates));
    if (i < polls - 1) await sleep(4000);
  }
  const first = series[0];
  const maxTotal = Math.max(...series.map((s) => (Number.isFinite(s.total) ? s.total : 0)));
  const grew = maxTotal > first.total * 1.5 || (first.total < 100 && maxTotal > 200);
  return {
    firstMs: first.ms,
    firstTotal: first.total,
    finalTotal: series[series.length - 1].total,
    maxTotal,
    grew,
    earlyLike: first.ms <= 14000 && first.total > 0 && first.total < 80,
    fullWaitLike: first.ms >= 18000 && first.total >= 200,
    series: series.map((s, i) => ({
      i,
      ms: s.ms,
      total: s.total,
      n: s.n,
      fromCache: s.fromCache,
    })),
  };
}

async function main() {
  console.log('=== Progressive search: preprod vs prod (cold, search only) ===');
  const preAuth = await auth(PRE);
  const prodAuth = await auth(PROD);

  const cityResults = [];
  for (let i = 0; i < CITIES.length; i += 1) {
    const city = CITIES[i];
    // Different dates per env so caches don't collide; same city
    const preDates = freshDates(20 + i * 5);
    const prodDates = freshDates(21 + i * 5);
    console.log(`\n## ${city.key}`);
    console.log('  preprod dates', preDates);
    const pre = await progressiveProbe(preAuth.hotel, city.entityId, preDates);
    console.log('  preprod first', pre.firstMs, 'ms total', pre.firstTotal, '→ max', pre.maxTotal, 'grew', pre.grew);
    console.log('  prod dates', prodDates);
    const prod = await progressiveProbe(prodAuth.hotel, city.entityId, prodDates);
    console.log('  prod first', prod.firstMs, 'ms total', prod.firstTotal, '→ max', prod.maxTotal, 'grew', prod.grew);
    cityResults.push({ city: city.key, entityId: city.entityId, preDates, prodDates, pre, prod });
  }

  // Parallel race on both envs
  console.log('\n## Parallel x3 (same criteria)');
  const parallel = {};
  for (const [label, authObj, dates] of [
    ['preprod', preAuth, freshDates(80)],
    ['prod', prodAuth, freshDates(81)],
  ]) {
    const entityId = '357389:IN';
    const t0 = Date.now();
    const triple = await Promise.all([
      search(authObj.hotel, entityId, dates),
      search(authObj.hotel, entityId, dates),
      search(authObj.hotel, entityId, dates),
    ]);
    parallel[label] = {
      dates,
      wallMs: Date.now() - t0,
      runs: triple.map((t) => ({ ms: t.ms, total: t.total, n: t.n, fromCache: t.fromCache })),
      totals: triple.map((t) => t.total),
      shortVsFull: Math.max(...triple.map((t) => t.total)) > 200
        && Math.min(...triple.map((t) => t.total)) < 100,
    };
    console.log(label, parallel[label].runs.map((r) => `${r.ms}ms/t=${r.total}`).join(' | '),
      'shortVsFull', parallel[label].shortVsFull);
  }

  const summary = {
    preprodEarlyPattern: cityResults.filter((c) => c.pre.earlyLike || c.pre.grew).length,
    prodEarlyPattern: cityResults.filter((c) => c.prod.earlyLike || c.prod.grew).length,
    preprodFullWait: cityResults.filter((c) => c.prod.fullWaitLike === false && c.pre.fullWaitLike).length,
    verdict: null,
  };
  const preHasProgressive = cityResults.some((c) => c.pre.grew || c.pre.earlyLike);
  const prodHasProgressive = cityResults.some((c) => c.prod.grew || c.prod.earlyLike);
  if (preHasProgressive && !prodHasProgressive) {
    summary.verdict = 'Progressive early→full visible on preprod; prod still full-wait single shot';
  } else if (preHasProgressive && prodHasProgressive) {
    summary.verdict = 'Both envs show early→full growth';
  } else if (!preHasProgressive && !prodHasProgressive) {
    summary.verdict = 'Neither env showed progressive growth on this run (both look full-wait or cached)';
  } else {
    summary.verdict = 'Prod showed progressive pattern; preprod did not';
  }

  const report = {
    meta: {
      at: new Date().toISOString(),
      noBook: true,
      preprod: PRE,
      prod: PROD,
      preCorrelation: preAuth.correlationId,
      prodCorrelation: prodAuth.correlationId,
      summary,
    },
    cities: cityResults,
    parallel,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  const md = [];
  md.push('# Riya Progressive Search — Preprod vs Prod');
  md.push('');
  md.push(summary.verdict);
  md.push('');
  md.push('| City | Preprod first | Preprod total path | Prod first | Prod total path |');
  md.push('|------|---------------|--------------------|------------|-----------------|');
  for (const c of cityResults) {
    md.push(`| ${c.city} | ${c.pre.firstMs}ms / t=${c.pre.firstTotal} | → max ${c.pre.maxTotal} (grew=${c.pre.grew}) | ${c.prod.firstMs}ms / t=${c.prod.firstTotal} | → max ${c.prod.maxTotal} (grew=${c.prod.grew}) |`);
  }
  md.push('');
  md.push('## Parallel x3 Mumbai');
  for (const env of ['preprod', 'prod']) {
    const p = parallel[env];
    md.push(`- **${env}**: ${p.runs.map((r) => `${r.ms}ms/t=${r.total}`).join(' · ')} · shortVsFull=${p.shortVsFull}`);
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log('\n=== VERDICT ===', summary.verdict);
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

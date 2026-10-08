/**
 * Progressive hotel search — N parallel searches.
 * Reports latency percentiles, throughput, success/break rate.
 * Search only, no book.
 *
 *   node scripts/probe-hotel-parallel-stress.js
 *   PARALLEL=50 CITY=Paris ENV=preprod UNIQUE_DATES=1
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const N = Math.max(1, Number(process.env.PARALLEL || 30));
const ENV_MODE = String(process.env.ENV || 'preprod').toLowerCase(); // preprod | prod | both
const UNIQUE_DATES = String(process.env.UNIQUE_DATES || '0') === '1';
const PRE = 'https://preprod-api.travelvip.ai';
const PROD = 'https://api.travelvip.ai';
const PID = 'vgm';
const CITY_KEY = String(process.env.CITY || 'Paris');

process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const CITIES = {
  Paris: '437227:FR',
  Delhi: '227760:IN',
  Mumbai: '357389:IN',
  Dubai: '221688:AE',
};

const entityId = CITIES[CITY_KEY] || CITY_KEY;
const OUT_TAG = UNIQUE_DATES ? `${N}-unique-dates` : `${N}`;
const OUT_JSON = path.join('reports', `hotel-parallel-stress-${OUT_TAG}.json`);
const OUT_MD = path.join('reports', `hotel-parallel-stress-${OUT_TAG}.md`);

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function coldDates(bump) {
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + 95 + bump);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + 1);
  return { checkin: ymd(checkin), checkout: ymd(checkout) };
}

function body(d) {
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

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function shape(total) {
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

async function oneSearch(hotel, d, idx) {
  const t0 = Date.now();
  try {
    const res = await hotel.search(body(d), { pid: PID, page: 0, perpage: 20, sort: 'price_DESC' });
    const ms = Date.now() - t0;
    const data = res.data || {};
    return {
      idx,
      dates: d,
      ok: Boolean(res.ok),
      http: res.status,
      ms,
      total: data.totalResults ?? null,
      n: Array.isArray(data.results) ? data.results.length : 0,
      fromCache: data.fromCache ?? null,
      shape: shape(data.totalResults),
      requestId: data.requestId || null,
      err: res.ok ? null : JSON.stringify(data).slice(0, 200),
    };
  } catch (e) {
    return {
      idx,
      dates: d,
      ok: false,
      http: null,
      ms: Date.now() - t0,
      total: null,
      n: 0,
      fromCache: null,
      shape: 'ERROR',
      requestId: null,
      err: String(e?.message || e).slice(0, 200),
    };
  }
}

function summarize(label, base, dateNote, wallMs, results) {
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const allTimes = results.map((r) => r.ms).sort((a, b) => a - b);
  const totals = ok.map((r) => r.total).filter((t) => Number.isFinite(t));
  const shapes = {};
  for (const r of results) shapes[r.shape] = (shapes[r.shape] || 0) + 1;
  const cacheTrue = results.filter((r) => r.fromCache === true).length;
  const cacheFalse = results.filter((r) => r.fromCache === false).length;
  const avg = times.length ? Math.round(times.reduce((s, x) => s + x, 0) / times.length) : null;
  const throughput = wallMs > 0 ? Number(((N / wallMs) * 1000).toFixed(3)) : null;
  const successRate = Number(((ok.length / N) * 100).toFixed(1));

  const minTotal = totals.length ? Math.min(...totals) : null;
  const maxTotal = totals.length ? Math.max(...totals) : null;
  const totalSpread =
    minTotal != null && maxTotal != null && maxTotal > 0
      ? Number((((maxTotal - minTotal) / maxTotal) * 100).toFixed(1))
      : null;

  const emptyOk = ok.filter((r) => r.n === 0).length;
  return {
    label,
    base,
    dateNote,
    uniqueDates: UNIQUE_DATES,
    n: N,
    wallMs,
    wallSec: Number((wallMs / 1000).toFixed(2)),
    success: ok.length,
    failed: fail.length,
    emptyResults: emptyOk,
    successRatePct: successRate,
    broke: fail.length > 0,
    throughputRps: throughput,
    latencyMs: {
      min: times[0] ?? null,
      p50: pct(times, 50),
      p90: pct(times, 90),
      p95: pct(times, 95),
      p99: pct(times, 99),
      max: times[times.length - 1] ?? null,
      avg,
      allMin: allTimes[0] ?? null,
      allMax: allTimes[allTimes.length - 1] ?? null,
    },
    totals: { min: minTotal, max: maxTotal, spreadPct: totalSpread },
    shapes,
    fromCache: { true: cacheTrue, false: cacheFalse, other: N - cacheTrue - cacheFalse },
    failures: fail.slice(0, 10).map((r) => ({
      idx: r.idx,
      dates: r.dates,
      http: r.http,
      ms: r.ms,
      err: r.err,
    })),
    sampleOk: ok.slice(0, 5).map((r) => ({
      idx: r.idx,
      dates: r.dates,
      ms: r.ms,
      total: r.total,
      n: r.n,
      shape: r.shape,
      fromCache: r.fromCache,
    })),
    results,
  };
}

async function runEnv(label, base, dateList) {
  const dateNote = UNIQUE_DATES
    ? `${dateList.length} unique date pairs (${dateList[0].checkin} … ${dateList[dateList.length - 1].checkin})`
    : `${dateList[0].checkin}→${dateList[0].checkout} (same for all)`;
  console.log(`\n=== ${label} · ${N} parallel · ${CITY_KEY} ${entityId} · ${dateNote} ===`);
  const a = await auth(base);
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => oneSearch(a.hotel, dateList[i], i)),
  );
  const wallMs = Date.now() - t0;
  const summary = summarize(label, base, dateNote, wallMs, results);
  summary.correlationId = a.correlationId;
  summary.dateList = dateList;

  console.log(
    `  wall=${summary.wallSec}s  ok=${summary.success}/${N} (${summary.successRatePct}%)  broke=${summary.broke}`,
  );
  console.log(
    `  latency ms  min=${summary.latencyMs.min}  p50=${summary.latencyMs.p50}  p90=${summary.latencyMs.p90}  p95=${summary.latencyMs.p95}  p99=${summary.latencyMs.p99}  max=${summary.latencyMs.max}  avg=${summary.latencyMs.avg}`,
  );
  console.log(
    `  throughput=${summary.throughputRps} req/s  totals ${summary.totals.min}…${summary.totals.max} (spread ${summary.totals.spreadPct}%)  shapes=${JSON.stringify(summary.shapes)}  cache T/F=${summary.fromCache.true}/${summary.fromCache.false}`,
  );
  if (summary.failures.length) {
    console.log('  failures sample:', JSON.stringify(summary.failures.slice(0, 3)));
  }
  return summary;
}

function buildDateList(baseBump) {
  if (!UNIQUE_DATES) {
    const d = coldDates(baseBump);
    return Array.from({ length: N }, () => d);
  }
  // One unique checkin per request (2-day step so pairs never overlap)
  return Array.from({ length: N }, (_, i) => coldDates(baseBump + i * 2));
}

async function main() {
  const baseBump = Number(process.env.DATE_BUMP || 40);
  const envs = [];
  if (ENV_MODE === 'preprod' || ENV_MODE === 'both') {
    envs.push(['preprod', PRE, buildDateList(baseBump)]);
  }
  if (ENV_MODE === 'prod' || ENV_MODE === 'both') {
    envs.push(['prod', PROD, buildDateList(baseBump + N * 2 + 10)]);
  }

  const runs = [];
  for (const [label, base, dateList] of envs) {
    runs.push(await runEnv(label, base, dateList));
  }

  const report = {
    at: new Date().toISOString(),
    noBook: true,
    parallel: N,
    uniqueDates: UNIQUE_DATES,
    city: CITY_KEY,
    entityId,
    note: UNIQUE_DATES
      ? `${N} CITY searches in parallel, each with a different checkin/checkout. Throughput = N / wall_seconds.`
      : `${N} identical CITY searches via Promise.all. Throughput = N / wall_seconds.`,
    runs: runs.map(({ results, ...rest }) => ({ ...rest, resultsCount: results.length })),
    raw: runs,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = [];
  md.push(`# Hotel search parallel stress — ${N} concurrent`);
  md.push('');
  md.push(`- City: **${CITY_KEY}** (\`${entityId}\`)`);
  md.push(`- Concurrent searches: **${N}**`);
  md.push(`- Unique dates per request: **${UNIQUE_DATES ? 'YES' : 'NO'}**`);
  md.push(`- At: ${report.at}`);
  md.push('');
  for (const r of runs) {
    md.push(`## ${r.label}`);
    md.push('');
    md.push(`- Base: \`${r.base}\``);
    md.push(`- Dates: ${r.dateNote}`);
    md.push(`- Wall clock: **${r.wallSec}s**`);
    md.push(
      `- Success: **${r.success}/${N}** (${r.successRatePct}%) · Empty pages: **${r.emptyResults}** · Broke: **${r.broke ? 'YES' : 'NO'}**`,
    );
    md.push(`- Throughput: **${r.throughputRps} req/s**`);
    md.push(
      `- Latency (ok only): min **${r.latencyMs.min}** · p50 **${r.latencyMs.p50}** · p90 **${r.latencyMs.p90}** · p95 **${r.latencyMs.p95}** · p99 **${r.latencyMs.p99}** · max **${r.latencyMs.max}** · avg **${r.latencyMs.avg}** ms`,
    );
    md.push(
      `- totalResults: ${r.totals.min}…${r.totals.max} (spread ${r.totals.spreadPct}%) · shapes: \`${JSON.stringify(r.shapes)}\``,
    );
    md.push(`- fromCache true/false: ${r.fromCache.true}/${r.fromCache.false}`);
    if (r.failures.length) {
      md.push(
        `- Failures: ${r.failures.length} (sample dates=${r.failures[0]?.dates?.checkin} http=${r.failures[0]?.http} err=${r.failures[0]?.err})`,
      );
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'));
  console.log('\nWrote', OUT_MD, OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

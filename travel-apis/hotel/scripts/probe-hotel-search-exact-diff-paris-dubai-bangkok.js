/**
 * Paris / Dubai / Bangkok — exact response compare + independent cold progressive.
 * 1) Cold progressive: different dates per env (no shared cache bleed)
 * 2) Final snapshot compare: same dates, after both fully warmed (or parallel unique then structure-only)
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const PRE = 'https://preprod-api.travelvip.ai';
const PROD = 'https://api.travelvip.ai';
const PID = 'vgm';
const OUT_JSON = path.join('reports', 'hotel-search-exact-diff-paris-dubai-bangkok.json');
const OUT_MD = path.join('reports', 'hotel-search-exact-diff-paris-dubai-bangkok.md');

process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

async function auth(base) {
  process.env.BASE_URL = base;
  clearSession();
  const s = await authenticate(true);
  s.client.setPartnerKey(s.accessToken);
  return { hotel: new HotelService(s.client), correlationId: s.client.correlationId, base };
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function dates(off) {
  const a = new Date();
  a.setUTCDate(a.getUTCDate() + 95 + off);
  const b = new Date(a);
  b.setUTCDate(b.getUTCDate() + 2);
  return { checkin: ymd(a), checkout: ymd(b) };
}

function body(entityId, d, adults = 1) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: d.checkin,
    checkout: d.checkout,
    type: 'CITY',
    rooms: [{ adults, children: 0, childrenAges: [] }],
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

async function search(hotel, entityId, d, adults = 1) {
  const t0 = Date.now();
  const res = await hotel.search(body(entityId, d, adults), { pid: PID, offset: 0, limit: 20 });
  const data = res.data || {};
  return {
    ms: Date.now() - t0,
    total: data.totalResults,
    available: data.availableResults,
    n: (data.results || []).length,
    fromCache: data.fromCache,
    keys: Object.keys(data).sort(),
    filterFields: (data.filters || []).map((f) => f.indexField || f.name),
    sorts: (data.sorts || []).map((s) => s.code || s.name || s),
    hotelKeys: [...new Set((data.results || []).flatMap((h) => Object.keys(h || {})))].sort(),
    top20: (data.results || []).map((h) => ({
      id: String(h.id),
      name: h.name,
      star: h.starRating,
      base: h.price?.baseFare ?? null,
      total: h.price?.totalAmount ?? null,
      available: h.available ?? null,
      propertyType: h.propertyType ?? null,
      mealType: h.mealType ?? null,
      brand: h.brand ?? null,
      chain: h.chain ?? null,
    })),
    envelope: {
      page: data.page,
      size: data.size,
      offset: data.offset,
      totalResults: data.totalResults,
      totalPages: data.totalPages,
      availableResults: data.availableResults,
      last: data.last,
      currency: data.currency,
      fromCache: data.fromCache,
      priceRangeFilter: data.priceRangeFilter ?? null,
      hasProgress: data.progress != null,
      hasPartial: data.partial != null,
    },
    filters: (data.filters || []).map((f) => ({
      name: f.name,
      indexField: f.indexField,
      facets: (f.facets || []).length,
    })),
  };
}

async function pollUntilFull(hotel, entityId, d, label, adults = 1) {
  const series = [];
  for (let i = 0; i < 8; i += 1) {
    const r = await search(hotel, entityId, d, adults);
    series.push({ i, ms: r.ms, total: r.total, n: r.n, fromCache: r.fromCache });
    console.log(label, 'poll', i, `${r.ms}ms`, `t=${r.total}`, `cache=${r.fromCache}`);
    // stop early if we've grown and stabilized 2 polls
    if (i >= 2) {
      const a = series[i - 1].total;
      const b = series[i].total;
      if (b > 200 && a === b) break;
    }
    await sleep(4000);
  }
  const snap = await search(hotel, entityId, d, adults);
  return { series, cold: series[0], final: series[series.length - 1], snap };
}

function diffArr(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);
  return {
    onlyPre: [...A].filter((x) => !B.has(x)),
    onlyProd: [...B].filter((x) => !A.has(x)),
  };
}

async function main() {
  const preAuth = await auth(PRE);
  // Paris from earlier run
  const parisId = '437227:FR';
  const cities = [
    { key: 'Paris', entityId: parisId },
    { key: 'Dubai', entityId: '221688:AE' },
    { key: 'Bangkok', entityId: '328619:TH' },
  ];
  const prodAuth = await auth(PROD);
  const out = [];

  for (let i = 0; i < cities.length; i += 1) {
    const c = cities[i];
    // Independent cold dates per env — avoid shared cache bleed
    const preDates = dates(10 + i * 11);
    const prodDates = dates(15 + i * 11);

    console.log(`\n==== ${c.key} independent cold ====`);
    console.log('PRE dates', preDates);
    const preCold = await pollUntilFull(preAuth.hotel, c.entityId, preDates, `PRE-cold ${c.key}`, 1);
    console.log('PROD dates', prodDates);
    const prodCold = await pollUntilFull(prodAuth.hotel, c.entityId, prodDates, `PROD-cold ${c.key}`, 1);

    // Same-date final compare: use a third fresh window, warm BOTH in parallel then snapshot
    const shared = dates(50 + i * 11);
    console.log(`${c.key} shared-date parallel warm`, shared);
    const [preWarm, prodWarm] = await Promise.all([
      pollUntilFull(preAuth.hotel, c.entityId, shared, `PRE-shared ${c.key}`, 1),
      pollUntilFull(prodAuth.hotel, c.entityId, shared, `PROD-shared ${c.key}`, 1),
    ]);

    const pre = preWarm.snap;
    const prod = prodWarm.snap;
    const preIds = pre.top20.map((h) => h.id);
    const prodIds = prod.top20.map((h) => h.id);
    const envelopeDiffs = [];
    for (const k of new Set([...Object.keys(pre.envelope), ...Object.keys(prod.envelope)])) {
      if (k === 'fromCache') continue;
      if (JSON.stringify(pre.envelope[k]) !== JSON.stringify(prod.envelope[k])) {
        envelopeDiffs.push({ k, pre: pre.envelope[k], prod: prod.envelope[k] });
      }
    }

    // Per-hotel field value diffs for overlapping ids in top20
    const priceDiffs = [];
    for (const id of preIds.filter((x) => prodIds.includes(x))) {
      const a = pre.top20.find((h) => h.id === id);
      const b = prod.top20.find((h) => h.id === id);
      if (!a || !b) continue;
      const delta = Number(a.total) - Number(b.total);
      if (Number.isFinite(delta) && Math.abs(delta) > 1) {
        priceDiffs.push({ id, name: a.name, pre: a.total, prod: b.total, delta: Math.round(delta * 100) / 100 });
      }
    }

    out.push({
      city: c.key,
      entityId: c.entityId,
      independentCold: {
        preprod: { dates: preDates, series: preCold.series, cold: preCold.cold, final: preCold.final },
        prod: { dates: prodDates, series: prodCold.series, cold: prodCold.cold, final: prodCold.final },
      },
      sharedFinal: {
        dates: shared,
        preprod: {
          series: preWarm.series,
          cold: preWarm.cold,
          final: preWarm.final,
          envelope: pre.envelope,
          keys: pre.keys,
          hotelKeys: pre.hotelKeys,
          filters: pre.filters,
          sorts: pre.sorts,
          top20: pre.top20,
        },
        prod: {
          series: prodWarm.series,
          cold: prodWarm.cold,
          final: prodWarm.final,
          envelope: prod.envelope,
          keys: prod.keys,
          hotelKeys: prod.hotelKeys,
          filters: prod.filters,
          sorts: prod.sorts,
          top20: prod.top20,
        },
        diff: {
          topLevelKeys: diffArr(pre.keys, prod.keys),
          hotelFields: diffArr(pre.hotelKeys, prod.hotelKeys),
          filters: diffArr(pre.filterFields, prod.filterFields),
          sorts: diffArr(pre.sorts.map(String), prod.sorts.map(String)),
          envelopeDiffs,
          top20Overlap: preIds.filter((id) => prodIds.includes(id)).length,
          top20OrderSame: preIds.join(',') === prodIds.join(','),
          onlyPreTop20: preIds.filter((id) => !prodIds.includes(id)),
          onlyProdTop20: prodIds.filter((id) => !preIds.includes(id)),
          priceDiffsOnOverlap: priceDiffs.slice(0, 15),
        },
      },
    });
  }

  const report = {
    at: new Date().toISOString(),
    noBook: true,
    bases: { preprod: PRE, prod: PROD },
    preCorrelation: preAuth.correlationId,
    prodCorrelation: prodAuth.correlationId,
    note: 'Independent cold uses different dates per env. Shared final uses same dates warmed in parallel to compare response shape/inventory.',
    cities: out,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('# Exact search response diff — Paris / Dubai / Bangkok');
  lines.push('');
  lines.push(`- Preprod: \`${PRE}\``);
  lines.push(`- Prod: \`${PROD}\``);
  lines.push('');

  for (const c of out) {
    const ic = c.independentCold;
    const sf = c.sharedFinal;
    lines.push(`## ${c.city} (\`${c.entityId}\`)`);
    lines.push('');
    lines.push('### 1) Independent cold progressive (different dates — no cache bleed)');
    lines.push('| | Preprod | Prod |');
    lines.push('|-|---------|------|');
    lines.push(`| Dates | ${ic.preprod.dates.checkin}→${ic.preprod.dates.checkout} | ${ic.prod.dates.checkin}→${ic.prod.dates.checkout} |`);
    lines.push(`| Cold first | ${ic.preprod.cold.ms}ms · t=${ic.preprod.cold.total} · cache=${ic.preprod.cold.fromCache} | ${ic.prod.cold.ms}ms · t=${ic.prod.cold.total} · cache=${ic.prod.cold.fromCache} |`);
    lines.push(`| Final | t=${ic.preprod.final.total} | t=${ic.prod.final.total} |`);
    lines.push('');
    lines.push('| Poll | Preprod | Prod |');
    lines.push('|------|---------|------|');
    const maxP = Math.max(ic.preprod.series.length, ic.prod.series.length);
    for (let i = 0; i < maxP; i += 1) {
      const a = ic.preprod.series[i];
      const b = ic.prod.series[i];
      lines.push(`| ${i} | ${a ? `${a.ms}ms/t=${a.total}` : '-'} | ${b ? `${b.ms}ms/t=${b.total}` : '-'} |`);
    }
    lines.push('');
    lines.push(`### 2) Same-date final response compare (${sf.dates.checkin}→${sf.dates.checkout})`);
    lines.push('| | Preprod | Prod |');
    lines.push('|-|---------|------|');
    lines.push(`| Final total | ${sf.preprod.final.total} | ${sf.prod.final.total} |`);
    lines.push(`| Top20 overlap | ${sf.diff.top20Overlap}/20 | orderSame=${sf.diff.top20OrderSame} |`);
    lines.push('');
    lines.push('#### Schema');
    lines.push(`- Top-level only pre: ${sf.diff.topLevelKeys.onlyPre.join(', ') || '(none)'}`);
    lines.push(`- Top-level only prod: ${sf.diff.topLevelKeys.onlyProd.join(', ') || '(none)'}`);
    lines.push(`- Hotel fields only pre: ${sf.diff.hotelFields.onlyPre.join(', ') || '(none)'}`);
    lines.push(`- Hotel fields only prod: ${sf.diff.hotelFields.onlyProd.join(', ') || '(none)'}`);
    lines.push(`- Filters only pre: ${sf.diff.filters.onlyPre.join(', ') || '(none)'}`);
    lines.push(`- Filters only prod: ${sf.diff.filters.onlyProd.join(', ') || '(none)'}`);
    lines.push(`- Shared hotel fields: \`${sf.preprod.hotelKeys.join(', ')}\``);
    lines.push('');
    lines.push('#### Envelope diffs');
    if (!sf.diff.envelopeDiffs.length) lines.push('_none_');
    else sf.diff.envelopeDiffs.forEach((e) => lines.push(`- **${e.k}**: pre=\`${JSON.stringify(e.pre)}\` · prod=\`${JSON.stringify(e.prod)}\``));
    lines.push('');
    if (sf.diff.priceDiffsOnOverlap.length) {
      lines.push('#### Price diffs on overlapping top20 ids');
      for (const p of sf.diff.priceDiffsOnOverlap) {
        lines.push(`- ${p.name} (${p.id}): pre ₹${p.pre} · prod ₹${p.prod} · Δ ${p.delta}`);
      }
      lines.push('');
    }
    lines.push('#### Top 20');
    lines.push('| # | Preprod | Prod |');
    lines.push('|-|---------|------|');
    for (let i = 0; i < 20; i += 1) {
      const a = sf.preprod.top20[i];
      const b = sf.prod.top20[i];
      lines.push(`| ${i + 1} | ${a ? `${a.name} (${a.id}) ★${a.star} ₹${a.total}` : '-'} | ${b ? `${b.name} (${b.id}) ★${b.star} ₹${b.total}` : '-'} |`);
    }
    lines.push('');
  }

  fs.writeFileSync(OUT_MD, lines.join('\n'));
  console.log('\nWrote', OUT_JSON, OUT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

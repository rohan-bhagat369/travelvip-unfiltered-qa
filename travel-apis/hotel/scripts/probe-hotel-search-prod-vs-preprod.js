/**
 * Compare B2B hotel SEARCH results: production vs preprod (no book).
 *
 * Prod:  https://api.travelvip.ai
 * Pre:   https://preprod-api.travelvip.ai
 * Creds: vgm / vgm_preprod_ojny1swtigd4as / sk_live_yg81bca5xno1ypvhla / tier 19597201
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const PROD = 'https://api.travelvip.ai';
const PREPROD = 'https://preprod-api.travelvip.ai';
const PARTNER_ID = 'vgm';
const PARTNER_SECRET = 'vgm_preprod_ojny1swtigd4as';
const SIGNING_KEY = 'sk_live_yg81bca5xno1ypvhla';
const TIER_ID = '19597201';
const PID = 'vgm';
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-11-25';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-11-26';
const LIMIT = 20;

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN', category: 'metro' },
  { key: 'Delhi', entityId: '227760:IN', category: 'metro' },
  { key: 'Dubai', entityId: '221688:AE', category: 'intl' },
  { key: 'Bangkok', entityId: '328619:TH', category: 'intl' },
  { key: 'Jaipur', entityId: '227736:IN', category: 'mid' },
  { key: 'Kochi', entityId: '329184:IN', category: 'mid' },
];

const PREMIUM = /\b(taj|marriott|hyatt|hilton|ihg|accor|sofitel|sheraton|westin|le meridien|courtyard|novotel|mercure|ibis|intercontinental|holiday inn)\b/i;

const OUT_JSON = path.join('reports', 'hotel-search-prod-vs-preprod-b2b.json');
const OUT_MD = path.join('reports', 'hotel-search-prod-vs-preprod-b2b.md');

function setEnv(base) {
  process.env.BASE_URL = base;
  process.env.PARTNER_ID = PARTNER_ID;
  process.env.PARTNER_SECRET = PARTNER_SECRET;
  process.env.SIGNING_KEY = SIGNING_KEY;
  process.env.TIER_ID = TIER_ID;
}

function baseBody(entityId) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: CHECKIN,
    checkout: CHECKOUT,
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

function summarize(list, n = 10) {
  return list.slice(0, n).map((h, i) => ({
    rank: i + 1,
    id: String(h.id),
    name: h.name,
    star: h.starRating ?? null,
    price: h.price?.baseFare ?? h.price?.totalAmount ?? null,
    premium: PREMIUM.test(String(h.name || '')),
  }));
}

function premiumScore(list, n = 10) {
  return list.slice(0, n).filter((h) => {
    const s = Number(h.starRating);
    return (Number.isFinite(s) && s >= 4) || PREMIUM.test(String(h.name || ''));
  }).length;
}

async function sessionFor(base) {
  setEnv(base);
  clearSession();
  const s = await authenticate(true);
  s.client.setPartnerKey(s.accessToken);
  return { client: s.client, hotel: new HotelService(s.client) };
}

async function search(hotel, entityId, opts = {}) {
  const t0 = Date.now();
  const res = await hotel.search(baseBody(entityId), {
    pid: PID,
    offset: opts.offset ?? 0,
    limit: opts.limit ?? LIMIT,
    sort: opts.sort,
  });
  const ms = Date.now() - t0;
  const data = res.data || {};
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    http: res.status,
    ok: res.ok,
    ms,
    total: Number(data.totalResults ?? NaN),
    results,
    requestId: data.requestId || null,
    fromCache: data.fromCache ?? null,
    filters: data.filters || [],
  };
}

async function paginateUnique(hotel, entityId, maxPages = 60) {
  const ids = new Set();
  let offset = 0;
  let pages = 0;
  let totalReported = null;
  while (pages < maxPages) {
    const r = await search(hotel, entityId, { offset, limit: LIMIT });
    if (!r.ok) break;
    if (pages === 0) totalReported = r.total;
    if (!r.results.length) break;
    for (const h of r.results) ids.add(String(h.id));
    pages++;
    if (r.results.length < LIMIT) break;
    offset += LIMIT;
  }
  return { unique: ids.size, pages, totalReported };
}

function compareTop10(prodTop, preTop) {
  const prodIds = prodTop.map((x) => x.id);
  const preIds = preTop.map((x) => x.id);
  const overlap = prodIds.filter((id) => preIds.includes(id)).length;
  const sameOrder = prodIds.join('|') === preIds.join('|');
  const rankDrift = [];
  for (const p of preTop) {
    const prodRank = prodTop.findIndex((x) => x.id === p.id);
    const preRank = p.rank;
    if (prodRank >= 0 && prodRank !== preRank - 1) {
      rankDrift.push({ id: p.id, name: p.name, prodRank: prodRank + 1, preRank });
    }
  }
  return { overlap, sameOrder, rankDrift: rankDrift.slice(0, 8) };
}

async function main() {
  const ranAt = new Date().toISOString();
  console.log('Prod vs Preprod SEARCH compare — no book');
  console.log('Dates:', CHECKIN, '→', CHECKOUT);

  const prodS = await sessionFor(PROD);
  const preS = await sessionFor(PREPROD);

  const cityRows = [];
  const compareRows = [];

  for (const city of CITIES) {
    console.log(`\n--- ${city.key} ---`);
    const [prod, pre] = await Promise.all([
      search(prodS.hotel, city.entityId),
      search(preS.hotel, city.entityId),
    ]);
    const prodTop = summarize(prod.results);
    const preTop = summarize(pre.results);
    const cmp = compareTop10(prodTop, preTop);
    const totalDelta = prod.total - pre.total;
    const countMatch = prod.total === pre.total;

    let orderNote = 'SAME_ORDER';
    if (!cmp.sameOrder) {
      orderNote = cmp.overlap >= 8 ? 'REORDERED (same hotels, different ranks)' : 'DIFFERENT_SET';
    }

    cityRows.push({
      city: city.key,
      category: city.category,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      prod: { total: prod.total, ms: prod.ms, requestId: prod.requestId, top10: prodTop, premiumTop10: premiumScore(prod.results) },
      preprod: { total: pre.total, ms: pre.ms, requestId: pre.requestId, top10: preTop, premiumTop10: premiumScore(pre.results) },
      compare: { totalDelta, countMatch, ...cmp, orderNote },
    });

    compareRows.push({
      city: city.key,
      rule: 'totalResults count',
      prod: prod.total,
      preprod: pre.total,
      match: countMatch ? 'MATCH' : 'DRIFT',
      delta: totalDelta,
    });
    compareRows.push({
      city: city.key,
      rule: 'page-1 order (top 10 ids)',
      prod: prodTop.map((x) => x.id).join(','),
      preprod: preTop.map((x) => x.id).join(','),
      match: cmp.sameOrder ? 'SAME' : orderNote,
      overlap: cmp.overlap,
    });
    compareRows.push({
      city: city.key,
      rule: 'premium/4-5★ in top 10',
      prod: premiumScore(prod.results),
      preprod: premiumScore(pre.results),
      match: premiumScore(pre.results) >= premiumScore(prod.results) - 1 ? 'OK' : 'PREPROD_WEAKER',
    });

    console.log(`  total prod=${prod.total} pre=${pre.total} delta=${totalDelta}`);
    console.log(`  order: ${orderNote} overlap=${cmp.overlap}/10`);
    console.log(`  prod top3: ${prodTop.slice(0, 3).map((x) => x.name).join(' | ')}`);
    console.log(`  pre  top3: ${preTop.slice(0, 3).map((x) => x.name).join(' | ')}`);
  }

  // Mumbai deep compare: pagination + price sort
  console.log('\n--- Mumbai deep compare ---');
  const [prodAsc, preAsc] = await Promise.all([
    search(prodS.hotel, CITIES[0].entityId, { sort: 'price_ASC', limit: 10 }),
    search(preS.hotel, CITIES[0].entityId, { sort: 'price_ASC', limit: 10 }),
  ]);
  const [prodPg, prePg] = await Promise.all([
    paginateUnique(prodS.hotel, CITIES[0].entityId),
    paginateUnique(preS.hotel, CITIES[0].entityId),
  ]);

  const deep = {
    priceAsc: {
      prodFirst: summarize(prodAsc.results, 3),
      preFirst: summarize(preAsc.results, 3),
      prodTotal: prodAsc.total,
      preTotal: preAsc.total,
    },
    pagination: {
      prod: prodPg,
      preprod: prePg,
      uniqueMatch: prodPg.unique === prePg.unique,
    },
  };

  // Filter facet count compare (Mumbai unfiltered)
  const prodBase = await search(prodS.hotel, CITIES[0].entityId);
  const preBase = await search(preS.hotel, CITIES[0].entityId);
  const facetCompare = [];
  for (const label of ['star', 'chain', 'brand', 'gst']) {
    const pf = prodBase.filters.find((f) => new RegExp(label, 'i').test(`${f.name}${f.indexField}`));
    const prf = preBase.filters.find((f) => new RegExp(label, 'i').test(`${f.name}${f.indexField}`));
    if (pf && prf) {
      const pFacets = (pf.facets || []).map((x) => ({ key: x.facetKey ?? x.name, count: x.count ?? x.docCount }));
      const rFacets = (prf.facets || []).map((x) => ({ key: x.facetKey ?? x.name, count: x.count ?? x.docCount }));
      facetCompare.push({ filter: label, prodFacetCount: pFacets.length, preFacetCount: rFacets.length });
    }
  }

  const report = {
    ranAt,
    noBook: true,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    prod: { baseUrl: PROD, partnerId: PARTNER_ID, tierId: TIER_ID },
    preprod: { baseUrl: PREPROD, partnerId: PARTNER_ID, tierId: TIER_ID },
    cities: cityRows,
    mumbaiDeep: deep,
    facetCompare,
    summary: {
      citiesCompared: CITIES.length,
      countMatches: cityRows.filter((c) => c.compare.countMatch).length,
      sameOrderCities: cityRows.filter((c) => c.compare.sameOrder).length,
      reorderedCities: cityRows.filter((c) => !c.compare.sameOrder && c.compare.overlap >= 8).length,
      totalDriftCities: cityRows.filter((c) => !c.compare.countMatch).length,
    },
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const lines = [
    '# Hotel Search — Production vs Preprod (B2B, search only)',
    '',
    `Ran: ${ranAt}`,
    `Dates: **${CHECKIN} → ${CHECKOUT}** · 1 adult · pid=vgm · tier=${TIER_ID}`,
    '',
    '| Env | Base URL |',
    '|-----|----------|',
    `| **Production** | \`${PROD}\` |`,
    `| **Preprod** | \`${PREPROD}\` |`,
    '',
    '## Summary',
    '',
    `- Cities compared: **${report.summary.citiesCompared}**`,
    `- **totalResults match:** ${report.summary.countMatches}/${CITIES.length} cities`,
    `- **Same page-1 order:** ${report.summary.sameOrderCities} cities`,
    `- **Reordered (same hotels, different rank):** ${report.summary.reorderedCities} cities`,
    `- **Count drift:** ${report.summary.totalDriftCities} cities`,
    '',
    '## Per-city comparison',
    '',
    '| City | Prod total | Preprod total | Δ | Top-10 overlap | Order | Prod premium/10 | Pre premium/10 |',
    '|---|---:|---:|---:|---:|---|---:|---:|',
  ];

  for (const c of cityRows) {
    lines.push(
      `| ${c.city} | ${c.prod.total} | ${c.preprod.total} | ${c.compare.totalDelta} | ${c.compare.overlap}/10 | ${c.compare.orderNote} | ${c.prod.premiumTop10} | ${c.preprod.premiumTop10} |`,
    );
  }

  lines.push('', '## Page 1 — top 10 side by side', '');
  for (const c of cityRows) {
    lines.push(`### ${c.city}`, '');
    lines.push('| Rank | Prod (name · star · ₹) | Preprod (name · star · ₹) |');
    lines.push('|---:|---|---|');
    for (let i = 0; i < 10; i++) {
      const p = c.prod.top10[i];
      const r = c.preprod.top10[i];
      const pl = p ? `${p.name} · ${p.star ?? '?'}★ · ₹${p.price ?? '?'}` : '—';
      const rl = r ? `${r.name} · ${r.star ?? '?'}★ · ₹${r.price ?? '?'}` : '—';
      const mark = p && r && p.id === r.id ? '' : ' **≠**';
      lines.push(`| ${i + 1} | ${pl} | ${rl}${mark} |`);
    }
    if (c.compare.rankDrift?.length) {
      lines.push('', 'Rank drift (same hotel, different position):');
      for (const d of c.compare.rankDrift) {
        lines.push(`- ${d.name}: prod #${d.prodRank} → preprod #${d.preRank}`);
      }
    }
    lines.push('');
  }

  lines.push('## Mumbai deep dive', '');
  lines.push(`- **Pagination unique hotels:** prod=${deep.pagination.prod.unique} preprod=${deep.pagination.preprod.unique} match=${deep.pagination.uniqueMatch}`);
  lines.push(`- **Price ASC cheapest:** prod=${deep.priceAsc.prodFirst[0]?.name} (₹${deep.priceAsc.prodFirst[0]?.price}) · preprod=${deep.priceAsc.preFirst[0]?.name} (₹${deep.priceAsc.preFirst[0]?.price})`);
  lines.push('');

  if (facetCompare.length) {
    lines.push('## Filter facets (Mumbai)', '');
    lines.push('| Filter | Prod facets | Preprod facets |');
    lines.push('|---|---:|---:|');
    for (const f of facetCompare) lines.push(`| ${f.filter} | ${f.prodFacetCount} | ${f.preFacetCount} |`);
    lines.push('');
  }

  lines.push('## Interpretation', '');
  lines.push('- **Count match** = ranking change did not add/remove hotels (test plan case 2).');
  lines.push('- **REORDERED** with high overlap = expected if preprod has new Riya ranking and prod does not yet.');
  lines.push('- **Price ASC** should differ from default order on both envs (customer sort wins).');
  lines.push('- Small total Δ may be inventory/timing, not ranking.');

  fs.writeFileSync(OUT_MD, lines.join('\n'));
  console.log('\nReports:', OUT_JSON, OUT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

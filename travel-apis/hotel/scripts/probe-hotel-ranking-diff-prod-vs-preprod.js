/**
 * Full ranking diff: prod vs preprod B2B hotel search (no book).
 * Paginates default-order results and compares rank position per hotel id.
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const PROD = 'https://api.travelvip.ai';
const PREPROD = 'https://preprod-api.travelvip.ai';
const SECRET = 'vgm_preprod_ojny1swtigd4as';
const SIGNING = 'sk_live_yg81bca5xno1ypvhla';
const TIER = '19597201';
const PID = 'vgm';
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-11-28';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-11-29';
const LIMIT = 20;

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Dubai', entityId: '221688:AE' },
  { key: 'Bangkok', entityId: '328619:TH' },
];

function setEnv(base) {
  process.env.BASE_URL = base;
  process.env.PARTNER_ID = 'vgm';
  process.env.PARTNER_SECRET = SECRET;
  process.env.SIGNING_KEY = SIGNING;
  process.env.TIER_ID = TIER;
}

function body(entityId) {
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

async function getSession(base) {
  setEnv(base);
  clearSession();
  const s = await authenticate(true);
  s.client.setPartnerKey(s.accessToken);
  return new HotelService(s.client);
}

async function fetchAllRanks(hotel, entityId, label) {
  const ranks = new Map();
  const meta = [];
  let offset = 0;
  let page = 0;
  let total = null;

  while (page < 80) {
    const t0 = Date.now();
    const res = await hotel.search(body(entityId), { pid: PID, offset, limit: LIMIT });
    const ms = Date.now() - t0;
    const data = res.data || {};
    const results = Array.isArray(data.results) ? data.results : [];
    if (page === 0) total = Number(data.totalResults ?? 0);
    if (!res.ok || !results.length) break;

    for (const h of results) {
      const id = String(h.id);
      if (!ranks.has(id)) {
        ranks.set(id, {
          rank: ranks.size + 1,
          id,
          name: h.name,
          star: h.starRating ?? null,
          price: h.price?.baseFare ?? null,
        });
      }
    }
    meta.push({ page, offset, ms, n: results.length });
    page++;
    if (results.length < LIMIT) break;
    offset += LIMIT;
  }

  console.log(`  ${label}: ${ranks.size} unique / total=${total} pages=${page}`);
  return { ranks, total, list: [...ranks.values()], meta };
}

function diffRanking(prod, pre) {
  const prodIds = prod.list.map((x) => x.id);
  const preIds = pre.list.map((x) => x.id);
  const prodSet = new Set(prodIds);
  const preSet = new Set(preIds);

  const onlyProd = prodIds.filter((id) => !preSet.has(id));
  const onlyPre = preIds.filter((id) => !prodSet.has(id));
  const shared = prodIds.filter((id) => preSet.has(id));

  let sameOrderShared = 0;
  const rankShifts = [];

  for (const id of shared) {
    const pr = prod.list.find((x) => x.id === id);
    const rr = pre.list.find((x) => x.id === id);
    if (pr.rank === rr.rank) sameOrderShared++;
    else {
      rankShifts.push({
        id,
        name: pr.name,
        star: pr.star,
        prodRank: pr.rank,
        preRank: rr.rank,
        delta: rr.rank - pr.rank,
      });
    }
  }

  rankShifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const top10Same = prodIds.slice(0, 10).join('|') === preIds.slice(0, 10).join('|');
  const top20Same = prodIds.slice(0, 20).join('|') === preIds.slice(0, 20).join('|');
  const fullSame = prodIds.length === preIds.length && prodIds.join('|') === preIds.join('|');

  // Kendall-style: how many shared pairs preserve relative order
  let invertedPairs = 0;
  let pairs = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const a = shared[i];
      const b = shared[j];
      const prodA = prod.list.find((x) => x.id === a).rank;
      const prodB = prod.list.find((x) => x.id === b).rank;
      const preA = pre.list.find((x) => x.id === a).rank;
      const preB = pre.list.find((x) => x.id === b).rank;
      pairs++;
      if ((prodA < prodB) !== (preA < preB)) invertedPairs++;
    }
  }

  return {
    prodCount: prod.list.length,
    preCount: pre.list.length,
    prodTotal: prod.total,
    preTotal: pre.total,
    onlyProd: onlyProd.length,
    onlyPre: onlyPre.length,
    shared: shared.length,
    sameRankShared: sameOrderShared,
    rankShifts: rankShifts.slice(0, 25),
    totalRankShifts: rankShifts.length,
    top10Same,
    top20Same,
    fullSame,
    orderSimilarityPct: shared.length ? Math.round((sameOrderShared / shared.length) * 100) : 100,
    inversionPct: pairs ? Math.round((invertedPairs / pairs) * 100) : 0,
    prodTop10: prod.list.slice(0, 10),
    preTop10: pre.list.slice(0, 10),
    prodLast10: prod.list.slice(-10),
    preLast10: pre.list.slice(-10),
  };
}

async function main() {
  const ranAt = new Date().toISOString();
  console.log('Ranking diff prod vs preprod — search only, no book');
  console.log('Dates:', CHECKIN, '→', CHECKOUT);

  const prodHotel = await getSession(PROD);
  const preHotel = await getSession(PREPROD);

  const cityResults = [];

  for (const city of CITIES) {
    console.log(`\n${city.key}:`);
    const [prod, pre] = await Promise.all([
      fetchAllRanks(prodHotel, city.entityId, 'prod'),
      fetchAllRanks(preHotel, city.entityId, 'preprod'),
    ]);
    const diff = diffRanking(prod, pre);
    cityResults.push({ city: city.key, entityId: city.entityId, checkin: CHECKIN, checkout: CHECKOUT, ...diff });
  }

  const report = { ranAt, noBook: true, checkin: CHECKIN, checkout: CHECKOUT, prod: PROD, preprod: PREPROD, cities: cityResults };
  const outJson = path.join('reports', 'hotel-ranking-diff-prod-vs-preprod.json');
  const outMd = path.join('reports', 'hotel-ranking-diff-prod-vs-preprod.md');
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const lines = [
    '# Ranking diff — Production vs Preprod (full pagination)',
    '',
    `Ran: ${ranAt} · Dates: **${CHECKIN} → ${CHECKOUT}** · search only`,
    '',
    '## Summary',
    '',
    '| City | Prod unique | Pre unique | Shared | Same rank | Rank shifts | Top-10 same | Top-20 same | Full list same | Order match % |',
    '|---|---:|---:|---:|---:|---:|:---:|:---:|:---:|---:|',
  ];

  for (const c of cityResults) {
    lines.push(
      `| ${c.city} | ${c.prodCount} | ${c.preCount} | ${c.shared} | ${c.sameRankShared} | ${c.totalRankShifts} | ${c.top10Same ? 'Yes' : '**No**'} | ${c.top20Same ? 'Yes' : '**No**'} | ${c.fullSame ? 'Yes' : '**No**'} | ${c.orderSimilarityPct}% |`,
    );
  }

  lines.push('', '## Verdict', '');
  const anyShift = cityResults.some((c) => c.totalRankShifts > 0);
  if (!anyShift) {
    lines.push('**No ranking difference** — every shared hotel has the **same rank** on prod and preprod (full paginated lists).');
  } else {
    lines.push('**Ranking differences found** — see rank shifts below.');
  }

  for (const c of cityResults) {
    lines.push('', `## ${c.city}`, '');
    lines.push(`- Prod: ${c.prodCount} hotels (reported total ${c.prodTotal})`);
    lines.push(`- Preprod: ${c.preCount} hotels (reported total ${c.preTotal})`);
    lines.push(`- Only on prod: **${c.onlyProd}** · Only on preprod: **${c.onlyPre}**`);
    lines.push(`- Shared hotels at **identical rank**: ${c.sameRankShared}/${c.shared} (${c.orderSimilarityPct}%)`);
    lines.push(`- Rank position changes: **${c.totalRankShifts}**`);

    if (c.totalRankShifts === 0) {
      lines.push('', '**No rank changes** for any hotel present in both lists.');
    } else {
      lines.push('', '| Hotel | Star | Prod rank | Preprod rank | Δ |');
      lines.push('|---|---:|---:|---:|---:|');
      for (const s of c.rankShifts) {
        lines.push(`| ${s.name} | ${s.star ?? '?'}★ | ${s.prodRank} | ${s.preRank} | ${s.delta > 0 ? '+' : ''}${s.delta} |`);
      }
    }

    if (c.onlyProd > 0 || c.onlyPre > 0) {
      lines.push('', `Hotels only on prod: ${c.onlyProd} · only on preprod: ${c.onlyPre} (inventory gap, not reorder).`);
    }

    lines.push('', '### Top 10 — side by side', '');
    lines.push('| Rank | Prod | Preprod | Match |');
    lines.push('|---:|---|---|:---:|');
    for (let i = 0; i < 10; i++) {
      const p = c.prodTop10[i];
      const r = c.preTop10[i];
      const match = p && r && p.id === r.id ? '✓' : '≠';
      lines.push(`| ${i + 1} | ${p ? `${p.name} (${p.star}★)` : '—'} | ${r ? `${r.name} (${r.star}★)` : '—'} | ${match} |`);
    }

    lines.push('', '### Last 10 — side by side', '');
    lines.push('| Rank | Prod | Preprod | Match |');
    lines.push('|---:|---|---|:---:|');
    for (let i = 0; i < 10; i++) {
      const p = c.prodLast10[i];
      const r = c.preLast10[i];
      const prodRank = c.prodCount - 9 + i;
      const match = p && r && p.id === r.id ? '✓' : '≠';
      lines.push(`| ~${prodRank} | ${p ? `${p.name} (${p.star}★)` : '—'} | ${r ? `${r.name} (${r.star}★)` : '—'} | ${match} |`);
    }
  }

  fs.writeFileSync(outMd, lines.join('\n'));
  console.log('\nReports:', outJson, outMd);

  for (const c of cityResults) {
    console.log(`${c.city}: shifts=${c.totalRankShifts} top10=${c.top10Same} match=${c.orderSimilarityPct}% onlyProd=${c.onlyProd} onlyPre=${c.onlyPre}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

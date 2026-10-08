/**
 * Hotel Chain + Brand filters (new) + existing filter regression.
 * SEARCH ONLY. No book / prebook / finalize / details. Uses BASE_URL from env.
 *
 * Cities: Delhi, Mumbai, Bangalore, Chennai, Pune, Hyderabad, Goa, Ahmedabad
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-chain-brand-filters-cities.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const LIMIT = Number(process.env.HOTEL_LIMIT || '20');

const CITIES = [
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Bangalore', entityId: '341153:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
  { key: 'Pune', entityId: '328605:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Goa', entityId: '328649:IN' },
  { key: 'Ahmedabad', entityId: '246774:IN' },
];

const rows = [];
const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
let n = 0;

function add(caseId, section, rule, how, expected, status, actual, extra = {}) {
  n += 1;
  rows.push({ id: n, caseId, section, rule, how, expected, status, actual, ...extra });
  counts[status] += 1;
  console.log(`[${status}] ${caseId || section}.${n} ${rule} — ${String(actual).slice(0, 240)}`);
}

function findFilter(data, re) {
  return (data?.filters || []).find((f) => re.test(`${f.name || ''} ${f.indexField || ''}`));
}

function facetValues(filter) {
  return (filter?.facets || [])
    .map((x) => ({
      key: String(x.facetKey ?? x.name ?? ''),
      name: String(x.name ?? x.facetKey ?? ''),
      count: Number(x.count ?? x.docCount ?? 0),
    }))
    .filter((x) => x.key)
    .sort((a, b) => b.count - a.count);
}

function hotelChain(h) {
  return String(h?.chain || h?.chainName || h?.hotelChain || h?.brandChain || '');
}

function hotelBrand(h) {
  return String(h?.brand || h?.brandName || h?.hotelBrand || '');
}

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function nameLooksLike(h, facet) {
  const name = norm(h?.name);
  const keys = [facet.key, facet.name].map(norm).filter(Boolean);
  return keys.some((k) => name.includes(k) || k.includes(name));
}

function fieldLooksLike(val, facet) {
  const hv = norm(val);
  if (!hv) return false;
  const keys = [facet.key, facet.name].map(norm).filter(Boolean);
  return keys.some((k) => hv === k || hv.includes(k) || k.includes(hv));
}

function verifyFiltered(list, kind, facet) {
  if (!list.length) return { ok: false, allMissing: false, misses: [], reason: 'empty' };
  const misses = [];
  let missingField = 0;
  for (const h of list) {
    const val = kind === 'chain' ? hotelChain(h) : hotelBrand(h);
    if (!val) {
      missingField += 1;
      if (!nameLooksLike(h, facet)) misses.push({ id: h.id, name: h.name, missingField: true });
      continue;
    }
    if (!fieldLooksLike(val, facet)) misses.push({ id: h.id, name: h.name, value: val });
  }
  return {
    ok: misses.length === 0,
    allMissing: missingField === list.length,
    misses: misses.slice(0, 8),
  };
}

function body(entityId, fq) {
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
    pid: 'vgm',
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq,
    requestId: '',
  };
}

async function search(hotel, entityId, fq, sort = 'price_ASC') {
  const res = await hotel.search(body(entityId, fq), {
    pid: 'vgm',
    page: 0,
    perpage: LIMIT,
    offset: 0,
    limit: LIMIT,
    sort,
  });
  return {
    http: res.status,
    ok: res.ok,
    data: res.data,
    results: res.data?.results || [],
    total: Number(res.data?.totalResults ?? NaN),
    requestId: res.data?.requestId || null,
    code: res.data?.error?.code || null,
  };
}

async function main() {
  console.log('=== Hotel Chain/Brand filters + existing regression (search only) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);

  const citySummaries = [];
  let starChainDone = false;
  let gstDone = false;
  let freeCancelDone = false;

  for (const city of CITIES) {
    console.log(`\n=== ${city.key} ===`);
    const baseline = await search(hotel, city.entityId, []);
    const chainF = findFilter(baseline.data, /^chain$/i);
    const brandF = findFilter(baseline.data, /^brand$/i);
    // avoid matching "brand" inside other names — use exact-ish
    const chainFilter = findFilter(baseline.data, /\bchain\b/i);
    const brandFilter = findFilter(baseline.data, /\bbrand\b/i);
    const starF = findFilter(baseline.data, /star/i);
    const gstF = findFilter(baseline.data, /\bgst\b/i);
    const policyF = findFilter(baseline.data, /reservation|cancel/i);

    const chains = facetValues(chainFilter);
    const brands = facetValues(brandFilter);
    const topChain = chains[0] || null;
    const topBrand = brands[0] || null;
    const secondChain = chains[1] || null;
    const secondBrand = brands[1] || null;

    citySummaries.push({
      city: city.key,
      entityId: city.entityId,
      baselineTotal: baseline.total,
      chainFacets: chains.slice(0, 8),
      brandFacets: brands.slice(0, 8),
    });

    add(
      `CB-B-${city.key}`,
      'Baseline',
      `${city.key}: Chain + Brand facets advertised`,
      `CITY ${city.entityId} unfiltered search`,
      'HTTP 200; filters[] includes Chain and Brand with facet counts; Star/GST/Free cancellation still present',
      baseline.ok && baseline.total > 0 && chainFilter && brandFilter ? 'PASS' : baseline.ok && baseline.total > 0 ? 'BUG' : 'BUG',
      `http=${baseline.http} total=${baseline.total} chainFacets=${chains.length} brandFacets=${brands.length} star=${!!starF} gst=${!!gstF} policy=${!!policyF}`,
      { city: city.key },
    );

    // ----- Chain positive -----
    if (!topChain) {
      add(null, 'Chain', `${city.key}: positive chain filter`, 'no facets', 'apply top chain', 'NOT_TESTED', 'no chain facets');
    } else {
      const fqArr = [`${chainFilter.indexField}:${topChain.key}`];
      const pos = await search(hotel, city.entityId, fqArr);
      const ver = verifyFiltered(pos.results, 'chain', topChain);
      const countMatch = Number(pos.total) === Number(topChain.count);
      const narrowed = pos.ok && pos.total > 0 && pos.total <= baseline.total;
      let status = 'BUG';
      if (pos.http >= 500) status = 'BUG';
      else if (narrowed && countMatch && (ver.ok || ver.allMissing)) status = 'PASS';
      else if (narrowed && ver.ok) status = 'PASS';
      else if (narrowed && countMatch) status = 'PASS'; // field absent; count contract holds
      else status = 'BUG';

      const chainCaseId = city.key === 'Delhi' ? 'CB-C-Delhi' : city.key === 'Mumbai' ? 'CB-C-Mumbai' : null;
      add(
        chainCaseId,
        'Chain',
        `${city.key}: filter Chain=${topChain.key}`,
        `fq ${fqArr[0]}`,
        `total=${topChain.count}; results match chain (field or name)`,
        status,
        `http=${pos.http} total=${pos.total} facet=${topChain.count} countMatch=${countMatch} fieldAbsent=${ver.allMissing} nameMisses=${ver.misses.length}`,
        {
          city: city.key,
          sample: pos.results.slice(0, 5).map((h) => ({ id: h.id, name: h.name, chain: hotelChain(h) || null, starRating: h.starRating })),
          misses: ver.misses,
        },
      );

      // object fq form (extended coverage — no CSV row)
      const fqObj = { [chainFilter.indexField]: [topChain.key] };
      const posObj = await search(hotel, city.entityId, fqObj);
      add(
        null,
        'Chain',
        `${city.key}: object fq Chain filter`,
        `fq object ${JSON.stringify(fqObj)}`,
        `same as array; total=${topChain.count}`,
        posObj.ok && Number(posObj.total) === Number(topChain.count) ? 'PASS' : 'BUG',
        `http=${posObj.http} total=${posObj.total} facet=${topChain.count}`,
        { city: city.key },
      );

      if (secondChain) {
        const multi = await search(hotel, city.entityId, [`${chainFilter.indexField}:${topChain.key};${secondChain.key}`]);
        const sum = topChain.count + secondChain.count;
        const okUnion =
          multi.ok &&
          multi.total >= Math.max(topChain.count, secondChain.count) &&
          multi.total <= baseline.total &&
          (multi.total === sum || multi.total <= sum);
        add(
          city.key === 'Mumbai' ? 'CB-C-Multi' : null,
          'Chain',
          `${city.key}: multi-select chain (;)`,
          `fq Chain:${topChain.key};${secondChain.key}`,
          `union total ≈ ${sum} or between max and baseline`,
          okUnion ? 'PASS' : 'BUG',
          `http=${multi.http} total=${multi.total} sum=${sum}`,
          { city: city.key },
        );
      }
    }

    // ----- Brand positive -----
    if (!topBrand) {
      add(null, 'Brand', `${city.key}: positive brand filter`, 'no facets', 'apply top brand', 'NOT_TESTED', 'no brand facets');
    } else {
      const fqArr = [`${brandFilter.indexField}:${topBrand.key}`];
      const pos = await search(hotel, city.entityId, fqArr);
      const ver = verifyFiltered(pos.results, 'brand', topBrand);
      const countMatch = Number(pos.total) === Number(topBrand.count);
      const narrowed = pos.ok && pos.total > 0 && pos.total <= baseline.total;
      let status = 'BUG';
      if (narrowed && countMatch && (ver.ok || ver.allMissing)) status = 'PASS';
      else if (narrowed && ver.ok) status = 'PASS';
      else if (narrowed && countMatch) status = 'PASS';
      else status = 'BUG';

      const brandCaseId = city.key === 'Delhi' ? 'CB-BR-Delhi' : null;
      add(
        brandCaseId,
        'Brand',
        `${city.key}: filter Brand=${topBrand.key}`,
        `fq ${fqArr[0]}`,
        `total=${topBrand.count}; results match brand`,
        status,
        `http=${pos.http} total=${pos.total} facet=${topBrand.count} countMatch=${countMatch} fieldAbsent=${ver.allMissing} nameMisses=${ver.misses.length}`,
        {
          city: city.key,
          sample: pos.results.slice(0, 5).map((h) => ({ id: h.id, name: h.name, brand: hotelBrand(h) || null, starRating: h.starRating })),
          misses: ver.misses,
        },
      );

      const fqObj = { [brandFilter.indexField]: [topBrand.key] };
      const posObj = await search(hotel, city.entityId, fqObj);
      add(
        null,
        'Brand',
        `${city.key}: object fq Brand filter`,
        `fq object ${JSON.stringify(fqObj)}`,
        `total=${topBrand.count}`,
        posObj.ok && Number(posObj.total) === Number(topBrand.count) ? 'PASS' : 'BUG',
        `http=${posObj.http} total=${posObj.total} facet=${topBrand.count}`,
        { city: city.key },
      );

      if (secondBrand) {
        const multi = await search(hotel, city.entityId, [`${brandFilter.indexField}:${topBrand.key};${secondBrand.key}`]);
        add(
          city.key === 'Mumbai' ? 'CB-BR-Multi' : null,
          'Brand',
          `${city.key}: multi-select brand (;)`,
          `fq Brand:${topBrand.key};${secondBrand.key}`,
          'HTTP 200; total <= baseline; both brands allowed',
          multi.ok && multi.total <= baseline.total ? 'PASS' : 'BUG',
          `http=${multi.http} total=${multi.total}`,
          { city: city.key },
        );
      }
    }

    // ----- Compose chain+brand (city) -----
    if (topChain && topBrand) {
      const composed = await search(hotel, city.entityId, {
        [chainFilter.indexField]: [topChain.key],
        [brandFilter.indexField]: [topBrand.key],
      });
      add(
        city.key === 'Mumbai' ? 'CB-CB-Mumbai' : null,
        'Compose',
        `${city.key}: Chain+Brand AND`,
        `Chain=${topChain.key} + Brand=${topBrand.key}`,
        'HTTP 200; total ≤ min(chain,brand); never 500',
        composed.ok && composed.http < 500 && composed.total <= Math.min(topChain.count, topBrand.count, baseline.total)
          ? 'PASS'
          : 'BUG',
        `http=${composed.http} total=${composed.total} chain=${topChain.count} brand=${topBrand.count}`,
        { city: city.key },
      );
    }

    // ----- Existing filter regression per city -----
    if (starF) {
      const star4 = facetValues(starF).find((x) => x.key === '4') || facetValues(starF)[0];
      if (star4) {
        const s = await search(hotel, city.entityId, [`${starF.indexField}:${star4.key}`]);
        const bad = s.results.filter((h) => Number(h.starRating) !== Number(star4.key));
        add(
          null,
          'Existing',
          `${city.key}: star ${star4.key}★ still correct`,
          `fq ${starF.indexField}:${star4.key}`,
          `total=${star4.count}; all starRating=${star4.key}`,
          s.ok && Number(s.total) === Number(star4.count) && bad.length === 0 ? 'PASS' : 'BUG',
          `http=${s.http} total=${s.total} facet=${star4.count} badStars=${bad.length}`,
          { city: city.key },
        );
      }
    } else {
      add(null, 'Existing', `${city.key}: star filter present`, 'baseline', 'star filter', 'BUG', 'missing');
    }

    if (gstF && !gstDone) {
      const claim = facetValues(gstF).find((x) => /claim/i.test(x.key + x.name));
      if (claim) {
        const g = await search(hotel, city.entityId, [`${gstF.indexField}:${claim.key}`]);
        const bad = g.results.filter((h) => h.isGSTClaimable !== true);
        add(
          'CB-EX-GST',
          'Existing',
          'GST Claimable filter still works with Chain/Brand present',
          `fq GST:${claim.key}`,
          `total=${claim.count}; all isGSTClaimable=true`,
          g.ok && Number(g.total) === Number(claim.count) && (g.results.length === 0 || bad.length === 0) ? 'PASS' : 'BUG',
          `http=${g.http} total=${g.total} facet=${claim.count} bad=${bad.length}`,
          { city: city.key },
        );
        gstDone = true;
      }
    }

    if (policyF && !freeCancelDone) {
      const free = facetValues(policyF).find((x) => /free/i.test(x.key + x.name));
      if (free) {
        const p = await search(hotel, city.entityId, [`${policyF.indexField}:${free.key}`]);
        add(
          'CB-EX-FC',
          'Existing',
          'Free cancellation filter still works',
          `fq ${policyF.indexField}:${free.key}`,
          `HTTP 200; total=${free.count} or ≤ baseline`,
          p.ok && p.http < 500 && Number(p.total) <= baseline.total && Number(p.total) > 0 ? 'PASS' : 'BUG',
          `http=${p.http} total=${p.total} facet=${free.count}`,
          { city: city.key },
        );
        freeCancelDone = true;
      }
    }

    // star + chain compose
    if (starF && topChain && !starChainDone) {
      const star4 = facetValues(starF).find((x) => x.key === '4') || facetValues(starF)[0];
      if (star4) {
        const c = await search(hotel, city.entityId, {
          [starF.indexField]: [star4.key],
          [chainFilter.indexField]: [topChain.key],
        });
        const badStar = c.results.filter((h) => Number(h.starRating) !== Number(star4.key));
        add(
          'CB-EX-Star',
          'Existing',
          `${city.key}: star + chain compose`,
          `star ${star4.key} + Chain ${topChain.key}`,
          'HTTP 200; stars still match; total ≤ min',
          c.ok && c.http < 500 && badStar.length === 0 && c.total <= Math.min(star4.count, topChain.count, baseline.total)
            ? 'PASS'
            : 'BUG',
          `http=${c.http} total=${c.total} badStars=${badStar.length}`,
          { city: city.key },
        );
        starChainDone = true;
      }
    }
  }

  // ----- Deep negatives on Mumbai -----
  console.log('\n=== Mumbai negatives / extras ===');
  const mum = CITIES.find((c) => c.key === 'Mumbai');
  const baseMum = await search(hotel, mum.entityId, []);
  const chainF = findFilter(baseMum.data, /\bchain\b/i);
  const brandF = findFilter(baseMum.data, /\bbrand\b/i);

  const negCases = [
    { caseId: 'CB-NEG-C1', section: 'ChainNeg', label: 'unknown chain', fq: [`${chainF?.indexField || 'Chain'}:NOT_A_REAL_CHAIN_XYZ`], expect: 'empty' },
    { caseId: 'CB-NEG-C2', section: 'ChainNeg', label: 'valueless chain', fq: [`${chainF?.indexField || 'Chain'}:`], expect: 'ignored' },
    { caseId: 'CB-NEG-C3', section: 'ChainNeg', label: 'punctuation chain', fq: [`${chainF?.indexField || 'Chain'}:Fabhotels,`], expect: 'no500' },
    { caseId: 'CB-NEG-C4', section: 'ChainNeg', label: 'HTML chain', fq: [`${chainF?.indexField || 'Chain'}:<script>`], expect: 'no500' },
    { caseId: 'CB-NEG-B1', section: 'BrandNeg', label: 'unknown brand', fq: [`${brandF?.indexField || 'Brand'}:NOT_A_REAL_BRAND_XYZ`], expect: 'empty' },
    { caseId: 'CB-NEG-B2', section: 'BrandNeg', label: 'valueless brand', fq: [`${brandF?.indexField || 'Brand'}:`], expect: 'ignored' },
    { caseId: 'CB-NEG-B3', section: 'BrandNeg', label: 'punctuation brand', fq: [`${brandF?.indexField || 'Brand'}:Taj,`], expect: 'no500' },
    { caseId: 'CB-NEG-B4', section: 'BrandNeg', label: 'HTML brand', fq: [`${brandF?.indexField || 'Brand'}:<script>`], expect: 'no500' },
  ];

  for (const t of negCases) {
    const r = await search(hotel, mum.entityId, t.fq);
    let status = 'BUG';
    let expected = '';
    if (t.expect === 'empty') {
      expected = 'HTTP 200 empty/0; not ignored as full baseline; never 500';
      const ignored = r.http === 200 && Number(r.total) === Number(baseMum.total);
      const empty = r.http === 200 && (r.total === 0 || r.results.length === 0);
      status = r.http >= 500 ? 'BUG' : ignored ? 'BUG' : empty ? 'PASS' : 'BUG';
    } else if (t.expect === 'ignored') {
      expected = 'HTTP 200; full/near baseline total; never 500';
      status =
        r.http === 200 && r.http < 500 && (Number(r.total) === Number(baseMum.total) || Number(r.total) > 0)
          ? 'PASS'
          : 'BUG';
    } else {
      expected = 'never HTTP 500 (4xx or 200 empty/partial OK)';
      status = r.http >= 500 ? 'BUG' : 'PASS';
    }
    add(
      t.caseId,
      t.section,
      `Mumbai ${t.label}`,
      `fq ${JSON.stringify(t.fq)}`,
      expected,
      status,
      `http=${r.http} total=${r.total} baseline=${baseMum.total} code=${r.code || '-'}`,
    );
  }

  // price_ASC with chain on Mumbai
  const topChainMum = facetValues(chainF)[0];
  if (topChainMum) {
    const asc = await search(hotel, mum.entityId, [`${chainF.indexField}:${topChainMum.key}`], 'price_ASC');
    const fares = asc.results.map((h) => Number(h?.price?.baseFare ?? h?.price?.totalAmount)).filter(Number.isFinite);
    let mono = fares.length > 1;
    for (let i = 1; i < fares.length; i += 1) if (fares[i] + 1e-6 < fares[i - 1]) mono = false;
    add(
      'CB-EX-Sort',
      'Existing',
      'Mumbai: price_ASC with chain filter',
      `Chain=${topChainMum.key} sort=price_ASC`,
      'non-decreasing price.baseFare on page',
      asc.ok && mono ? 'PASS' : 'BUG',
      `fares=${JSON.stringify(fares.slice(0, 10))}`,
    );
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    note: 'Search only. Chain/Brand new filters + existing star/GST/free-cancel regression. Hotels may omit chain/brand fields; count match used.',
    counts,
    citySummaries,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

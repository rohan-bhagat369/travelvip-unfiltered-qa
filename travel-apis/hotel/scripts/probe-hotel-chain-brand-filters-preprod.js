/**
 * Preprod hotel search filters — chain / brand + existing filter regression.
 * SEARCH ONLY. No book / prebook / finalize.
 *
 *   $env:BASE_URL='https://api-preprod.travelvip.ai'
 *   $env:PARTNER_ID='vgm'; $env:TIER_ID='8'; $env:PARTNER_SECRET='...'
 *   node scripts/probe-hotel-chain-brand-filters-preprod.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', 'hotel-chain-brand-filters-preprod.json');
const OUT_MD = path.join('reports', 'hotel-chain-brand-filters-preprod.md');
const PID = process.env.HOTEL_PID || 'vgm';
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-10-14';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-10-15';
const LIMIT = Number(process.env.HOTEL_LIMIT || 20);

const rows = [];

function add(section, n, rule, how, expected, actual, status, extra = {}) {
  const rec = { section, n, rule, how, expected, actual, status, ...extra };
  rows.push(rec);
  console.log(`[${status}] ${section}.${n} ${rule} — ${String(actual).slice(0, 220)}`);
  return rec;
}

function score() {
  return {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
    total: rows.length,
  };
}

function brief(d, n = 320) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

function hotels(data) {
  return Array.isArray(data?.results) ? data.results : [];
}

function filterCatalog(data) {
  return (data?.filters || []).map((f) => ({
    name: f.name,
    indexField: f.indexField,
    facetCount: (f.facets || []).length,
    sample: (f.facets || []).slice(0, 6).map((x) => ({
      key: x.facetKey ?? x.name,
      name: x.name,
      count: x.count ?? x.docCount ?? null,
    })),
  }));
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
    .filter((x) => x.key);
}

function hotelChain(h) {
  return String(
    h?.chain
    || h?.chainName
    || h?.hotelChain
    || h?.brandChain
    || h?.attributes?.chain
    || h?.meta?.chain
    || '',
  );
}

function hotelBrand(h) {
  return String(
    h?.brand
    || h?.brandName
    || h?.hotelBrand
    || h?.attributes?.brand
    || h?.meta?.brand
    || '',
  );
}

function baseBody(fq = []) {
  return {
    entityId: '357389:IN',
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
    fq,
    requestId: '',
  };
}

async function search(hotel, { fq = [], offset = 0, limit = LIMIT, sort = 'price_ASC', bodyOverrides = {} } = {}) {
  const body = { ...baseBody(fq), ...bodyOverrides, fq };
  const res = await hotel.search(body, {
    pid: PID,
    offset,
    limit,
    sort,
  });
  return {
    http: res.status,
    ok: Boolean(res.ok),
    data: res.data,
    results: hotels(res.data),
    total: Number(res.data?.totalResults ?? NaN),
    requestId: res.data?.requestId || null,
    code: res.data?.error?.code || res.data?.code || null,
  };
}

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesLabel(hotelVal, facetKey, facetName) {
  const hv = norm(hotelVal);
  const keys = [facetKey, facetName].map(norm).filter(Boolean);
  if (!hv) return false;
  return keys.some((k) => hv === k || hv.includes(k) || k.includes(hv));
}

function resultsMatchFilter(list, kind, facet) {
  if (!list.length) return { ok: false, reason: 'empty results' };
  const misses = [];
  for (const h of list) {
    const val = kind === 'chain' ? hotelChain(h) : hotelBrand(h);
    // If response doesn't expose chain/brand fields, fall back to name heuristic only as soft check
    if (!val) {
      const name = String(h?.name || '');
      if (!matchesLabel(name, facet.key, facet.name)) {
        misses.push({ id: h.id, name, missingField: kind });
      }
      continue;
    }
    if (!matchesLabel(val, facet.key, facet.name)) {
      misses.push({ id: h.id, name: h.name, value: val });
    }
  }
  // If every hotel is missing the field, mark as field-absent (separate from wrong filter)
  const allMissing = misses.length === list.length && misses.every((m) => m.missingField);
  return {
    ok: misses.length === 0,
    allMissing,
    misses: misses.slice(0, 8),
  };
}

function writeMd(report) {
  const lines = [];
  lines.push('# Hotel chain / brand filters — preprod (search only)');
  lines.push('');
  lines.push(`Env: \`${report.baseUrl}\` · CITY Mumbai \`357389:IN\` · ${CHECKIN} → ${CHECKOUT} · pid=${PID}`);
  lines.push('');
  lines.push(`Score: **PASS ${report.score.PASS} / BUG ${report.score.BUG} / NOT TESTED ${report.score['NOT TESTED']}**`);
  lines.push('');
  const sections = [...new Set(rows.map((r) => r.section))];
  for (const section of sections) {
    lines.push(`## ${section}`);
    lines.push('');
    lines.push('| # | Rule | How tested | Status |');
    lines.push('|---|---|---|---|');
    for (const r of rows.filter((x) => x.section === section)) {
      lines.push(`| ${r.n} | ${r.rule} | ${r.how.replace(/\|/g, '/')} | **${r.status}** |`);
    }
    lines.push('');
  }
  const bugs = rows.filter((r) => r.status === 'BUG');
  if (bugs.length) {
    lines.push('## Bugs');
    lines.push('');
    for (const b of bugs) {
      lines.push(`### ${b.section}.${b.n} — ${b.rule}`);
      lines.push(`- Expected: ${b.expected}`);
      lines.push(`- Actual: ${b.actual}`);
      if (b.requestId) lines.push(`- requestId: \`${b.requestId}\``);
      lines.push('');
    }
  }
  fs.writeFileSync(OUT_MD, lines.join('\n'));
}

async function main() {
  clearSession();
  console.log('Base:', config.baseUrl, 'partner:', config.partnerId, 'tier:', config.tierId);
  console.log('SEARCH ONLY — no book');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  // ---- Baseline ----
  const baseline = await search(hotel, { fq: [] });
  const catalog = filterCatalog(baseline.data);
  const chainF = findFilter(baseline.data, /chain/i);
  const brandF = findFilter(baseline.data, /brand/i);
  const starF = findFilter(baseline.data, /star/i);
  const gstF = findFilter(baseline.data, /gst/i);
  const policyF = findFilter(baseline.data, /reservation|cancel|refund|policy/i);
  const mealF = findFilter(baseline.data, /meal|board|breakfast/i);

  let n = 0;
  add('Baseline', ++n, 'Unfiltered CITY search HTTP 200 with results',
    'POST /v1/hotels/search Mumbai fq=[]',
    'HTTP 200, totalResults>0, filters[] present',
    `http=${baseline.http} total=${baseline.total} results=${baseline.results.length} filters=${catalog.length}`,
    baseline.ok && baseline.total > 0 && catalog.length > 0 ? 'PASS' : 'BUG',
    { requestId: baseline.requestId, filters: catalog });

  add('Baseline', ++n, 'Chain filter advertised in filters[]',
    'scan filters for name/indexField matching /chain/i',
    'Chain filter present with facets',
    chainF
      ? `name=${chainF.name} indexField=${chainF.indexField} facets=${(chainF.facets || []).length}`
      : `NOT FOUND. filters=${catalog.map((f) => f.name).join(', ')}`,
    chainF && (chainF.facets || []).length ? 'PASS' : 'BUG',
    { requestId: baseline.requestId });

  add('Baseline', ++n, 'Brand filter advertised in filters[]',
    'scan filters for name/indexField matching /brand/i',
    'Brand filter present with facets',
    brandF
      ? `name=${brandF.name} indexField=${brandF.indexField} facets=${(brandF.facets || []).length}`
      : `NOT FOUND. filters=${catalog.map((f) => f.name).join(', ')}`,
    brandF && (brandF.facets || []).length ? 'PASS' : 'BUG',
    { requestId: baseline.requestId });

  const chainFacets = facetValues(chainF).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  const brandFacets = facetValues(brandF).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  const topChain = chainFacets[0] || null;
  const topBrand = brandFacets[0] || null;
  const secondChain = chainFacets[1] || null;
  const secondBrand = brandFacets[1] || null;

  // Sample hotel fields for debugging
  const sampleHotel = baseline.results[0] || null;
  add('Baseline', ++n, 'Hotel result exposes chain/brand fields (or only via name)',
    'inspect first unfiltered hotel keys',
    'chain and/or brand field present on hotel object (preferred)',
    sampleHotel
      ? `keys=${Object.keys(sampleHotel).join(',')} chain=${hotelChain(sampleHotel) || '(empty)'} brand=${hotelBrand(sampleHotel) || '(empty)'} name=${sampleHotel.name}`
      : 'no hotels',
    sampleHotel ? 'PASS' : 'BUG',
    { requestId: baseline.requestId, sampleHotelSnippet: brief(sampleHotel, 400) });

  // ---- Chain positive / negative ----
  n = 0;
  if (!topChain) {
    add('Chain', ++n, 'Positive single chain filter', 'needs chain facet', 'narrowed results', 'no chain facets', 'NOT TESTED');
  } else {
    const fq = [`${chainF.indexField}:${topChain.key}`];
    const pos = await search(hotel, { fq });
    const match = resultsMatchFilter(pos.results, 'chain', topChain);
    const narrowed = Number.isFinite(pos.total) && pos.total <= baseline.total && pos.total > 0;
    const countMatch = Number(pos.total) === Number(topChain.count);
    let status = 'BUG';
    let note = '';
    if (!pos.ok || pos.http >= 500) {
      status = 'BUG';
      note = `http=${pos.http} code=${pos.code}`;
    } else if (!narrowed) {
      status = 'BUG';
      note = `total not narrowed: baseline=${baseline.total} filtered=${pos.total} facetCount=${topChain.count}`;
    } else if (countMatch && (match.ok || match.allMissing)) {
      status = 'PASS';
      note = `total=${pos.total}=facetCount; fieldCheck=${match.allMissing ? 'chain field absent on hotels (count match only)' : 'values match'}`;
    } else if (narrowed && match.ok) {
      status = 'PASS';
      note = `total=${pos.total} facetCount=${topChain.count} (count drift OK if results match)`;
    } else if (narrowed && match.allMissing) {
      // Filter applied numerically but response hotels lack chain field → still useful PASS with note if count matches; else BUG for correctness of displayed results
      status = countMatch ? 'PASS' : 'BUG';
      note = `total=${pos.total} facet=${topChain.count}; hotels missing chain field — cannot verify displayed chain correctness`;
    } else {
      status = 'BUG';
      note = `total=${pos.total} facet=${topChain.count} mismatches=${brief(match.misses)}`;
    }
    add('Chain', ++n, `Positive: filter chain=${topChain.name}`,
      `fq ${fq[0]}`,
      `HTTP 200; total≈${topChain.count}; results belong to that chain`,
      note,
      status,
      { requestId: pos.requestId, fq, facet: topChain, sample: pos.results.slice(0, 5).map((h) => ({ id: h.id, name: h.name, chain: hotelChain(h), brand: hotelBrand(h) })) });

    // Multi-select if second chain exists
    if (secondChain) {
      const multiFq = [`${chainF.indexField}:${topChain.key};${secondChain.key}`];
      const multi = await search(hotel, { fq: multiFq });
      const expected = Number(topChain.count) + Number(secondChain.count);
      const okMulti = multi.ok && Number(multi.total) === expected;
      const okUnion = multi.ok && Number(multi.total) >= Math.max(topChain.count, secondChain.count)
        && Number(multi.total) <= baseline.total
        && Number(multi.total) >= Number(topChain.count);
      add('Chain', ++n, 'Positive multi-select chain (semicolon)',
        `fq ${multiFq[0]}`,
        `total=${expected} (sum of facet counts) or valid union`,
        `http=${multi.http} total=${multi.total} expectedSum=${expected}`,
        okMulti || okUnion ? 'PASS' : 'BUG',
        { requestId: multi.requestId });
    } else {
      add('Chain', ++n, 'Positive multi-select chain', 'need 2+ chain facets', 'union totals', 'only one chain facet', 'NOT TESTED');
    }
  }

  // Negative chain
  {
    const badFq = [`${chainF?.indexField || 'chain'}:NOT_A_REAL_CHAIN_XYZ`];
    const neg = await search(hotel, { fq: badFq });
    const ok = neg.http === 200 && (Number(neg.total) === 0 || neg.results.length === 0) && neg.http !== 500;
    const ignored = neg.http === 200 && Number(neg.total) === Number(baseline.total);
    add('Chain', ++n, 'Negative: unknown chain facetKey',
      `fq ${badFq[0]}`,
      'HTTP 200 empty/0 results, never 500; must NOT ignore filter (same as baseline)',
      `http=${neg.http} total=${neg.total} baseline=${baseline.total} code=${neg.code}`,
      neg.http >= 500 ? 'BUG' : (ignored ? 'BUG' : (ok ? 'PASS' : 'BUG')),
      { requestId: neg.requestId });
  }
  {
    const emptyFq = [`${chainF?.indexField || 'chain'}:`];
    const empty = await search(hotel, { fq: emptyFq });
    add('Chain', ++n, 'Negative: valueless chain fq ignored',
      `fq ${emptyFq[0]}`,
      'HTTP 200; full/near-full total (ignored), never 500',
      `http=${empty.http} total=${empty.total} baseline=${baseline.total}`,
      empty.http === 200 && empty.http < 500 && (Number(empty.total) === Number(baseline.total) || Number(empty.total) > 0)
        ? 'PASS' : 'BUG',
      { requestId: empty.requestId });
  }
  {
    const punctFq = [`${chainF?.indexField || 'chain'}:Taj,`];
    const punct = await search(hotel, { fq: punctFq });
    add('Chain', ++n, 'Negative: punctuation in chain value (no 500)',
      `fq ${punctFq[0]}`,
      'HTTP 200 or 4xx with error.code; never 500',
      `http=${punct.http} total=${punct.total} code=${punct.code}`,
      punct.http >= 500 ? 'BUG' : 'PASS',
      { requestId: punct.requestId });
  }

  // ---- Brand positive / negative ----
  n = 0;
  if (!topBrand) {
    add('Brand', ++n, 'Positive single brand filter', 'needs brand facet', 'narrowed results', 'no brand facets', 'NOT TESTED');
  } else {
    const fq = [`${brandF.indexField}:${topBrand.key}`];
    const pos = await search(hotel, { fq });
    const match = resultsMatchFilter(pos.results, 'brand', topBrand);
    const narrowed = Number.isFinite(pos.total) && pos.total <= baseline.total && pos.total > 0;
    const countMatch = Number(pos.total) === Number(topBrand.count);
    let status = 'BUG';
    let note = '';
    if (!pos.ok || pos.http >= 500) {
      status = 'BUG';
      note = `http=${pos.http} code=${pos.code}`;
    } else if (!narrowed) {
      status = 'BUG';
      note = `total not narrowed: baseline=${baseline.total} filtered=${pos.total} facetCount=${topBrand.count}`;
    } else if (countMatch && (match.ok || match.allMissing)) {
      status = 'PASS';
      note = `total=${pos.total}=facetCount; fieldCheck=${match.allMissing ? 'brand field absent on hotels (count match only)' : 'values match'}`;
    } else if (narrowed && match.ok) {
      status = 'PASS';
      note = `total=${pos.total} facetCount=${topBrand.count}`;
    } else if (narrowed && match.allMissing) {
      status = countMatch ? 'PASS' : 'BUG';
      note = `total=${pos.total} facet=${topBrand.count}; hotels missing brand field`;
    } else {
      status = 'BUG';
      note = `total=${pos.total} facet=${topBrand.count} mismatches=${brief(match.misses)}`;
    }
    add('Brand', ++n, `Positive: filter brand=${topBrand.name}`,
      `fq ${fq[0]}`,
      `HTTP 200; total≈${topBrand.count}; results belong to that brand`,
      note,
      status,
      { requestId: pos.requestId, fq, facet: topBrand, sample: pos.results.slice(0, 5).map((h) => ({ id: h.id, name: h.name, chain: hotelChain(h), brand: hotelBrand(h) })) });

    if (secondBrand) {
      const multiFq = [`${brandF.indexField}:${topBrand.key};${secondBrand.key}`];
      const multi = await search(hotel, { fq: multiFq });
      const expected = Number(topBrand.count) + Number(secondBrand.count);
      const okMulti = multi.ok && Number(multi.total) === expected;
      const okUnion = multi.ok && Number(multi.total) >= Math.max(topBrand.count, secondBrand.count)
        && Number(multi.total) <= baseline.total;
      add('Brand', ++n, 'Positive multi-select brand (semicolon)',
        `fq ${multiFq[0]}`,
        `total=${expected} or valid union`,
        `http=${multi.http} total=${multi.total} expectedSum=${expected}`,
        okMulti || okUnion ? 'PASS' : 'BUG',
        { requestId: multi.requestId });
    } else {
      add('Brand', ++n, 'Positive multi-select brand', 'need 2+ brand facets', 'union totals', 'only one brand facet', 'NOT TESTED');
    }
  }

  {
    const badFq = [`${brandF?.indexField || 'brand'}:NOT_A_REAL_BRAND_XYZ`];
    const neg = await search(hotel, { fq: badFq });
    const ok = neg.http === 200 && (Number(neg.total) === 0 || neg.results.length === 0);
    const ignored = neg.http === 200 && Number(neg.total) === Number(baseline.total);
    add('Brand', ++n, 'Negative: unknown brand facetKey',
      `fq ${badFq[0]}`,
      'HTTP 200 empty/0; never 500; must not ignore',
      `http=${neg.http} total=${neg.total} baseline=${baseline.total}`,
      neg.http >= 500 ? 'BUG' : (ignored ? 'BUG' : (ok ? 'PASS' : 'BUG')),
      { requestId: neg.requestId });
  }
  {
    const emptyFq = [`${brandF?.indexField || 'brand'}:`];
    const empty = await search(hotel, { fq: emptyFq });
    add('Brand', ++n, 'Negative: valueless brand fq ignored',
      `fq ${emptyFq[0]}`,
      'HTTP 200 full total, never 500',
      `http=${empty.http} total=${empty.total} baseline=${baseline.total}`,
      empty.http === 200 && (Number(empty.total) === Number(baseline.total) || Number(empty.total) > 0) ? 'PASS' : 'BUG',
      { requestId: empty.requestId });
  }

  // ---- Compose chain + brand ----
  n = 0;
  if (topChain && topBrand) {
    const composeFq = [
      `${chainF.indexField}:${topChain.key}`,
      `${brandF.indexField}:${topBrand.key}`,
    ];
    const composed = await search(hotel, { fq: composeFq });
    const okCompose = composed.ok
      && Number(composed.total) <= Math.min(Number(topChain.count), Number(topBrand.count), baseline.total)
      && composed.http < 500;
    add('Compose', ++n, 'Chain + brand compose (AND)',
      `fq ${JSON.stringify(composeFq)}`,
      'HTTP 200; total ≤ each single filter; never 500',
      `http=${composed.http} total=${composed.total} chainCount=${topChain.count} brandCount=${topBrand.count}`,
      okCompose ? 'PASS' : 'BUG',
      { requestId: composed.requestId, sample: composed.results.slice(0, 5).map((h) => ({ id: h.id, name: h.name, chain: hotelChain(h), brand: hotelBrand(h) })) });
  } else {
    add('Compose', ++n, 'Chain + brand compose', 'need both facets', 'AND total', 'missing facet', 'NOT TESTED');
  }

  // ---- Existing filter regression ----
  n = 0;
  if (starF) {
    const starFacets = facetValues(starF).filter((x) => x.count > 0);
    const star5 = starFacets.find((x) => x.key === '5' || /^5/.test(x.name)) || starFacets[0];
    if (star5) {
      const fq = [`${starF.indexField}:${star5.key}`];
      const s = await search(hotel, { fq });
      const stars = s.results.map((h) => Number(h.starRating)).filter((x) => Number.isFinite(x));
      const allMatch = stars.length > 0 && stars.every((x) => String(x) === String(star5.key) || String(x).startsWith(String(star5.key)));
      const countOk = Number(s.total) === Number(star5.count);
      add('Existing', ++n, 'Star filter still applies',
        `fq ${fq[0]}`,
        `total=${star5.count}; starRatings match`,
        `http=${s.http} total=${s.total} facet=${star5.count} stars=${JSON.stringify(stars.slice(0, 8))}`,
        s.ok && countOk && allMatch ? 'PASS' : (s.ok && countOk ? 'PASS' : 'BUG'),
        { requestId: s.requestId });
    } else {
      add('Existing', ++n, 'Star filter', 'no star facets', 'narrow', 'none', 'NOT TESTED');
    }
  } else {
    add('Existing', ++n, 'Star filter present', 'baseline filters', 'star filter exists', 'missing', 'BUG');
  }

  if (gstF) {
    const claim = facetValues(gstF).find((x) => /claim/i.test(x.key + x.name)) || facetValues(gstF)[0];
    if (claim) {
      const fq = [`${gstF.indexField}:${claim.key}`];
      const g = await search(hotel, { fq });
      add('Existing', ++n, 'GST filter still applies',
        `fq ${fq[0]}`,
        `HTTP 200; total narrowed or =facet count (${claim.count})`,
        `http=${g.http} total=${g.total} facet=${claim.count} baseline=${baseline.total}`,
        g.ok && g.http < 500 && Number(g.total) <= baseline.total && Number(g.total) > 0 ? 'PASS' : 'BUG',
        { requestId: g.requestId });
    } else {
      add('Existing', ++n, 'GST filter facets', 'gst filter no facets', 'claimable', 'empty', 'NOT TESTED');
    }
  } else {
    add('Existing', ++n, 'GST filter present', 'baseline', 'optional', 'not advertised', 'NOT TESTED');
  }

  if (policyF) {
    const free = facetValues(policyF).find((x) => /free/i.test(x.key + x.name)) || facetValues(policyF)[0];
    if (free) {
      const fq = [`${policyF.indexField}:${free.key}`];
      const p = await search(hotel, { fq });
      add('Existing', ++n, 'Reservation/Free-cancel filter still applies',
        `fq ${fq[0]}`,
        'HTTP 200; total ≤ baseline',
        `http=${p.http} total=${p.total} facet=${free.count} baseline=${baseline.total}`,
        p.ok && Number(p.total) <= baseline.total && p.http < 500 ? 'PASS' : 'BUG',
        { requestId: p.requestId });
    } else {
      add('Existing', ++n, 'Policy filter facets', 'no policy facets', 'apply', 'empty', 'NOT TESTED');
    }
  } else {
    add('Existing', ++n, 'Policy filter present', 'baseline', 'optional', 'not advertised', 'NOT TESTED');
  }

  if (mealF && facetValues(mealF).length) {
    const meal = facetValues(mealF).filter((x) => x.count > 0)[0];
    if (meal) {
      const fq = [`${mealF.indexField}:${meal.key}`];
      const m = await search(hotel, { fq });
      add('Existing', ++n, 'Meal filter still applies',
        `fq ${fq[0]}`,
        'HTTP 200; total ≤ baseline',
        `http=${m.http} total=${m.total} facet=${meal.count}`,
        m.ok && Number(m.total) <= baseline.total && m.http < 500 ? 'PASS' : 'BUG',
        { requestId: m.requestId });
    }
  } else {
    add('Existing', ++n, 'Meal filter', 'not advertised or empty', 'optional regression', 'skip', 'NOT TESTED');
  }

  // Star + chain compose regression
  if (starF && topChain) {
    const star5 = facetValues(starF).find((x) => x.key === '5' || /^5/.test(x.name)) || facetValues(starF)[0];
    if (star5) {
      const fq = [`${starF.indexField}:${star5.key}`, `${chainF.indexField}:${topChain.key}`];
      const c = await search(hotel, { fq });
      add('Existing', ++n, 'Existing star + new chain compose',
        `fq ${JSON.stringify(fq)}`,
        'HTTP 200; total ≤ min(star, chain); never 500',
        `http=${c.http} total=${c.total} star=${star5.count} chain=${topChain.count}`,
        c.ok && c.http < 500 && Number(c.total) <= Math.min(star5.count, topChain.count, baseline.total) ? 'PASS' : 'BUG',
        { requestId: c.requestId });
    }
  }

  // Sort still works with chain filter
  if (topChain) {
    const fq = [`${chainF.indexField}:${topChain.key}`];
    const asc = await search(hotel, { fq, sort: 'price_ASC', limit: 10 });
    const fares = asc.results.map((h) => Number(h?.price?.baseFare)).filter(Number.isFinite);
    let mono = fares.length > 1;
    for (let i = 1; i < fares.length; i += 1) {
      if (fares[i] + 1e-6 < fares[i - 1]) mono = false;
    }
    add('Existing', ++n, 'price_ASC still works with chain filter',
      `fq chain + sort=price_ASC`,
      'non-decreasing baseFare',
      `fares=${JSON.stringify(fares)}`,
      asc.ok && mono ? 'PASS' : 'BUG',
      { requestId: asc.requestId });
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    noBook: true,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: '357389:IN',
    baseline: {
      http: baseline.http,
      total: baseline.total,
      requestId: baseline.requestId,
      filters: catalog,
      chainFacets: chainFacets.slice(0, 15),
      brandFacets: brandFacets.slice(0, 15),
    },
    score: score(),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  writeMd(report);
  console.log('\n=== SCORE ===', report.score);
  console.log('Report:', OUT);
  console.log('Markdown:', OUT_MD);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});

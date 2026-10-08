/**
 * Preprod — Property Type SRP filter + board-basis mealType mapping (search/details only).
 * NO book / prebook / finalize.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-property-type-mealtype-preprod.json');
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

const FOCUS_HOTELS = [
  { key: 'Sundeep Inn', entityId: '39637795', cityEntityId: '227760:IN' },
  { key: 'Towers Rotana', entityId: '39657625', cityEntityId: '357389:IN' },
];

const rows = [];
const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
let n = 0;

function add(section, rule, how, expected, status, actual, extra = {}) {
  n += 1;
  rows.push({ id: n, section, rule, how, expected, status, actual, ...extra });
  counts[status] += 1;
  console.log(`[${status}] ${section} ${rule} — ${String(actual).slice(0, 220)}`);
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

function searchBody(entityId, fq = []) {
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

function detailsBody(entityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(entityId),
    nationality: 'IN',
    type: 'HOTEL',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
}

function normText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function benefitKeys(room) {
  return (room.benefitsIcon || []).map((x) => String(x.key || ''));
}

function hasBreakfastBadge(room) {
  const keys = [
    ...benefitKeys(room),
    ...(room.amenitiesIcon || []).map((x) => String(x.key || '')),
  ];
  return keys.some((k) => /^breakfast$/i.test(k) || /breakfast included/i.test(k));
}

function scoreMealRoom(room, hotelName, hotelId) {
  const incl = normText(room.inclusion);
  const boardDesc = normText(room.boardBasis?.description || room.boardBasis?.Description || '');
  const text = `${incl} ${boardDesc}`;
  const meal = String(room.mealType || '').trim();
  const title = String(room.title || room.name || '').slice(0, 80);
  const bugs = [];

  if (/breakfast and dinner/i.test(text) && meal !== 'Half Board') {
    bugs.push({ rule: 'Breakfast and Dinner → Half Board', expected: 'Half Board', actual: meal, text: text.slice(0, 160) });
  }
  if (/\blunch\s*\/\s*dinner\b/i.test(text) && meal !== 'Half Board') {
    bugs.push({ rule: 'lunch/dinner choice → Half Board', expected: 'Half Board', actual: meal, text: text.slice(0, 160) });
  }
  if (/paid at the hotel directly/i.test(text) && meal && !/^no meal$/i.test(meal)) {
    bugs.push({ rule: 'paid at hotel → No Meal label', expected: 'No Meal', actual: meal, text: text.slice(0, 160) });
  }
  if (/^no meal$/i.test(meal) && /breakfast|\bbb\b|\bcp\b/i.test(text) && !/no breakfast/i.test(text)) {
    bugs.push({ rule: 'No Meal + breakfast in text', expected: 'Breakfast+ meal label', actual: meal, text: text.slice(0, 160) });
  }

  const bareLunch = /\blunch\b/i.test(text)
    && !/breakfast|dinner|half board|full board|lunch\/dinner|all inclusive/i.test(text)
    && !/paid at the hotel/i.test(text);
  if (bareLunch && /^no meal$/i.test(meal)) {
    bugs.push({ rule: 'bare Lunch → Lunch Included', expected: 'Lunch Included', actual: meal, text: text.slice(0, 160) });
  }

  const bareDinner = /\bdinner\b/i.test(text)
    && !/breakfast|lunch|half board|full board|lunch\/dinner|and dinner|all inclusive|bed and breakfast/i.test(text)
    && !/paid at the hotel/i.test(text);
  if (bareDinner && /^no meal$/i.test(meal)) {
    bugs.push({ rule: 'bare Dinner → Dinner Included', expected: 'Dinner Included', actual: meal, text: text.slice(0, 160) });
  }

  const shouldShowBreakfastBadge = ['Half Board', 'Full Board', 'All Inclusive', 'Breakfast Included'].includes(meal);
  const shouldHideBreakfastBadge = ['Lunch Included', 'Dinner Included'].includes(meal);
  if (shouldShowBreakfastBadge && !hasBreakfastBadge(room)) {
    bugs.push({
      rule: 'breakfast badge/icon for HB/FB/AI/Breakfast Included',
      expected: 'Breakfast in benefitsIcon or amenitiesIcon',
      actual: benefitKeys(room).join('|') || 'none',
      text: text.slice(0, 120),
    });
  }
  if (shouldHideBreakfastBadge && hasBreakfastBadge(room)) {
    bugs.push({
      rule: 'no breakfast badge for Lunch/Dinner Included',
      expected: 'no Breakfast badge',
      actual: benefitKeys(room).join('|') || 'Breakfast present',
      text: text.slice(0, 120),
    });
  }

  return bugs.map((b) => ({ hotelName, hotelId, room: title, mealType: meal, ...b }));
}

async function search(hotelSvc, entityId, fq, sort = 'price_ASC') {
  const res = await hotelSvc.search(searchBody(entityId, fq), {
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
  };
}

async function main() {
  console.log('=== Property Type + mealType board-basis PREPROD (search/details only) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotelSvc = new HotelService(session.client);

  let propFilterSeen = false;
  let mumbaiBaseline = null;

  for (const city of CITIES) {
    const baseline = await search(hotelSvc, city.entityId, []);
    const propF = findFilter(baseline.data, /property\s*type/i);
    const starF = findFilter(baseline.data, /star/i);
    const gstF = findFilter(baseline.data, /\bgst\b/i);
    const chainF = findFilter(baseline.data, /\bchain\b/i);
    const facets = facetValues(propF);
    const hasUnknown = facets.some((f) => /^unknown$/i.test(f.key) || /^unknown$/i.test(f.name));

    if (city.key === 'Mumbai') mumbaiBaseline = baseline;

    if (!propF) {
      add(
        'PropertyType',
        `${city.key}: Property Type facet advertised`,
        `CITY ${city.entityId} unfiltered`,
        'filters[] includes Property Type with Hotel/Apartment/Resort/Hostel…',
        'NOT_TESTED',
        `http=${baseline.http} total=${baseline.total}; facet missing (have: ${(baseline.data?.filters || []).map((f) => f.name).join(', ')})`,
        { city: city.key },
      );
      continue;
    }

    propFilterSeen = true;
    add(
      'PropertyType',
      `${city.key}: Property Type facet present`,
      `CITY ${city.entityId}`,
      'Property Type filter with multiple values',
      facets.length >= 2 ? 'PASS' : 'BUG',
      `facets=${facets.map((f) => `${f.name}:${f.count}`).join(', ')}`,
      { city: city.key, facets },
    );

    add(
      'PropertyType',
      `${city.key}: Unknown not in facet options`,
      'scan Property Type facets',
      'Unknown never listed as selectable facet',
      hasUnknown ? 'BUG' : 'PASS',
      hasUnknown ? `unknown facet present: ${JSON.stringify(facets.filter((f) => /unknown/i.test(f.key)))}` : 'no Unknown option',
      { city: city.key },
    );

    const apt = facets.find((f) => /^apartment$/i.test(f.key) || /^apartment$/i.test(f.name));
    const resort = facets.find((f) => /^resort$/i.test(f.key) || /^resort$/i.test(f.name));
    const hotelFacet = facets.find((f) => /^hotel$/i.test(f.key) || /^hotel$/i.test(f.name));

    if (apt) {
      const fq = [`${propF.indexField}:${apt.key}`];
      const filtered = await search(hotelSvc, city.entityId, fq);
      const filteredFacets = facetValues(findFilter(filtered.data, /property\s*type/i));
      const facetStable = filteredFacets.length >= facets.length
        || filteredFacets.every((ff) => facets.some((bf) => bf.key === ff.key));
      add(
        'PropertyType',
        `${city.key}: Apartment filter applies + facet counts stable`,
        `fq ["${propF.indexField}:${apt.key}"]`,
        `total≈${apt.count}; facet list does not shrink to only Apartment`,
        filtered.ok && Number(filtered.total) === Number(apt.count) && facetStable ? 'PASS' : 'BUG',
        `http=${filtered.http} total=${filtered.total} facetCount=${filteredFacets.length} baselineFacets=${facets.length}`,
        { city: city.key },
      );

      if (apt && resort) {
        const multi = await search(hotelSvc, city.entityId, [`${propF.indexField}:${apt.key};${resort.key}`]);
        add(
          'PropertyType',
          `${city.key}: multi-select Apartment;Resort`,
          `fq semicolon multi`,
          'HTTP 200; total <= baseline; both types allowed',
          multi.ok && multi.total > 0 && multi.total <= baseline.total ? 'PASS' : multi.ok && multi.total === 0 ? 'NOT_TESTED' : 'BUG',
          `http=${multi.http} total=${multi.total} baseline=${baseline.total}`,
          { city: city.key },
        );
      }

      if (starF && hotelFacet) {
        const combo = await search(hotelSvc, city.entityId, [
          `${propF.indexField}:${apt.key}`,
          `${starF.indexField}:4`,
        ]);
        add(
          'PropertyType',
          `${city.key}: Property Type + Star compose`,
          'Apartment + 4★',
          'HTTP 200; total <= apartment-only',
          combo.ok && combo.http < 500 && combo.total <= filtered.total ? 'PASS' : 'BUG',
          `http=${combo.http} total=${combo.total} aptOnly=${filtered.total}`,
          { city: city.key },
        );
      }

      if (chainF) {
        const topChain = facetValues(chainF)[0];
        if (topChain) {
          const combo = await search(hotelSvc, city.entityId, [
            `${propF.indexField}:${apt.key}`,
            `${chainF.indexField}:${topChain.key}`,
          ]);
          add(
            'PropertyType',
            `${city.key}: Property Type + Chain compose`,
            `Apartment + Chain=${topChain.key}`,
            'HTTP 200; filters compose',
            combo.ok && combo.http < 500 ? 'PASS' : 'BUG',
            `http=${combo.http} total=${combo.total}`,
            { city: city.key },
          );
        }
      }

      if (gstF) {
        const claim = facetValues(gstF).find((f) => /claimable/i.test(f.key));
        if (claim) {
          const combo = await search(hotelSvc, city.entityId, [
            `${propF.indexField}:${apt.key}`,
            `${gstF.indexField}:${claim.key}`,
          ]);
          add(
            'PropertyType',
            `${city.key}: Property Type + GST compose`,
            'Apartment + GST Claimable',
            'HTTP 200; filters compose',
            combo.ok && combo.http < 500 ? 'PASS' : 'BUG',
            `http=${combo.http} total=${combo.total}`,
            { city: city.key },
          );
        }
      }
    } else {
      add('PropertyType', `${city.key}: Apartment facet`, 'unfiltered facets', 'Apartment option', 'NOT_TESTED', 'no Apartment facet');
    }
  }

  if (!propFilterSeen) {
    add(
      'PropertyType',
      'Manual fq Property Type:Apartment (Mumbai)',
      'fq despite missing facet',
      'Should narrow results if backend supports field',
      'NOT_TESTED',
      `baseline total=${mumbaiBaseline?.total}; fq ignored — facet not deployed on B2B preprod`,
    );
  }

  const mealBugs = [];
  for (const focus of FOCUS_HOTELS) {
    const det = await hotelSvc.getDetails(detailsBody(focus.entityId));
    const rooms = det.data?.results?.[0]?.rooms || [];
    add(
      'MealType',
      `${focus.key}: details returns rooms`,
      `POST /v1/hotels/details ${focus.entityId}`,
      'HTTP 200; rooms[] with mealType',
      det.ok && rooms.length ? 'PASS' : det.ok ? 'NOT_TESTED' : 'BUG',
      `http=${det.status} rooms=${rooms.length}`,
      { hotel: focus.key },
    );

    for (const room of rooms) {
      mealBugs.push(...scoreMealRoom(room, focus.key, focus.entityId));
    }

    const bfDinner = rooms.filter((r) => /breakfast and dinner/i.test(normText(r.inclusion)));
    if (bfDinner.length) {
      const allHB = bfDinner.every((r) => r.mealType === 'Half Board');
      add(
        'MealType',
        `${focus.key}: "Breakfast and Dinner" → Half Board`,
        `${bfDinner.length} matching room(s)`,
        'mealType=Half Board',
        allHB ? 'PASS' : 'BUG',
        bfDinner.slice(0, 3).map((r) => `${r.mealType}:${normText(r.inclusion).slice(0, 60)}`).join(' | '),
        { hotel: focus.key },
      );
    }

    const bedBfDinner = rooms.filter((r) => /bed and breakfast.*dinner/i.test(normText(r.inclusion)));
    if (bedBfDinner.length) {
      const mapped = bedBfDinner.map((r) => r.mealType);
      const allHB = bedBfDinner.every((r) => r.mealType === 'Half Board');
      add(
        'MealType',
        `${focus.key}: "Bed and breakfast … Dinner" mapping`,
        `${bedBfDinner.length} room(s)`,
        'Half Board (upgrade from Breakfast only)',
        allHB ? 'PASS' : 'BUG',
        `actual mealTypes: ${[...new Set(mapped)].join(', ')}`,
        { hotel: focus.key, samples: bedBfDinner.slice(0, 2).map((r) => ({ mealType: r.mealType, incl: normText(r.inclusion).slice(0, 100) })) },
      );
    }

    const bfRooms = rooms.filter((r) => r.mealType === 'Breakfast Included');
    if (bfRooms.length) {
      const withBadge = bfRooms.filter((r) => hasBreakfastBadge(r)).length;
      add(
        'MealType',
        `${focus.key}: Breakfast Included shows breakfast badge`,
        `${bfRooms.length} Breakfast Included room(s)`,
        'Breakfast in benefitsIcon or amenitiesIcon',
        withBadge === bfRooms.length ? 'PASS' : withBadge > 0 ? 'BUG' : 'BUG',
        `${withBadge}/${bfRooms.length} have Breakfast badge/icon`,
        { hotel: focus.key },
      );
    }

    const hbRooms = rooms.filter((r) => r.mealType === 'Half Board');
    if (hbRooms.length) {
      const withBadge = hbRooms.filter((r) => hasBreakfastBadge(r)).length;
      add(
        'MealType',
        `${focus.key}: Half Board shows breakfast badge`,
        `${hbRooms.length} Half Board room(s)`,
        'Breakfast badge/icon on listing card',
        withBadge === hbRooms.length ? 'PASS' : withBadge > 0 ? 'PASS' : 'BUG',
        `${withBadge}/${hbRooms.length} have Breakfast badge/icon`,
        { hotel: focus.key },
      );
    }
  }

  for (const bug of mealBugs) {
    add(
      'MealType',
      `${bug.hotelName}: ${bug.rule}`,
      `room "${bug.room}"`,
      bug.expected,
      'BUG',
      `mealType=${bug.mealType}; ${bug.text || ''}`,
      { sample: bug },
    );
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    note: 'Search + details only. Property Type facet + board-basis mealType on room cards.',
    counts,
    mealBugCount: mealBugs.length,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

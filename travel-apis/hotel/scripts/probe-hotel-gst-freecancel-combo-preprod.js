/**
 * Preprod — Free cancellation + GST Claimable combo (listing only, NO book).
 * Compares totals for each fq combination on Mumbai (+ a few cities).
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', 'hotel-gst-freecancel-combo-preprod.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-10-14';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-10-15';
const LIMIT = 20;

const CITIES = [
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Bangalore', entityId: '341153:IN' },
  { key: 'Pune', entityId: '328605:IN' },
];

function baseBody(entityId, fq) {
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

function facetSummary(data) {
  const filters = Array.isArray(data?.filters) ? data.filters : [];
  return filters.map((f) => ({
    name: f.name,
    indexField: f.indexField,
    keys: (f.facets || []).slice(0, 8).map((x) => ({
      key: x.facetKey || x.name,
      count: x.count ?? x.docCount ?? null,
    })),
  }));
}

function pickPolicyFq(data) {
  const filters = Array.isArray(data?.filters) ? data.filters : [];
  const pol = filters.find(
    (f) =>
      /reservation|cancel|refund/i.test(String(f.name || '')) ||
      /reservation|cancel|refund/i.test(String(f.indexField || '')),
  );
  if (!pol) return { indexField: 'Reservation policy', facetKey: 'Free cancellation', found: false };
  const free =
    (pol.facets || []).find((x) => /free\s*cancel/i.test(String(x.facetKey || x.name || ''))) ||
    (pol.facets || [])[0];
  return {
    indexField: pol.indexField || pol.name || 'Reservation policy',
    facetKey: free?.facetKey || free?.name || 'Free cancellation',
    count: free?.count ?? free?.docCount ?? null,
    found: true,
  };
}

function pickGstFq(data) {
  const filters = Array.isArray(data?.filters) ? data.filters : [];
  const gst = filters.find(
    (f) => /gst/i.test(String(f.name || '')) || /gst/i.test(String(f.indexField || '')),
  );
  if (!gst) return { indexField: 'GST', facetKey: 'Claimable', found: false, count: null };
  const claim = (gst.facets || []).find((x) => /claim/i.test(String(x.facetKey || x.name || ''))) || (gst.facets || [])[0];
  return {
    indexField: gst.indexField || gst.name || 'GST',
    facetKey: claim?.facetKey || claim?.name || 'Claimable',
    count: claim?.count ?? claim?.docCount ?? null,
    found: true,
  };
}

async function searchOnce(hotel, entityId, fq, label) {
  const res = await hotel.search(baseBody(entityId, fq), {
    pid: 'vgm',
    offset: 0,
    limit: LIMIT,
    page: 0,
    perpage: LIMIT,
    sort: 'price_ASC',
  });
  const hotels = res.data?.results || [];
  return {
    label,
    fq,
    http: res.status,
    ok: res.ok,
    totalResults: res.data?.totalResults ?? null,
    pageHotels: hotels.length,
    sample: hotels.slice(0, 5).map((h) => ({
      id: h.id || h.entityId,
      name: h.name,
      starRating: h.starRating,
      isGSTClaimable: h.isGSTClaimable,
      refundable: h.refundable ?? h.isRefundable ?? h.freeCancellation ?? null,
    })),
    gstTrue: hotels.filter((h) => h.isGSTClaimable === true).length,
    gstFalse: hotels.filter((h) => h.isGSTClaimable === false).length,
    error: res.data?.error || (!res.ok ? res.data : null),
  };
}

async function main() {
  console.log('=== GST + Free cancellation combo PREPROD (search only) ===');
  console.log('BASE', process.env.BASE_URL, 'dates', CHECKIN, CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    note: 'No book. Compare listing totals for GST / Free cancellation alone vs together.',
    cities: [],
  };

  for (const city of CITIES) {
    console.log(`\n=== ${city.key} ===`);
    const unf = await searchOnce(hotel, city.entityId, {}, 'unfiltered');
    // also try array fq empty
    const facets = facetSummary(
      (
        await hotel.search(baseBody(city.entityId, []), {
          pid: 'vgm', offset: 0, limit: LIMIT, page: 0, perpage: LIMIT, sort: 'price_ASC',
        })
      ).data,
    );
    const unfFull = await hotel.search(baseBody(city.entityId, []), {
      pid: 'vgm', offset: 0, limit: LIMIT, page: 0, perpage: LIMIT, sort: 'price_ASC',
    });
    const policy = pickPolicyFq(unfFull.data);
    const gst = pickGstFq(unfFull.data);

    const fqGstObj = { [gst.indexField]: [gst.facetKey] };
    const fqPolObj = { [policy.indexField]: [policy.facetKey] };
    const fqBothObj = { ...fqGstObj, ...fqPolObj };
    const fqBothStar = {
      df_long_star_rating: [4],
      ...fqBothObj,
    };
    const fqGstArr = [`${gst.indexField}:${gst.facetKey}`];
    const fqPolArr = [`${policy.indexField}:${policy.facetKey}`];
    const fqBothArr = [...fqGstArr, ...fqPolArr];

    const runs = [];
    for (const [label, fq] of [
      ['unfiltered_obj', {}],
      ['GST_only_obj', fqGstObj],
      ['FreeCancel_only_obj', fqPolObj],
      ['GST+FreeCancel_obj', fqBothObj],
      ['Star4+GST+FreeCancel_obj', fqBothStar],
      ['GST_only_arr', fqGstArr],
      ['FreeCancel_only_arr', fqPolArr],
      ['GST+FreeCancel_arr', fqBothArr],
    ]) {
      const row = await searchOnce(hotel, city.entityId, fq, label);
      runs.push(row);
      console.log(
        `  [${row.http}] ${label} total=${row.totalResults} page=${row.pageHotels} gstT/F=${row.gstTrue}/${row.gstFalse}`,
      );
    }

    const combo = runs.find((r) => r.label === 'GST+FreeCancel_obj');
    const gstOnly = runs.find((r) => r.label === 'GST_only_obj');
    const polOnly = runs.find((r) => r.label === 'FreeCancel_only_obj');
    const comboEmpty =
      combo && (combo.totalResults === 0 || combo.pageHotels === 0) && combo.http === 200;
    const partsHadResults =
      (gstOnly?.totalResults > 0 || gstOnly?.pageHotels > 0) &&
      (polOnly?.totalResults > 0 || polOnly?.pageHotels > 0);

    const verdict =
      comboEmpty && partsHadResults
        ? 'BUG'
        : combo && combo.pageHotels > 0
          ? 'PASS'
          : comboEmpty && !partsHadResults
            ? 'EMPTY_EXPECTED'
            : 'CHECK';

    console.log(`  → verdict ${verdict} (combo empty=${comboEmpty}, parts had results=${partsHadResults})`);

    report.cities.push({
      city: city.key,
      entityId: city.entityId,
      policyFacet: policy,
      gstFacet: gst,
      facetNames: facets.map((f) => ({ name: f.name, indexField: f.indexField, keys: f.keys })),
      runs,
      verdict,
    });
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nWrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

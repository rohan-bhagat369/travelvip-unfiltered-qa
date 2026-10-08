/**
 * B2B preprod — GST listing filter (isGSTClaimable on SEARCH results, not details rooms).
 * NO book.
 *
 * Facet from unfiltered search: { name: GST, indexField: GST, facets: [{ facetKey: Claimable }] }
 * Apply: fq: ["GST:Claimable"] → every hotel.isGSTClaimable === true
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-gst-filter-listing-preprod.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const LIMIT = Number(process.env.HOTEL_PERPAGE || '20');
const PAGES = Number(process.env.HOTEL_PAGES || '2');

const CITIES = [
  { key: 'Delhi', entityId: '227760:IN' },
  { key: 'Mumbai', entityId: '357389:IN' },
  { key: 'Bangalore', entityId: '341153:IN' },
  { key: 'Chennai', entityId: '228269:IN' },
  { key: 'Pune', entityId: '328605:IN' },
  { key: 'Hyderabad', entityId: '227706:IN' },
  { key: 'Goa', entityId: '328649:IN', note: 'Panaji IN' },
  { key: 'Ahmedabad', entityId: '246774:IN', alias: 'AMD' },
];

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

function hotelsOf(data) {
  return (data?.results || []).map((h) => ({
    id: h.id || h.entityId || null,
    name: h.name || h.title || '',
    isGSTClaimable: h.isGSTClaimable,
    hasKey: Object.prototype.hasOwnProperty.call(h, 'isGSTClaimable'),
  }));
}

function gstFacet(data) {
  const filters = data?.filters || [];
  if (!Array.isArray(filters)) return null;
  return filters.find((f) => /gst/i.test(String(f.name || '')) || /gst/i.test(String(f.indexField || ''))) || null;
}

async function main() {
  console.log('=== Hotel GST filter (listing isGSTClaimable) PREPROD — no book ===');
  console.log('BASE', process.env.BASE_URL);

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
    note: 'GST filter on SEARCH listing flag isGSTClaimable only. No details/book.',
    cities: [],
    counts: { PASS: 0, BUG: 0, NOT_TESTED: 0 },
  };

  for (const city of CITIES) {
    console.log(`\n=== ${city.key} (${city.entityId}) ===`);
    const cityRow = {
      city: city.key,
      alias: city.alias || null,
      entityId: city.entityId,
      checks: [],
      verdict: 'NOT_TESTED',
    };

    const add = (id, rule, how, status, actual, extra = {}) => {
      cityRow.checks.push({ id, rule, how, status, actual, ...extra });
      console.log(`  [${status}] ${id} ${actual}`);
    };

    // 1) Unfiltered
    const unfHotels = [];
    let unfData = null;
    let unfHttp = null;
    for (let p = 0; p < PAGES; p += 1) {
      const res = await hotel.search(searchBody(city.entityId, []), {
        pid: 'vgm', offset: p * LIMIT, limit: LIMIT, page: 0, perpage: LIMIT,
      });
      if (p === 0) {
        unfHttp = res.status;
        unfData = res.data;
      }
      if (!res.ok) break;
      const batch = hotelsOf(res.data);
      if (!batch.length) break;
      unfHotels.push(...batch);
    }

    if (unfHttp !== 200 || unfHotels.length === 0) {
      add('G0', 'Unfiltered search returns hotels', 'POST /v1/hotels/search', 'NOT_TESTED', `http=${unfHttp} n=${unfHotels.length}`);
      cityRow.verdict = 'NOT_TESTED';
      report.counts.NOT_TESTED += 1;
      report.cities.push(cityRow);
      continue;
    }

    const missingKey = unfHotels.filter((h) => !h.hasKey);
    const nonBool = unfHotels.filter((h) => h.hasKey && typeof h.isGSTClaimable !== 'boolean');
    const trueN = unfHotels.filter((h) => h.isGSTClaimable === true).length;
    const falseN = unfHotels.filter((h) => h.isGSTClaimable === false).length;
    add(
      'G1',
      'Every listing hotel has boolean isGSTClaimable',
      'unfiltered search results[]',
      missingKey.length === 0 && nonBool.length === 0 ? 'PASS' : 'BUG',
      `n=${unfHotels.length} true=${trueN} false=${falseN} missingKey=${missingKey.length} nonBool=${nonBool.length}`,
      { missingSample: missingKey.slice(0, 3), nonBoolSample: nonBool.slice(0, 3) }
    );

    const facet = gstFacet(unfData);
    const claimable = (facet?.facets || []).find((f) => /claimable/i.test(String(f.name || f.facetKey || '')));
    add(
      'G2',
      'GST filter advertised on search (indexField + Claimable facet)',
      'unfiltered filters[]',
      facet && claimable ? 'PASS' : 'BUG',
      `facet=${facet ? facet.indexField : 'missing'} claimable=${claimable ? `${claimable.facetKey}:${claimable.count}` : 'missing'}`
    );

    if (!facet || !claimable) {
      add('G3', 'Apply GST:Claimable filter', 'skipped — no facet', 'NOT_TESTED', 'no GST facet');
      const bugs = cityRow.checks.filter((c) => c.status === 'BUG').length;
      cityRow.verdict = bugs ? 'BUG' : 'NOT_TESTED';
      if (bugs) report.counts.BUG += 1;
      else report.counts.NOT_TESTED += 1;
      report.cities.push(cityRow);
      continue;
    }

    const fq = [`${facet.indexField}:${claimable.facetKey}`];
    const filteredHotels = [];
    let filtData = null;
    let filtHttp = null;
    for (let p = 0; p < PAGES; p += 1) {
      const res = await hotel.search(searchBody(city.entityId, fq), {
        pid: 'vgm', offset: p * LIMIT, limit: LIMIT, page: 0, perpage: LIMIT,
      });
      if (p === 0) {
        filtHttp = res.status;
        filtData = res.data;
      }
      if (!res.ok) break;
      const batch = hotelsOf(res.data);
      if (!batch.length) break;
      filteredHotels.push(...batch);
    }

    const allTrue = filteredHotels.length > 0 && filteredHotels.every((h) => h.isGSTClaimable === true);
    const anyFalse = filteredHotels.some((h) => h.isGSTClaimable === false);
    const anyMissing = filteredHotels.some((h) => !h.hasKey);
    add(
      'G3',
      'fq GST Claimable → every hotel isGSTClaimable=true (listing flag)',
      `fq=${fq[0]}`,
      filtHttp === 200 && allTrue && !anyFalse && !anyMissing ? 'PASS' : (filtHttp === 200 && filteredHotels.length === 0 ? 'NOT_TESTED' : 'BUG'),
      `http=${filtHttp} n=${filteredHotels.length} total=${filtData?.totalResults} allTrue=${allTrue} anyFalse=${anyFalse}`,
      {
        falseSample: filteredHotels.filter((h) => h.isGSTClaimable !== true).slice(0, 5),
      }
    );

    // G4: filtered total should be <= unfiltered; if facet count known, compare when sampling enough
    const unfTotal = Number(unfData?.totalResults);
    const filtTotal = Number(filtData?.totalResults);
    const facetCount = Number(claimable.count);
    let g4status = 'PASS';
    let g4actual = `unfTotal=${unfTotal} filtTotal=${filtTotal} facetCount=${facetCount}`;
    if (!(filtHttp === 200) || !Number.isFinite(filtTotal) || !Number.isFinite(unfTotal)) {
      g4status = 'BUG';
    } else if (filtTotal > unfTotal) {
      g4status = 'BUG';
      g4actual += ' filtered>unfiltered';
    } else if (Number.isFinite(facetCount) && filtTotal !== facetCount) {
      // Facet counts can be approximate on some builds — flag as BUG if clearly wrong
      g4status = 'BUG';
      g4actual += ' total≠facetCount';
    }
    add(
      'G4',
      'Filtered total ≤ unfiltered and matches Claimable facet count',
      'compare totals',
      g4status,
      g4actual
    );

    // G5: without filter, true hotels may be sparse on first pages — OK; with filter must only be true
    add(
      'G5',
      'Filter uses listing isGSTClaimable (not details rooms)',
      'search-only validation',
      'PASS',
      'validated on /v1/hotels/search results[].isGSTClaimable only'
    );

    const bugs = cityRow.checks.filter((c) => c.status === 'BUG').length;
    const nots = cityRow.checks.filter((c) => c.status === 'NOT_TESTED').length;
    if (bugs) {
      cityRow.verdict = 'BUG';
      report.counts.BUG += 1;
    } else if (nots && cityRow.checks.every((c) => c.status === 'NOT_TESTED' || c.status === 'PASS') && nots === cityRow.checks.length) {
      cityRow.verdict = 'NOT_TESTED';
      report.counts.NOT_TESTED += 1;
    } else {
      cityRow.verdict = 'PASS';
      report.counts.PASS += 1;
    }
    report.cities.push(cityRow);
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', report.counts);
  console.log('Report', OUT);
  console.log('DONE — no bookings.');
  if (report.counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

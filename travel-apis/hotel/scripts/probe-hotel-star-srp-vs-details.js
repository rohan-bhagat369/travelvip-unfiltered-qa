/**
 * SRP vs Hotel Details starRating consistency.
 * After vendor-rating fix: filtered SRP star must match details starRating.
 * Search + details only. NO book / prebook / finalize. Uses BASE_URL from env.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-star-srp-vs-details.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const PERPAGE = Number(process.env.HOTEL_PERPAGE || '15');
const DETAIL_LIMIT = Number(process.env.HOTEL_DETAIL_LIMIT || '8'); // hotels per city to open details
const STARS = (process.env.HOTEL_STARS || '4,5,3').split(',').map(Number).filter((n) => n >= 1 && n <= 5);

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

function searchBody(entityId, star) {
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
    fq: { df_long_star_rating: [star] },
    requestId: '',
  };
}

function detailsBody(entityId) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin: CHECKIN,
    checkout: CHECKOUT,
    type: 'HOTEL',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
}

function detailsHotel(data) {
  return (data?.results || [])[0] || data?.hotel || data || null;
}

async function main() {
  console.log('=== Hotel SRP vs Details starRating (no book) ===');
  console.log('BASE', process.env.BASE_URL, 'stars', STARS.join(','), CHECKIN, '→', CHECKOUT);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotel = new HotelService(session.client);

  const rows = [];
  const mismatches = [];
  const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  let n = 0;
  const add = (caseId, section, rule, how, expected, status, actual, extra = {}) => {
    n += 1;
    const row = { id: n, caseId, section, rule, how, expected, status, actual, ...extra };
    rows.push(row);
    counts[status] += 1;
    console.log(`[${status}] ${caseId} ${rule} — ${actual}`);
    return row;
  };

  for (const city of CITIES) {
    for (const star of STARS) {
      const caseId = `H-SS-${city.key}-${star}`;
      const search = await hotel.search(searchBody(city.entityId, star), {
        pid: 'vgm',
        page: 0,
        perpage: PERPAGE,
        sort: 'price_ASC',
      });
      const results = search.data?.results || [];
      if (search.status !== 200 || results.length === 0) {
        add(
          caseId,
          'STARSRP',
          `${city.key}: ${star}★ SRP star matches Details`,
          `CITY search fq df_long_star_rating:${star}; details first ${DETAIL_LIMIT} hotels`,
          `Every SRP starRating=${star}; details.starRating===SRP for each sampled hotel`,
          'NOT_TESTED',
          `http=${search.status} n=${results.length} total=${search.data?.totalResults}`,
          { city: city.key, star },
        );
        continue;
      }

      const srpMismatches = results.filter((h) => Number(h.starRating) !== star);
      const toDetail = results.slice(0, DETAIL_LIMIT);
      const pairRows = [];
      let pairBugs = 0;
      let pairOk = 0;

      for (const h of toDetail) {
        const srpStar = Number(h.starRating);
        const det = await hotel.getDetails(detailsBody(h.id));
        const dHotel = detailsHotel(det.data);
        const detStar = dHotel?.starRating != null ? Number(dHotel.starRating) : null;
        const match = det.status === 200 && detStar != null && detStar === srpStar;
        const filteredOk = detStar === star;

        if (match && filteredOk) pairOk += 1;
        else pairBugs += 1;

        const pair = {
          id: h.id,
          name: h.name,
          srpStar,
          detailsStar: detStar,
          detailsHttp: det.status,
          detailsName: dHotel?.name || null,
          matchSrpDetails: match,
          matchesFilter: filteredOk,
        };
        pairRows.push(pair);

        if (!match || !filteredOk) {
          mismatches.push({ city: city.key, filterStar: star, ...pair });
          console.log(
            `  MISMATCH ${city.key} filter=${star}★ id=${h.id} "${h.name}" SRP=${srpStar} Details=${detStar} http=${det.status}`,
          );
        }
      }

      const srpOk = srpMismatches.length === 0;
      const detailsOk = pairBugs === 0;
      let status = 'BUG';
      if (srpOk && detailsOk) status = 'PASS';
      else if (!srpOk || !detailsOk) status = 'BUG';

      add(
        caseId,
        'STARSRP',
        `${city.key}: ${star}★ SRP star matches Details`,
        `CITY search fq df_long_star_rating:${star}; details first ${toDetail.length} hotels`,
        `Every SRP starRating=${star}; details.starRating===SRP for each sampled hotel`,
        status,
        `srp n=${results.length} srpMismatch=${srpMismatches.length}; details checked=${toDetail.length} ok=${pairOk} bugs=${pairBugs}`,
        {
          city: city.key,
          star,
          srpMismatchSample: srpMismatches.slice(0, 5).map((h) => ({ id: h.id, name: h.name, starRating: h.starRating })),
          pairs: pairRows,
        },
      );
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    starsTested: STARS,
    detailLimitPerCityStar: DETAIL_LIMIT,
    note: 'Search + details only. No book. Star on SRP must equal star on details after bucket/vendor fix.',
    counts,
    mismatchCount: mismatches.length,
    mismatches,
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('Mismatches', mismatches.length);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

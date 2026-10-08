/**
 * Hotel no-availability search reshape + available hotels through DETAILS.
 * NO book / prebook / finalize. Uses BASE_URL from env (default api-staging).
 *
 * NEW unavail search shape:
 *   results[] still contains hotel, available:false, price:null
 * OLD (should not be only outcome for known hotel):
 *   totalResults:0, results:[], message:"No hotels found..."
 *
 * Available hotels: CITY search fields OK + HOTEL details has rooms with prices.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'hotel-no-availability-and-details.json');
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-09-23';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-09-24';
const PERPAGE = 20;

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

const UNAVAIL_ROOM = [{ adults: 6, children: 0, childrenAges: [] }]; // triggers sold-out style for many hotels
const AVAIL_ROOM = [{ adults: 1, children: 0, childrenAges: [] }];

function searchBody({ entityId, type, checkin, checkout, rooms }) {
  return {
    entityId: String(entityId),
    nationality: 'IN',
    checkin,
    checkout,
    type,
    rooms,
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: 'vgm',
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
}

function oldEmptyEnvelope(data) {
  return (
    Number(data?.totalResults) === 0 &&
    Array.isArray(data?.results) &&
    data.results.length === 0 &&
    typeof data?.message === 'string' &&
    /no hotels found/i.test(data.message)
  );
}

function summarizeSearchHotel(h) {
  return {
    id: h?.id ?? null,
    name: h?.name ?? null,
    starRating: h?.starRating ?? null,
    available: h?.available,
    priceIsNull: h?.price === null,
    totalAmount: h?.price?.totalAmount ?? null,
    refundable: h?.refundable,
    isGSTClaimable: h?.isGSTClaimable,
    amenitiesCount: Array.isArray(h?.amenities) ? h.amenities.length : 0,
    hasImage: Boolean(h?.image),
    hasAddress: Boolean(h?.address),
  };
}

function isNewUnavail(h) {
  return h && h.available === false && h.price === null && Boolean(h.id) && Boolean(h.name);
}

function isAvailSearch(h) {
  const total = h?.price?.totalAmount;
  return (
    h &&
    h.available !== false &&
    h.price &&
    typeof total === 'number' &&
    total >= 0 &&
    Boolean(h.name) &&
    h.starRating != null &&
    typeof h.isGSTClaimable === 'boolean'
  );
}

function detailsRooms(data) {
  const row = (data?.results || [])[0] || data?.hotel || data;
  return {
    hotel: row,
    rooms: Array.isArray(row?.rooms) ? row.rooms : [],
  };
}

function roomOk(r) {
  const price = r?.price || {};
  const total = price.totalAmount ?? price.total ?? r?.totalAmount;
  return (
    Boolean(r?.bookingCode || r?.title || r?.name || r?.roomName) &&
    typeof total === 'number' &&
    total >= 0
  );
}

async function main() {
  console.log('=== Hotel unavail search + available details (no book) ===');
  console.log('BASE', process.env.BASE_URL);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const hotelSvc = new HotelService(session.client);

  const rows = [];
  const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  let n = 0;
  const add = (caseId, section, rule, how, expected, status, actual, extra = {}) => {
    n += 1;
    rows.push({ id: n, caseId, section, rule, how, expected, status, actual, ...extra });
    counts[status] += 1;
    console.log(`[${status}] ${caseId} ${rule} — ${actual}`);
  };

  // -------- 1) Sahara Star targeted unavail (changelog example) --------
  {
    const entityId = '39649446';
    const unavailRes = await hotelSvc.search(
      searchBody({ entityId, type: 'HOTEL', checkin: CHECKIN, checkout: CHECKOUT, rooms: UNAVAIL_ROOM }),
      { pid: 'vgm', page: 0, perpage: 20 },
    );
    const uData = unavailRes.data || {};
    const uHit = (uData.results || [])[0];
    add(
      'H-UN1',
      'UNAVAIL',
      'Sahara Star sold-out uses new SRP shape',
      `POST /v1/hotels/search type=HOTEL entityId=${entityId} adults=6 ${CHECKIN}`,
      'HTTP 200; results[0].available===false; price===null; id/name present; NOT old empty+message only',
      unavailRes.status === 200 && isNewUnavail(uHit) && !oldEmptyEnvelope(uData) ? 'PASS' : 'BUG',
      `http=${unavailRes.status} total=${uData.totalResults} message=${uData.message || '-'} available=${uHit?.available} priceNull=${uHit?.price === null} name=${uHit?.name}`,
      { responseHotel: summarizeSearchHotel(uHit), oldEmpty: oldEmptyEnvelope(uData) },
    );

    const availRes = await hotelSvc.search(
      searchBody({ entityId, type: 'HOTEL', checkin: CHECKIN, checkout: CHECKOUT, rooms: AVAIL_ROOM }),
      { pid: 'vgm', page: 0, perpage: 20 },
    );
    const aHit = (availRes.data?.results || [])[0];
    add(
      'H-UN2',
      'UNAVAIL',
      'Sahara Star available (1ADT) still returns priced search hit',
      `HOTEL search adults=1`,
      'available!==false; price.totalAmount>=0',
      availRes.status === 200 && isAvailSearch(aHit) ? 'PASS' : 'BUG',
      `http=${availRes.status} available=${aHit?.available} totalAmt=${aHit?.price?.totalAmount}`,
      { hotel: summarizeSearchHotel(aHit) },
    );

    // Details for available Sahara Star
    const det = await hotelSvc.getDetails(
      searchBody({ entityId, type: 'HOTEL', checkin: CHECKIN, checkout: CHECKOUT, rooms: AVAIL_ROOM }),
    );
    const { hotel: dHotel, rooms } = detailsRooms(det.data);
    const pricedRooms = rooms.filter(roomOk);
    const negRooms = rooms.filter((r) => {
      const t = r?.price?.totalAmount ?? r?.price?.total;
      return typeof t === 'number' && t < 0;
    });
    add(
      'H-UN3',
      'UNAVAIL',
      'Sahara Star details for available stay has rooms + prices',
      `POST /v1/hotels/details entityId=${entityId}`,
      'HTTP 200; results[0].rooms length>0; room prices >=0; hotel name present',
      det.status === 200 && rooms.length > 0 && pricedRooms.length > 0 && negRooms.length === 0 && dHotel?.name
        ? 'PASS'
        : 'BUG',
      `http=${det.status} rooms=${rooms.length} pricedOk=${pricedRooms.length} neg=${negRooms.length} name=${dHotel?.name} hotelAvail=${dHotel?.available}`,
      {
        hotelPrice: dHotel?.price || null,
        roomSample: pricedRooms.slice(0, 3).map((r) => ({
          title: r.title || r.name,
          total: r.price?.totalAmount,
          mealType: r.mealType,
          available: r.available,
        })),
      },
    );
  }

  // -------- 2) Per Indian city: available search + unavail shape + details (CSV H-UN-{city}) --------
  for (const city of CITIES) {
    const caseId = `H-UN-${city.key}`;
    const search = await hotelSvc.search(
      searchBody({ entityId: city.entityId, type: 'CITY', checkin: CHECKIN, checkout: CHECKOUT, rooms: AVAIL_ROOM }),
      { pid: 'vgm', page: 0, perpage: PERPAGE, sort: 'price_ASC' },
    );
    const results = search.data?.results || [];
    const avail = results.filter((h) => h.available !== false);
    const unavail = results.filter((h) => h.available === false);
    const availOk = avail.length > 0 && avail.every(isAvailSearch);
    const unavailOk = unavail.length === 0 || unavail.every(isNewUnavail);
    const searchOk = search.status === 200 && availOk && unavailOk;

    const pick = avail[0];
    let detailsOk = false;
    let detailsActual = 'no available hotel on page';
    let detailsExtra = {};

    if (pick?.id) {
      const det = await hotelSvc.getDetails(
        searchBody({ entityId: pick.id, type: 'HOTEL', checkin: CHECKIN, checkout: CHECKOUT, rooms: AVAIL_ROOM }),
      );
      const { hotel: dHotel, rooms } = detailsRooms(det.data);
      const pricedRooms = rooms.filter(roomOk);
      const negRooms = rooms.filter((r) => {
        const t = r?.price?.totalAmount ?? r?.price?.total;
        return typeof t === 'number' && t < 0;
      });
      const nameOk = Boolean(dHotel?.name);
      const starOk = dHotel?.starRating != null;
      const gstOk = typeof dHotel?.isGSTClaimable === 'boolean';
      detailsOk =
        det.status === 200 &&
        rooms.length > 0 &&
        pricedRooms.length > 0 &&
        negRooms.length === 0 &&
        nameOk &&
        starOk &&
        gstOk;
      detailsActual = `http=${det.status} rooms=${rooms.length} pricedOk=${pricedRooms.length} neg=${negRooms.length} star=${dHotel?.starRating} gst=${dHotel?.isGSTClaimable}`;
      detailsExtra = {
        searchHotel: summarizeSearchHotel(pick),
        detailsHotel: {
          id: dHotel?.id,
          name: dHotel?.name,
          starRating: dHotel?.starRating,
          available: dHotel?.available,
          isGSTClaimable: dHotel?.isGSTClaimable,
          hotelTotal: dHotel?.price?.totalAmount ?? null,
        },
        roomSample: pricedRooms.slice(0, 3).map((r) => ({
          title: r.title || r.name,
          total: r.price?.totalAmount,
          mealType: r.mealType,
          available: r.available,
        })),
      };
    }

    let status = 'BUG';
    if (search.status !== 200 || !availOk) status = 'BUG';
    else if (!pick?.id) status = searchOk && unavailOk ? 'PASS' : 'BUG';
    else if (searchOk && detailsOk) status = 'PASS';
    else status = 'BUG';

    add(
      caseId,
      'UNAVAIL',
      `${city.key}: available SRP fields + unavail rows + details`,
      `CITY ${city.entityId} price_ASC page 0; details on first available hotel`,
      'Available hotels: name/star/price/isGSTClaimable; unavailable rows: available:false+price:null; details: rooms with prices',
      status,
      `search http=${search.status} avail=${avail.length} unavail=${unavail.length} availOk=${availOk} unavailOk=${unavailOk}; details ${detailsActual}`,
      {
        availableSample: avail.slice(0, 3).map(summarizeSearchHotel),
        unavailableSample: unavail.slice(0, 3).map(summarizeSearchHotel),
        ...detailsExtra,
      },
    );
  }

  // -------- 3) Extra unavail probes on a few city hotels with adults=6 --------
  const mumbai = await hotelSvc.search(
    searchBody({ entityId: '357389:IN', type: 'CITY', checkin: CHECKIN, checkout: CHECKOUT, rooms: AVAIL_ROOM }),
    { pid: 'vgm', page: 0, perpage: 5, sort: 'price_ASC' },
  );
  const probes = [];
  for (const h of (mumbai.data?.results || []).slice(0, 5)) {
    const res = await hotelSvc.search(
      searchBody({ entityId: h.id, type: 'HOTEL', checkin: CHECKIN, checkout: CHECKOUT, rooms: UNAVAIL_ROOM }),
      { pid: 'vgm', page: 0, perpage: 5 },
    );
    const hit = (res.data?.results || [])[0];
    probes.push({
      id: h.id,
      name: h.name,
      http: res.status,
      total: res.data?.totalResults,
      message: res.data?.message || null,
      oldEmpty: oldEmptyEnvelope(res.data),
      hotel: hit ? summarizeSearchHotel(hit) : null,
      newUnavail: hit ? isNewUnavail(hit) : false,
    });
  }
  const newN = probes.filter((p) => p.newUnavail).length;
  const oldN = probes.filter((p) => p.oldEmpty).length;
  add(
    'H-UN-Mum6',
    'UNAVAIL',
    'Mumbai sample HOTEL searches with adults=6 prefer new unavail shape',
    '5 hotels from Mumbai listing',
    'When no inventory: available:false+price:null (not empty message envelope)',
    newN > 0 && oldN === 0 ? 'PASS' : oldN > 0 ? 'BUG' : newN > 0 ? 'PASS' : 'NOT_TESTED',
    `newUnavail=${newN} oldEmpty=${oldN}`,
    { probes },
  );

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    note: 'Search + details only. No book/prebook/finalize.',
    counts,
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

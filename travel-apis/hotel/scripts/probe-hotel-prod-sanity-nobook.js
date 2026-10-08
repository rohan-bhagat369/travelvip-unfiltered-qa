/**
 * Prod hotel sanity — cities + one path through prebook. NO finalize/book.
 *
 * - 8 CITY searches limit=1 (availability only)
 * - Hilltop: HOTEL search → details → prebook (stop)
 * - Never finalize / cancel
 *
 *   $env:BASE_URL='https://api.travelvip.ai'
 *   node scripts/probe-hotel-prod-sanity-nobook.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { HILLTOP } from '../src/regression/fixtures.js';
import {
  availableRooms,
  hilltopSearchDetails,
  prebookRoom,
} from '../src/regression/session.js';
import {
  extractBookingContext,
  isPrebookSuccess,
} from '../src/helpers.js';

const BASE = (process.env.BASE_URL || config.baseUrl || '').replace(/\/$/, '');
const OUT = 'reports/hotel-prod-sanity-nobook.json';

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

function futureYmd(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function row(id, rule, how, expect, actual, status, extra = {}) {
  return { id, rule, how, expect, actual, status, ...extra };
}

function firstHotelSnippet(data) {
  const list = data?.content || data?.hotels || data?.results || [];
  const h = Array.isArray(list) ? list[0] : null;
  if (!h) return null;
  return {
    entityId: h.entityId || h.id || null,
    name: h.name || h.title || null,
    available: h.available,
    baseFare: h.price?.baseFare ?? h.baseFare ?? null,
    starRating: h.starRating ?? h.star ?? null,
  };
}

function encryptedOk(code) {
  const s = String(code || '');
  if (!s) return false;
  if (/RIYA|!TB!/i.test(s)) return false;
  return s.length > 12;
}

clearSession();
console.log(`BASE_URL=${BASE}`);
console.log('NO-BOOK: cities(limit=1) + Hilltop search→details→prebook. NO finalize.\n');

const session = await authenticate(true);
const hotel = new HotelService(session.client);
const rows = [];
const checkin = futureYmd(35);
const checkout = futureYmd(36);
let inventoryLooks = 0;

rows.push(row(
  'AUTH.1',
  'Partner token + session',
  'POST /auth/partner/token → POST /v1/auth/session',
  'access_token + auth_token',
  `base=${BASE} tierId=${config.tierId} hasAuth=${Boolean(session.client?.authToken)}`,
  session.client?.authToken ? 'PASS' : 'BUG',
));

const cityAc = await hotel.autocomplete('pune', 0, 5);
rows.push(row(
  'SMOKE.1',
  'Autocomplete city q=pune',
  'GET /v1/hotels/autocomplete',
  'HTTP 200, content[]',
  `HTTP ${cityAc.status} content=${(cityAc.data?.content || []).length}`,
  cityAc.ok && (cityAc.data?.content || []).length > 0 ? 'PASS' : 'BUG',
));

const hotelAc = await hotel.autocomplete('hiltop', 0, 5);
const hotels = (hotelAc.data?.content || []).filter((x) => /HOTEL/i.test(String(x.type || '')));
const picked = hotels.find((h) => String(h.entityId || '').startsWith(HILLTOP.entityId))
  || hotels.find((h) => /hiltop/i.test(h.title || ''));
rows.push(row(
  'SMOKE.2',
  'Autocomplete hotel q=hiltop',
  'GET /v1/hotels/autocomplete',
  'HTTP 200, Hilltop entityId',
  `HTTP ${hotelAc.status} entityId=${picked?.entityId || null}`,
  hotelAc.ok && picked?.entityId ? 'PASS' : 'BUG',
));

for (const city of CITIES) {
  const searchBody = {
    entityId: city.entityId,
    nationality: 'IN',
    checkin,
    checkout,
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: 'vgm',
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
  const search = await hotel.search(searchBody, { pid: 'vgm', offset: 0, limit: 1 });
  inventoryLooks += 1;
  const total = search.data?.totalResults ?? search.data?.availableResults ?? 0;
  const sample = firstHotelSnippet(search.data);
  const httpOk = search.ok && search.status === 200;
  const status = httpOk && total > 0 ? 'PASS' : (httpOk ? 'NOT TESTED' : 'BUG');
  rows.push(row(
    `CITY.${city.key}`,
    `CITY search ${city.key} (limit=1)`,
    `POST /v1/hotels/search ${city.entityId}`,
    'HTTP 200 + inventory',
    `HTTP ${search.status} total=${total} sample=${sample?.name || '-'} fare=${sample?.baseFare ?? '-'}`,
    status,
    { city: city.key, total, sample },
  ));
}

// Hilltop → details → prebook (one path only; no finalize)
let stay = null;
const dayTries = [35, 28, 42];
for (const days of dayTries) {
  stay = await hilltopSearchDetails(hotel, { checkinDays: days, nights: 1 });
  inventoryLooks += 2; // HOTEL search + details
  if (stay.rooms?.length) break;
}

rows.push(row(
  'PRE.1',
  'Hilltop HOTEL search',
  `POST /v1/hotels/search entityId=${HILLTOP.entityId}`,
  'HTTP 200',
  `HTTP ${stay?.search?.status} ok=${stay?.search?.ok} stay=${stay?.searchBody?.checkin}→${stay?.searchBody?.checkout}`,
  stay?.search?.ok ? 'PASS' : 'BUG',
));

const rooms = stay?.rooms || [];
const room = rooms[0] || null;
rows.push(row(
  'PRE.2',
  'Hilltop details rooms + encrypted bookingCode',
  'POST /v1/hotels/details (use details requestId)',
  'HTTP 200, ≥1 room, bookingCode encrypted (no RIYA)',
  `HTTP ${stay?.details?.status} rooms=${rooms.length} requestId=${stay?.requestId || null} codeLen=${room?.bookingCode?.length || 0} enc=${encryptedOk(room?.bookingCode)}`,
  stay?.details?.ok && rooms.length > 0 && stay?.requestId && encryptedOk(room?.bookingCode) ? 'PASS' : 'BUG',
  { sampleRoom: room ? { bookingCodeLen: room.bookingCode?.length, totalAmount: room.price?.totalAmount, isPANMandatory: room.isPANMandatory } : null },
));

let pre = null;
if (room && stay?.requestId) {
  pre = await prebookRoom(hotel, stay, room);
  inventoryLooks += 1; // prebook counts as funnel look
  const ctx = extractBookingContext(pre?.data);
  const preOk = isPrebookSuccess(pre);
  rows.push(row(
    'PRE.3',
    'Hilltop prebook (stop — no finalize)',
    'POST /v1/hotels/prebook',
    'HTTP 200 + bookingContext; NO finalize called',
    `HTTP ${pre?.status} success=${preOk} hasContext=${Boolean(ctx)} total=${pre?.data?.price?.totalAmount ?? pre?.data?.totalAmount ?? room.price?.totalAmount ?? null} err=${pre?.data?.error?.code || ''}`,
    preOk && ctx ? 'PASS' : 'BUG',
    {
      bookingContextPresent: Boolean(ctx),
      finalizeCalled: false,
      bookingCodeEncrypted: encryptedOk(room.bookingCode),
    },
  ));

  const detailsAmt = Number(room.price?.totalAmount);
  const preAmt = Number(pre?.data?.price?.totalAmount ?? pre?.data?.totalAmount);
  if (Number.isFinite(detailsAmt) && Number.isFinite(preAmt)) {
    const delta = Math.abs(detailsAmt - preAmt);
    rows.push(row(
      'PRE.4',
      'Details total ≈ prebook total (±₹1)',
      'compare room.price.totalAmount vs prebook',
      '|Δ| ≤ 1',
      `details=${detailsAmt} prebook=${preAmt} Δ=${delta.toFixed(2)}`,
      delta <= 1 ? 'PASS' : 'BUG',
    ));
  } else {
    rows.push(row(
      'PRE.4',
      'Details total ≈ prebook total (±₹1)',
      'compare totals',
      '|Δ| ≤ 1',
      'amounts missing',
      'NOT TESTED',
    ));
  }
} else {
  rows.push(row(
    'PRE.3',
    'Hilltop prebook (stop — no finalize)',
    'POST /v1/hotels/prebook',
    'HTTP 200 + bookingContext',
    'skipped — no room/requestId',
    'NOT TESTED',
  ));
}

rows.push(row(
  'GUARD.1',
  'No finalize / book / cancel',
  'script guard',
  'finalize never called',
  'finalizeCalled=false cancelCalled=false',
  'PASS',
));

const summary = {
  at: new Date().toISOString(),
  baseUrl: BASE,
  stay: { checkin, checkout, hilltop: stay?.searchBody ? { checkin: stay.searchBody.checkin, checkout: stay.searchBody.checkout } : null },
  l2bGuardrails: {
    inventoryLooks,
    cities: CITIES.length,
    prebookPath: 'Hilltop once only',
    skipped: ['finalize-booking', 'cancel', 'penalty', 'history', 'pagination'],
  },
  counts: {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  },
  rows,
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ counts: summary.counts, inventoryLooks, finalizeCalled: false }, null, 2));
for (const r of rows) {
  console.log(`${r.status.padEnd(11)} ${r.id.padEnd(16)} ${r.rule} :: ${r.actual}`);
}
console.log(`\nWrote ${OUT}`);
process.exit(summary.counts.BUG > 0 ? 1 : 0);

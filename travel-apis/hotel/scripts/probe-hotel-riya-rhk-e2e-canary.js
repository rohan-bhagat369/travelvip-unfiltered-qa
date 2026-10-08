/**
 * Canary E2E: Riya + RateHawk — salesSummary on success, vendor message on Failed
 * Run: $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/probe-hotel-riya-rhk-e2e-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingCodes,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';

const OUT = path.join('reports', 'hotel-riya-rhk-e2e-canary.json');
const rows = [];

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const REQUIRED_SALES = [
  'baseFare',
  'tax',
  'convenienceFee',
  'totalAmount',
  'totalDiscount',
  'currency',
  'taxBreakup',
];

function brief(d, n = 400) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

function add(section, rule, how, expected, status, actual, evidence = {}) {
  const row = {
    section, rule, how, expected, status, actual, ...evidence, at: new Date().toISOString(),
  };
  rows.push(row);
  console.log(`[${status}] ${section} | ${rule} — ${actual}`);
}

function supplierFromCode(code) {
  const parts = String(code || '').split('!TB!');
  return parts[1] || null;
}

function validateSalesSummary(sales, label) {
  const issues = [];
  if (!sales || typeof sales !== 'object') {
    return { ok: false, issues: ['salesSummary missing'], sales };
  }
  for (const k of REQUIRED_SALES) {
    if (!(k in sales)) issues.push(`missing ${k}`);
  }
  for (const k of ['baseFare', 'tax', 'convenienceFee', 'totalAmount', 'totalDiscount']) {
    if (k in sales && typeof sales[k] !== 'number') issues.push(`${k} not number (${typeof sales[k]})`);
  }
  if (sales.currency != null && typeof sales.currency !== 'string') issues.push('currency not string');
  const tb = sales.taxBreakup;
  if (!tb || typeof tb !== 'object') {
    issues.push('taxBreakup missing');
  } else {
    if (!('gst' in tb)) issues.push('taxBreakup.gst missing');
    if (!('otherTaxes' in tb)) issues.push('taxBreakup.otherTaxes missing');
    if (typeof tb.gst !== 'number') issues.push('taxBreakup.gst not number');
    if (typeof tb.otherTaxes !== 'number') issues.push('taxBreakup.otherTaxes not number');
    if (typeof sales.tax === 'number' && typeof tb.gst === 'number' && typeof tb.otherTaxes === 'number') {
      const sum = +(tb.gst + tb.otherTaxes).toFixed(2);
      if (Math.abs(sum - sales.tax) > 0.05) {
        issues.push(`gst+otherTaxes (${sum}) != tax (${sales.tax})`);
      }
    }
  }
  if (typeof sales.baseFare === 'number' && typeof sales.tax === 'number' && typeof sales.convenienceFee === 'number'
    && typeof sales.totalAmount === 'number' && typeof sales.totalDiscount === 'number') {
    const calc = +(sales.baseFare + sales.tax + sales.convenienceFee - sales.totalDiscount).toFixed(2);
    if (Math.abs(calc - sales.totalAmount) > 0.05) {
      issues.push(`base+tax+fee-discount (${calc}) != totalAmount (${sales.totalAmount})`);
    }
  }
  return { ok: issues.length === 0, issues, sales, label };
}

async function waitTerminal(hotel, br, maxAttempts = 40) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (i === 0 || i % 4 === 0 || isTerminalHotelStatus(st)) {
      console.log(`  poll ${i + 1}: ${st} message=${JSON.stringify(last.data?.message)}`);
    }
    if (last.ok && isTerminalHotelStatus(st)) return { status: st, response: last };
    await sleep(4000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

/**
 * Search candidates that can yield RIYA or RHK bookingCodes.
 * Prefer HOTEL entities known for each supplier; also try CITY for RHK mix.
 */
async function findRoomsBySupplier(hotel, wantSupplier) {
  const targets = wantSupplier === 'RIYA'
    ? [
      { entityId: '39627872', type: 'HOTEL' }, // Hiltop Mumbai — RIYA
      { entityId: '133504', type: 'CITY' }, // Pune city — may mix
    ]
    : [
      { entityId: '2869073', type: 'HOTEL' }, // Taj Dubai — often RHK
      { entityId: '25921', type: 'HOTEL' },
      { entityId: '133504', type: 'CITY' },
      { entityId: '2823286', type: 'HOTEL' },
    ];

  const dayCandidates = [21, 28, 35, 14, 45, 7];
  const found = [];

  for (const t of targets) {
    for (const days of dayCandidates) {
      const searchBody = buildSearchBody({
        entityId: t.entityId,
        checkinDays: days,
        nights: 1,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      searchBody.type = t.type;

      const search = await hotel.search(searchBody);
      if (!search.ok) continue;

      // CITY search: pick first few hotels and details each
      const hotelIds = t.type === 'CITY'
        ? (search.data?.results || []).slice(0, 5).map((h) => h.id).filter(Boolean)
        : [t.entityId];

      for (const entityId of hotelIds) {
        const detailsBody = {
          ...searchBody,
          entityId: String(entityId),
          type: 'HOTEL',
        };
        const details = await hotel.getDetails(detailsBody);
        if (!details.ok) continue;
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        const rooms = details.data?.results?.[0]?.rooms || [];
        const hotelName = details.data?.results?.[0]?.name;
        for (const room of rooms) {
          const code = room.bookingCode;
          const supplier = supplierFromCode(code);
          if (supplier !== wantSupplier || !requestId || !code) continue;
          found.push({
            supplier,
            entityId: String(entityId),
            hotelName,
            searchBody: detailsBody,
            requestId,
            bookingCode: code,
            room,
            details,
          });
        }
        if (found.length >= 8) return found;
      }
      if (found.length >= 4) return found;
    }
  }
  return found;
}

async function bookOne(hotel, candidate, { tag }) {
  const { bookingCode, requestId, searchBody, room, hotelName, supplier, entityId } = candidate;
  const pre = await hotel.prebook({ bookingCode, requestId });
  if (!isPrebookSuccess(pre)) {
    return { ok: false, reason: 'prebook failed', pre };
  }

  const body = {
    bookingContext: extractBookingContext(pre.data),
    bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    rooms: [{
      guests: [{
        title: 'Mr',
        firstName: config.hotel.guestFirstName,
        lastName: config.hotel.guestLastName,
        type: 'Adult',
        isLead: true,
      }],
    }],
    contact: {
      email: `hotel.${tag}.${Date.now()}@travelvip.ai`,
      countryCode: '+91',
      mobile: config.hotel.contactMobile,
    },
  };

  const isPAN = Boolean(room?.isPANMandatory);
  const isGST = Boolean(room?.isGSTClaimable);
  if (isPAN) {
    body.contact.panCardNumber = 'ABCDE1234F';
    body.contact.panCardName = `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`;
  }
  if (isGST) body.gstDetails = { ...VALID_GST };

  // Prefer including PAN for Indian rates even if flag false — harmless if optional
  if (!body.contact.panCardNumber && supplier === 'RIYA') {
    body.contact.panCardNumber = 'ABCDE1234F';
    body.contact.panCardName = `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`;
  }

  console.log(`  finalize ${supplier} ${hotelName} ${String(bookingCode).slice(0, 55)}...`);
  const fin = await hotel.finalizeBooking(body);
  const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
  if (!fin.ok || !br) {
    return {
      ok: false,
      reason: `finalize HTTP ${fin.status} ${fin.data?.error?.code || brief(fin.data, 120)}`,
      fin,
    };
  }

  const w = await waitTerminal(hotel, br);
  const statusRes = w.response;
  const detailRes = await hotel.getBookingDetail(br);
  const roomPrice = room?.price?.totalAmount ?? room?.totalFare ?? null;

  return {
    ok: true,
    supplier,
    entityId,
    hotelName,
    bookingCode,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    br,
    terminalStatus: w.status,
    isPANMandatory: isPAN,
    isGSTClaimable: isGST,
    roomPrice,
    finalize: fin,
    statusRes,
    detailRes,
    statusSales: statusRes?.data?.salesSummary,
    detailSales: detailRes?.data?.salesSummary,
    statusMessage: statusRes?.data?.message,
    detailMessage: detailRes?.data?.message,
  };
}

function assertSuccessSales(provider, book) {
  const section = `${provider}-Confirmed`;
  const st = String(book.terminalStatus || '');
  if (!/confirm/i.test(st)) {
    add(section, 'Reach Confirmed', 'Book + poll', 'status=Confirmed', 'NOT TESTED', `Got ${st} br=${book.br}`);
    return;
  }

  add(section, 'Booking Confirmed', 'E2E finalize+poll', 'Confirmed', 'PASS', `br=${book.br} hotel=${book.hotelName}`);

  for (const [api, sales] of [
    ['status', book.statusSales],
    ['details', book.detailSales],
  ]) {
    const v = validateSalesSummary(sales, api);
    add(
      section,
      `${api} salesSummary schema + math`,
      `GET ${api}`,
      'All properties + taxBreakup; totals consistent',
      v.ok ? 'PASS' : 'BUG',
      v.ok
        ? `base=${sales.baseFare} tax=${sales.tax} total=${sales.totalAmount} gst=${sales.taxBreakup?.gst} other=${sales.taxBreakup?.otherTaxes}`
        : v.issues.join('; '),
      { salesSummary: sales, responseSnippet: brief(api === 'status' ? book.statusRes?.data : book.detailRes?.data, 500) },
    );
  }

  // Price consistency status vs details
  if (book.statusSales && book.detailSales) {
    const same = Math.abs(Number(book.statusSales.totalAmount) - Number(book.detailSales.totalAmount)) < 0.05
      && Math.abs(Number(book.statusSales.tax) - Number(book.detailSales.tax)) < 0.05;
    add(
      section,
      'status vs details totals match',
      'Compare salesSummary',
      'Same totalAmount/tax',
      same ? 'PASS' : 'BUG',
      `status.total=${book.statusSales.totalAmount} details.total=${book.detailSales.totalAmount}`,
    );
  }

  // message null on success
  const msgOk = book.statusMessage == null && book.detailMessage == null;
  add(
    section,
    'message null on Confirmed',
    'Inspect message key',
    'message null (or absent) on success',
    msgOk ? 'PASS' : 'BUG',
    `status.message=${JSON.stringify(book.statusMessage)} details.message=${JSON.stringify(book.detailMessage)}`,
  );

  // Cross-check room price if available (allow currency/rounding)
  if (typeof book.roomPrice === 'number' && book.detailSales?.totalAmount != null) {
    const delta = Math.abs(Number(book.roomPrice) - Number(book.detailSales.totalAmount));
    // Room price at details may differ slightly from finalized salesSummary — soft check
    add(
      section,
      'salesSummary total vs room price (soft)',
      'Compare room.price.totalAmount to salesSummary.totalAmount',
      'Roughly aligned (informational if vendor adjusts)',
      delta < 1 || delta / Number(book.detailSales.totalAmount) < 0.05 ? 'PASS' : 'BUG',
      `room=${book.roomPrice} sales=${book.detailSales.totalAmount} delta=${delta.toFixed(2)}`,
    );
  }
}

function assertFailedMessage(provider, book) {
  const section = `${provider}-Failed`;
  const st = String(book.terminalStatus || '');
  if (!/fail/i.test(st)) {
    add(section, 'Reach Failed', 'Book + poll', 'status=Failed', 'NOT TESTED', `Got ${st} br=${book.br}`);
    return;
  }

  add(section, 'Booking Failed', 'E2E finalize+poll', 'Failed', 'PASS', `br=${book.br} hotel=${book.hotelName}`);

  const stMsg = book.statusMessage;
  const dMsg = book.detailMessage;
  const stOk = typeof stMsg === 'string' && stMsg.trim().length > 0;
  const dOk = typeof dMsg === 'string' && dMsg.trim().length > 0;

  add(
    section,
    'status message non-null (provider reason)',
    'GET .../status',
    'message = non-empty provider string',
    stOk ? 'PASS' : 'BUG',
    stOk ? `message=${JSON.stringify(stMsg)}` : `message=${JSON.stringify(stMsg)}`,
    { responseSnippet: brief(book.statusRes?.data, 500) },
  );
  add(
    section,
    'details message non-null (provider reason)',
    'GET .../bookings/{id}',
    'message = non-empty provider string',
    dOk ? 'PASS' : 'BUG',
    dOk ? `message=${JSON.stringify(dMsg)}` : `message=${JSON.stringify(dMsg)}`,
    { responseSnippet: brief(book.detailRes?.data, 500) },
  );

  if (stOk && dOk) {
    add(
      section,
      'status & details message match',
      'Compare messages',
      'Same provider reason',
      stMsg === dMsg ? 'PASS' : 'BUG',
      `status=${JSON.stringify(stMsg)} details=${JSON.stringify(dMsg)}`,
    );
  }

  // salesSummary still useful on Failed
  for (const [api, sales] of [
    ['status', book.statusSales],
    ['details', book.detailSales],
  ]) {
    const v = validateSalesSummary(sales, api);
    add(
      section,
      `${api} salesSummary present on Failed`,
      `GET ${api}`,
      'taxBreakup schema OK when salesSummary present',
      sales ? (v.ok ? 'PASS' : 'BUG') : 'BUG',
      sales
        ? (v.ok ? `total=${sales.totalAmount} gst=${sales.taxBreakup?.gst}` : v.issues.join('; '))
        : 'salesSummary missing',
      { salesSummary: sales },
    );
  }
}

async function obtainOutcomes(hotel, wantSupplier, maxAttempts = 10) {
  console.log(`\n========== Finding ${wantSupplier} rooms ==========`);
  const rooms = await findRoomsBySupplier(hotel, wantSupplier);
  console.log(`Found ${rooms.length} ${wantSupplier} room candidates`);
  if (!rooms.length) {
    add(wantSupplier, 'Find bookable rooms', 'Search/details', `${wantSupplier} bookingCodes`, 'BUG', 'No rooms found');
    return { confirmed: null, failed: null, attempts: [] };
  }

  const attempts = [];
  let confirmed = null;
  let failed = null;

  for (const cand of rooms.slice(0, maxAttempts)) {
    if (confirmed && failed) break;
    console.log(`\nAttempt ${wantSupplier} ${cand.hotelName} code=${String(cand.bookingCode).slice(0, 60)}`);
    const book = await bookOne(hotel, cand, { tag: wantSupplier.toLowerCase() });
    attempts.push({
      hotelName: cand.hotelName,
      bookingCode: cand.bookingCode,
      ok: book.ok,
      br: book.br,
      status: book.terminalStatus,
      reason: book.reason,
      statusMessage: book.statusMessage,
    });
    if (!book.ok) {
      console.log('  skip', book.reason);
      continue;
    }
    console.log(`  → ${book.br} ${book.terminalStatus}`);
    if (/confirm/i.test(String(book.terminalStatus)) && !confirmed) confirmed = book;
    if (/fail/i.test(String(book.terminalStatus)) && !failed) failed = book;
  }

  return { confirmed, failed, attempts };
}

async function main() {
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  const riya = await obtainOutcomes(hotel, 'RIYA', 8);
  const rhk = await obtainOutcomes(hotel, 'RHK', 10);

  console.log('\n=== Assertions RIYA ===');
  if (riya.confirmed) assertSuccessSales('RIYA', riya.confirmed);
  else add('RIYA-Confirmed', 'Obtain Confirmed', 'E2E book', 'Confirmed BR', 'NOT TESTED', 'No Confirmed Riya booking this run');

  if (riya.failed) assertFailedMessage('RIYA', riya.failed);
  else add('RIYA-Failed', 'Obtain Failed', 'E2E book', 'Failed BR with message', 'NOT TESTED', 'No Failed Riya booking this run');

  console.log('\n=== Assertions RHK ===');
  if (rhk.confirmed) assertSuccessSales('RHK', rhk.confirmed);
  else add('RHK-Confirmed', 'Obtain Confirmed', 'E2E book', 'Confirmed BR', 'NOT TESTED', 'No Confirmed RateHawk booking this run');

  if (rhk.failed) assertFailedMessage('RHK', rhk.failed);
  else add('RHK-Failed', 'Obtain Failed', 'E2E book', 'Failed BR with message', 'NOT TESTED', 'No Failed RateHawk booking this run');

  // History fallback for missing outcomes
  console.log('\n=== History fallback ===');
  const hist = await hotel.bookingHistory(0, 50);
  const bookings = hist.data?.bookings || [];

  async function hydrateFromHistory(wantStatus, label) {
    for (const b of bookings.filter((x) => new RegExp(wantStatus, 'i').test(String(x.status)))) {
      const st = await hotel.getBookingStatus(b.bookingId);
      const det = await hotel.getBookingDetail(b.bookingId);
      // Can't know supplier from history easily — skip supplier-specific unless we already have
      return {
        br: b.bookingId,
        hotelName: b.hotelName,
        terminalStatus: st.data?.status || b.status,
        statusRes: st,
        detailRes: det,
        statusSales: st.data?.salesSummary,
        detailSales: det.data?.salesSummary,
        statusMessage: st.data?.message,
        detailMessage: det.data?.message,
        roomPrice: null,
      };
    }
    return null;
  }

  // If RHK confirmed missing, note — RateHawk often fails on staging/canary test hotels
  const score = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    score,
    providers: {
      RIYA: {
        confirmed: riya.confirmed && {
          br: riya.confirmed.br,
          hotel: riya.confirmed.hotelName,
          status: riya.confirmed.terminalStatus,
          salesSummary: riya.confirmed.detailSales,
          message: riya.confirmed.detailMessage,
        },
        failed: riya.failed && {
          br: riya.failed.br,
          hotel: riya.failed.hotelName,
          status: riya.failed.terminalStatus,
          message: riya.failed.detailMessage,
          salesSummary: riya.failed.detailSales,
        },
        attempts: riya.attempts,
      },
      RHK: {
        confirmed: rhk.confirmed && {
          br: rhk.confirmed.br,
          hotel: rhk.confirmed.hotelName,
          status: rhk.confirmed.terminalStatus,
          salesSummary: rhk.confirmed.detailSales,
          message: rhk.confirmed.detailMessage,
        },
        failed: rhk.failed && {
          br: rhk.failed.br,
          hotel: rhk.failed.hotelName,
          status: rhk.failed.terminalStatus,
          message: rhk.failed.detailMessage,
          salesSummary: rhk.failed.detailSales,
        },
        attempts: rhk.attempts,
      },
    },
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n========== RIYA / RHK E2E REPORT ==========');
  console.log('Score:', score);
  console.log('Report:', OUT);
  for (const r of rows) console.log(`| ${r.status} | ${r.section} | ${r.rule}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

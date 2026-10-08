/**
 * Canary: Riya Confirmed (history) + RateHawk Taj Dubai Confirmed + Failed
 * Run: $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/probe-hotel-riya-history-rhk-taj-canary.js
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

const OUT = path.join('reports', 'hotel-riya-rhk-e2e-canary.json');
const TAJ = '2869073';
const rows = [];

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function supplier(code) {
  return String(code || '').split('!TB!')[1] || null;
}
function add(section, rule, how, expected, status, actual, evidence = {}) {
  const row = { section, rule, how, expected, status, actual, ...evidence, at: new Date().toISOString() };
  rows.push(row);
  console.log(`[${status}] ${section} | ${rule} — ${String(actual).slice(0, 240)}`);
}
function validateSales(sales) {
  const issues = [];
  if (!sales) return { ok: false, issues: ['salesSummary missing'] };
  for (const k of ['baseFare', 'tax', 'convenienceFee', 'totalAmount', 'totalDiscount', 'currency', 'taxBreakup']) {
    if (!(k in sales)) issues.push(`missing ${k}`);
  }
  const tb = sales.taxBreakup;
  if (!tb || typeof tb !== 'object') issues.push('taxBreakup missing');
  else {
    if (typeof tb.gst !== 'number') issues.push('gst not number');
    if (typeof tb.otherTaxes !== 'number') issues.push('otherTaxes not number');
    if (typeof sales.tax === 'number' && typeof tb.gst === 'number' && typeof tb.otherTaxes === 'number') {
      const sum = +(tb.gst + tb.otherTaxes).toFixed(2);
      if (Math.abs(sum - sales.tax) > 0.05) issues.push(`gst+otherTaxes(${sum})!=tax(${sales.tax})`);
    }
  }
  if (['baseFare', 'tax', 'convenienceFee', 'totalAmount', 'totalDiscount'].every((k) => typeof sales[k] === 'number')) {
    const calc = +(sales.baseFare + sales.tax + sales.convenienceFee - sales.totalDiscount).toFixed(2);
    if (Math.abs(calc - sales.totalAmount) > 0.05) {
      issues.push(`base+tax+fee-discount(${calc})!=total(${sales.totalAmount})`);
    }
  }
  return { ok: issues.length === 0, issues, sales };
}

async function waitTerminal(hotel, br, max = 40) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (i === 0 || i % 3 === 0 || isTerminalHotelStatus(st)) {
      console.log(`  poll ${i + 1}: ${st} message=${JSON.stringify(last.data?.message)}`);
    }
    if (last.ok && isTerminalHotelStatus(st)) return last;
    await sleep(4000);
  }
  return last;
}

function assertConfirmed(section, book) {
  add(section, 'Booking Confirmed', 'status poll / history', 'Confirmed', 'PASS',
    `br=${book.br} hotel=${book.hotelName || '-'} checkin=${book.checkin || '-'}`);
  for (const [api, sales] of [['status', book.statusSales], ['details', book.detailSales]]) {
    const v = validateSales(sales);
    add(
      section,
      `${api} salesSummary all properties + price math`,
      `GET ${api}`,
      'baseFare,tax,convenienceFee,totalAmount,totalDiscount,currency,taxBreakup{gst,otherTaxes}; math OK',
      v.ok ? 'PASS' : 'BUG',
      v.ok
        ? `base=${sales.baseFare} tax=${sales.tax} fee=${sales.convenienceFee} disc=${sales.totalDiscount} total=${sales.totalAmount} ${sales.currency} gst=${sales.taxBreakup.gst} other=${sales.taxBreakup.otherTaxes}`
        : v.issues.join('; '),
      { salesSummary: sales, snippet: brief(api === 'status' ? book.statusRes?.data : book.detailRes?.data) },
    );
  }
  if (book.statusSales && book.detailSales) {
    const same = Math.abs(book.statusSales.totalAmount - book.detailSales.totalAmount) < 0.05
      && Math.abs(book.statusSales.tax - book.detailSales.tax) < 0.05;
    add(section, 'status vs details prices match', 'Compare', 'same totals',
      same ? 'PASS' : 'BUG',
      `st.total=${book.statusSales.totalAmount} det.total=${book.detailSales.totalAmount}`);
  }
  add(section, 'message null on success', 'Inspect message', 'null',
    book.statusMessage == null && book.detailMessage == null ? 'PASS' : 'BUG',
    `status=${JSON.stringify(book.statusMessage)} details=${JSON.stringify(book.detailMessage)}`);
}

function assertFailed(section, book) {
  add(section, 'Booking Failed', 'finalize+poll', 'Failed', 'PASS',
    `br=${book.br} hotel=${book.hotelName || '-'}`);
  const stOk = typeof book.statusMessage === 'string' && book.statusMessage.trim().length > 0;
  const dOk = typeof book.detailMessage === 'string' && book.detailMessage.trim().length > 0;
  add(section, 'status message NOT null', 'GET status', 'non-empty provider reason',
    stOk ? 'PASS' : 'BUG', JSON.stringify(book.statusMessage),
    { snippet: brief(book.statusRes?.data) });
  add(section, 'details message NOT null', 'GET details', 'non-empty provider reason',
    dOk ? 'PASS' : 'BUG', JSON.stringify(book.detailMessage),
    { snippet: brief(book.detailRes?.data) });
  if (stOk && dOk) {
    add(section, 'status & details message match', 'Compare', 'same',
      book.statusMessage === book.detailMessage ? 'PASS' : 'BUG',
      `s=${book.statusMessage} | d=${book.detailMessage}`);
  }
  for (const [api, sales] of [['status', book.statusSales], ['details', book.detailSales]]) {
    const v = validateSales(sales);
    add(section, `${api} salesSummary on Failed`, `GET ${api}`, 'schema+math when present',
      sales ? (v.ok ? 'PASS' : 'BUG') : 'BUG',
      sales ? (v.ok ? `total=${sales.totalAmount} gst=${sales.taxBreakup.gst} other=${sales.taxBreakup.otherTaxes}` : v.issues.join('; ')) : 'missing',
      { salesSummary: sales });
  }
}

async function bookTaj({ hotel, wantStatus, usedCodes = new Set(), daysList }) {
  for (const days of daysList) {
    const body = buildSearchBody({
      entityId: TAJ,
      checkinDays: days,
      nights: 1,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    body.type = 'HOTEL';
    console.log(`\nTaj Dubai search +${days}d ${body.checkin} want=${wantStatus}`);
    const s = await hotel.search(body);
    if (!s.ok) {
      console.log(' search fail', s.status, brief(s.data, 120));
      continue;
    }
    const d = await hotel.getDetails(body);
    if (!d.ok) {
      console.log(' details fail', d.status, brief(d.data, 160));
      continue;
    }
    const rid = extractRequestId(d.data) || extractRequestId(s.data);
    const hotelName = d.data?.results?.[0]?.name;
    let rooms = (d.data?.results?.[0]?.rooms || []).filter((r) => supplier(r.bookingCode) === 'RHK');
    // Prefer rh-test for failure attempts (often fails), non-test for success
    if (wantStatus === 'Failed') {
      const test = rooms.filter((r) => String(r.bookingCode).includes('rh-test'));
      rooms = test.length ? [...test, ...rooms.filter((r) => !String(r.bookingCode).includes('rh-test'))] : rooms;
    } else {
      const nonTest = rooms.filter((r) => !String(r.bookingCode).includes('rh-test'));
      rooms = nonTest.length ? [...nonTest, ...rooms.filter((r) => String(r.bookingCode).includes('rh-test'))] : rooms;
    }
    console.log(' rooms RHK', rooms.length, 'hotel', hotelName);
    if (!rooms.length) continue;

    for (const room of rooms.slice(0, 8)) {
      if (usedCodes.has(room.bookingCode)) continue;
      const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId: rid });
      if (!isPrebookSuccess(pre)) continue;
      const finBody = {
        bookingContext: extractBookingContext(pre.data),
        bookingCode: room.bookingCode,
        requestId: rid,
        checkin: body.checkin,
        checkout: body.checkout,
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
          email: `hotel.rhk.${wantStatus.toLowerCase()}.${Date.now()}@travelvip.ai`,
          countryCode: '+91',
          mobile: config.hotel.contactMobile,
        },
      };
      if (room.isPANMandatory) {
        finBody.contact.panCardNumber = 'ABCDE1234F';
        finBody.contact.panCardName = `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`;
      }
      if (room.isGSTClaimable) finBody.gstDetails = { ...VALID_GST };

      console.log(' finalize', String(room.bookingCode).slice(0, 80));
      const fin = await hotel.finalizeBooking(finBody);
      const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
      console.log(' fin', fin.status, br, fin.data?.error?.code || '-');
      if (!fin.ok || !br) continue;
      usedCodes.add(room.bookingCode);

      const stRes = await waitTerminal(hotel, br);
      const det = await hotel.getBookingDetail(br);
      const terminal = stRes.data?.status;
      console.log(' →', br, terminal, 'message=', JSON.stringify(stRes.data?.message));
      const pack = {
        br,
        hotelName,
        checkin: body.checkin,
        checkout: body.checkout,
        bookingCode: room.bookingCode,
        statusRes: stRes,
        detailRes: det,
        statusSales: stRes.data?.salesSummary,
        detailSales: det.data?.salesSummary,
        statusMessage: stRes.data?.message,
        detailMessage: det.data?.message,
      };
      if (wantStatus === 'Confirmed' && /confirm/i.test(String(terminal))) return pack;
      if (wantStatus === 'Failed' && /fail/i.test(String(terminal))) return pack;
      // keep going if wrong terminal outcome
      console.log('  outcome not', wantStatus, '— continue');
    }
  }
  return null;
}

async function main() {
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  // ─── RIYA: existing Confirmed from history ───
  console.log('\n=== RIYA Confirmed from history ===');
  const hist = await hotel.bookingHistory(0, 50);
  const confs = (hist.data?.bookings || []).filter((b) => /confirm/i.test(String(b.status)));
  console.log('Confirmed in history:', confs.map((b) => `${b.bookingId} ${b.hotelName}`).slice(0, 10));

  const riyaHist = confs.find((b) => /hiltop|hilltop|keys prima|lemon|mumbai|pune/i.test(String(b.hotelName || '')))
    || confs[0];
  if (!riyaHist) {
    add('RIYA-Confirmed', 'Find history Confirmed', 'booking history', 'Confirmed BR', 'BUG', 'No Confirmed in history');
  } else {
    const st = await hotel.getBookingStatus(riyaHist.bookingId);
    const det = await hotel.getBookingDetail(riyaHist.bookingId);
    console.log('Using Riya/Indian Confirmed', riyaHist.bookingId, riyaHist.hotelName, st.data?.status);
    assertConfirmed('RIYA-Confirmed', {
      br: riyaHist.bookingId,
      hotelName: riyaHist.hotelName,
      checkin: riyaHist.checkin,
      statusRes: st,
      detailRes: det,
      statusSales: st.data?.salesSummary,
      detailSales: det.data?.salesSummary,
      statusMessage: st.data?.message,
      detailMessage: det.data?.message,
    });
  }

  // Known good Riya Failed from prior run if present in history
  console.log('\n=== RIYA Failed (history or known) ===');
  const fails = (hist.data?.bookings || []).filter((b) => /fail/i.test(String(b.status)));
  // Prefer newest Failed with non-null message
  let riyaFailed = null;
  for (const b of fails.slice(0, 15)) {
    if (!/hiltop|hilltop|keys|lemon|mumbai|pune/i.test(String(b.hotelName || '')) && fails.length > 5) continue;
    const st = await hotel.getBookingStatus(b.bookingId);
    if (!/fail/i.test(String(st.data?.status))) continue;
    if (st.data?.message) {
      const det = await hotel.getBookingDetail(b.bookingId);
      riyaFailed = {
        br: b.bookingId,
        hotelName: b.hotelName,
        statusRes: st,
        detailRes: det,
        statusSales: st.data?.salesSummary,
        detailSales: det.data?.salesSummary,
        statusMessage: st.data?.message,
        detailMessage: det.data?.message,
      };
      break;
    }
  }
  // Explicit known BR from earlier session if still Failed
  if (!riyaFailed) {
    for (const br of ['BR1786548715492896', 'BR1786549503438340']) {
      const st = await hotel.getBookingStatus(br);
      if (/fail/i.test(String(st.data?.status)) && st.data?.message) {
        const det = await hotel.getBookingDetail(br);
        riyaFailed = {
          br,
          hotelName: st.data?.hotelDetails?.name,
          statusRes: st,
          detailRes: det,
          statusSales: st.data?.salesSummary,
          detailSales: det.data?.salesSummary,
          statusMessage: st.data?.message,
          detailMessage: det.data?.message,
        };
        break;
      }
    }
  }
  if (riyaFailed) assertFailed('RIYA-Failed', riyaFailed);
  else add('RIYA-Failed', 'Obtain Failed with message', 'history', 'Failed + message', 'NOT TESTED', 'No Failed Riya with message found');

  // ─── RHK Taj Dubai: book Confirmed ───
  console.log('\n=== RHK Taj Dubai — book Confirmed ===');
  const used = new Set();
  const rhkConfirmed = await bookTaj({
    hotel,
    wantStatus: 'Confirmed',
    usedCodes: used,
    daysList: [30, 45, 60, 21, 90, 14],
  });
  if (rhkConfirmed) assertConfirmed('RHK-Confirmed', rhkConfirmed);
  else add('RHK-Confirmed', 'Obtain Confirmed', 'Book Taj Dubai RHK', 'Confirmed', 'NOT TESTED', 'Could not get Confirmed Taj Dubai');

  // ─── RHK Taj Dubai: book Failed (different room) ───
  console.log('\n=== RHK Taj Dubai — book Failed ===');
  const rhkFailed = await bookTaj({
    hotel,
    wantStatus: 'Failed',
    usedCodes: used,
    daysList: [7, 10, 14, 21, 30, 45],
  });
  if (rhkFailed) assertFailed('RHK-Failed', rhkFailed);
  else add('RHK-Failed', 'Obtain Failed', 'Book another Taj Dubai RHK rate', 'Failed + message', 'NOT TESTED', 'Could not get Failed Taj Dubai');

  const score = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    note: 'Riya Confirmed from history; RateHawk = Taj Dubai only (Confirmed + Failed fresh books)',
    score,
    evidence: {
      riyaConfirmed: riyaHist && { br: riyaHist.bookingId, hotel: riyaHist.hotelName },
      riyaFailed: riyaFailed && { br: riyaFailed.br, message: riyaFailed.detailMessage, sales: riyaFailed.detailSales },
      rhkConfirmed: rhkConfirmed && { br: rhkConfirmed.br, hotel: rhkConfirmed.hotelName, sales: rhkConfirmed.detailSales },
      rhkFailed: rhkFailed && { br: rhkFailed.br, message: rhkFailed.detailMessage, sales: rhkFailed.detailSales },
    },
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n========== REPORT ==========');
  console.log('Score', score);
  console.log('Evidence', JSON.stringify(report.evidence, null, 2));
  for (const r of rows) console.log(`| ${r.status} | ${r.section} | ${r.rule}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

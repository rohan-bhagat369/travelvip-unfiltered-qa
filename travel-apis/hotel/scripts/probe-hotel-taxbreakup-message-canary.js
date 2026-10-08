/**
 * Canary: hotel status + details — salesSummary.taxBreakup + provider message
 * Run: BASE_URL=https://canary-api.travelvip.ai node scripts/probe-hotel-taxbreakup-message-canary.js
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

const OUT = path.join('reports', 'hotel-taxbreakup-message-canary.json');
const rows = [];

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 500) {
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

function hasTaxBreakup(sales) {
  const tb = sales?.taxBreakup;
  if (!tb || typeof tb !== 'object') return { ok: false, reason: 'taxBreakup missing' };
  const hasGst = 'gst' in tb;
  const hasOther = 'otherTaxes' in tb;
  if (!hasGst || !hasOther) return { ok: false, reason: `keys gst=${hasGst} otherTaxes=${hasOther}` };
  if (typeof tb.gst !== 'number' || typeof tb.otherTaxes !== 'number') {
    return { ok: false, reason: `types gst=${typeof tb.gst} otherTaxes=${typeof tb.otherTaxes}` };
  }
  // tax should approx equal gst + otherTaxes when tax is present
  if (typeof sales.tax === 'number') {
    const sum = +(tb.gst + tb.otherTaxes).toFixed(2);
    const delta = Math.abs(sum - Number(sales.tax));
    if (delta > 0.05) {
      return {
        ok: false,
        reason: `gst+otherTaxes (${sum}) != tax (${sales.tax}) delta=${delta}`,
        taxBreakup: tb,
      };
    }
  }
  return { ok: true, taxBreakup: tb };
}

function pickMessage(data) {
  return data?.message
    ?? data?.providerMessage
    ?? data?.failureReason
    ?? data?.failedReason
    ?? data?.statusMessage
    ?? data?.error?.message
    ?? null;
}

async function waitTerminal(hotel, br, maxAttempts = 36) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (i === 0 || i % 3 === 0) console.log(`  poll ${i + 1}: ${st}`);
    if (last.ok && isTerminalHotelStatus(st)) return { status: st, response: last };
    await sleep(4000);
  }
  return { status: last?.data?.status, response: last, timedOut: true };
}

async function prepareAndBook(hotel, { forceFail = false } = {}) {
  const entityIds = ['39627872', '2869073', config.hotel.defaultEntityId];
  const days = forceFail ? [7, 10, 14] : [21, 28, 35, 14];

  for (const entityId of entityIds) {
    for (const checkinDays of days) {
      const searchBody = buildSearchBody({
        entityId,
        checkinDays,
        nights: 1,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      const search = await hotel.search(searchBody);
      if (!search.ok) continue;
      const details = await hotel.getDetails(searchBody);
      if (!details.ok) continue;
      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      let codes = extractBookingCodes(details.data, 10);
      const prefer = forceFail
        ? codes
        : [
          ...codes.filter((c) => String(c).includes('rh-test')),
          ...codes.filter((c) => !String(c).includes('rh-test')),
        ];
      if (!requestId || !prefer.length) continue;

      for (const bookingCode of prefer.slice(0, 5)) {
        const pre = await hotel.prebook({ bookingCode, requestId });
        if (!isPrebookSuccess(pre)) continue;
        const room =
          pre.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
          || details.data?.results?.[0]?.rooms?.find((r) => r.bookingCode === bookingCode)
          || null;

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
            email: `hotel.taxbreakup.${Date.now()}@travelvip.ai`,
            countryCode: '+91',
            mobile: config.hotel.contactMobile,
          },
        };
        if (room?.isPANMandatory) {
          body.contact.panCardNumber = 'ABCDE1234F';
          body.contact.panCardName = `${config.hotel.guestFirstName} ${config.hotel.guestLastName}`;
        }
        if (room?.isGSTClaimable) body.gstDetails = { ...VALID_GST };

        // Negative finalize attempt: corrupt guest name to try force fail? Better rely on vendor fail.
        if (forceFail) {
          // leave as normal — many canary rates fail at supplier; also try rh-test if present
        }

        const fin = await hotel.finalizeBooking(body);
        const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
        if (!fin.ok || !br) continue;
        const w = await waitTerminal(hotel, br);
        return {
          br,
          status: w.status,
          statusResponse: w.response,
          finalize: fin,
          hotelName: pre.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
          entityId,
          searchBody,
          bookingCode,
        };
      }
    }
  }
  return null;
}

function assertStatusDetailShape(section, label, statusRes, detailRes, bookingStatus) {
  const stData = statusRes?.data || {};
  const dData = detailRes?.data || {};
  const stSales = stData.salesSummary;
  const dSales = dData.salesSummary;
  const stMsg = pickMessage(stData);
  const dMsg = pickMessage(dData);

  // taxBreakup on details (primary) and status if present
  if (dSales) {
    const chk = hasTaxBreakup(dSales);
    add(
      section,
      `${label}: details salesSummary.taxBreakup`,
      'GET /hotels/bookings/{id}',
      'salesSummary.taxBreakup.{gst,otherTaxes} present; gst+other≈tax',
      chk.ok ? 'PASS' : 'BUG',
      chk.ok
        ? `gst=${chk.taxBreakup.gst} otherTaxes=${chk.taxBreakup.otherTaxes} tax=${dSales.tax} total=${dSales.totalAmount}`
        : chk.reason,
      { salesSummary: dSales, responseSnippet: brief(dData, 600) },
    );
  } else {
    add(
      section,
      `${label}: details salesSummary present`,
      'GET /hotels/bookings/{id}',
      'salesSummary object present',
      'BUG',
      'salesSummary missing on details',
      { responseSnippet: brief(dData, 400) },
    );
  }

  if (stSales) {
    const chk = hasTaxBreakup(stSales);
    add(
      section,
      `${label}: status salesSummary.taxBreakup`,
      'GET /hotels/bookings/{id}/status',
      'salesSummary.taxBreakup.{gst,otherTaxes} present when salesSummary sent',
      chk.ok ? 'PASS' : 'BUG',
      chk.ok
        ? `gst=${chk.taxBreakup.gst} otherTaxes=${chk.taxBreakup.otherTaxes} tax=${stSales.tax}`
        : chk.reason,
      { salesSummary: stSales, responseSnippet: brief(stData, 500) },
    );
  } else {
    add(
      section,
      `${label}: status salesSummary`,
      'GET /hotels/bookings/{id}/status',
      'salesSummary present on status (per new canary change)',
      'BUG',
      `salesSummary missing on status; keys=${Object.keys(stData).join(',')}`,
      { responseSnippet: brief(stData, 500) },
    );
  }

  // message key
  const failed = /fail/i.test(String(bookingStatus));
  if (failed) {
    const msgOk = typeof stMsg === 'string' && stMsg.trim().length > 0;
    const dMsgOk = typeof dMsg === 'string' && dMsg.trim().length > 0;
    add(
      section,
      `${label}: status message (failed reason)`,
      'GET status when Failed',
      'message key with provider failure reason',
      msgOk ? 'PASS' : 'BUG',
      msgOk ? `message=${JSON.stringify(stMsg).slice(0, 200)}` : `message missing/empty; keys=${Object.keys(stData).join(',')}`,
      { message: stMsg, responseSnippet: brief(stData, 500) },
    );
    add(
      section,
      `${label}: details message (failed reason)`,
      'GET details when Failed',
      'message key with provider failure reason',
      dMsgOk ? 'PASS' : 'BUG',
      dMsgOk ? `message=${JSON.stringify(dMsg).slice(0, 200)}` : `message missing/empty; keys=${Object.keys(dData).join(',')}`,
      { message: dMsg, responseSnippet: brief(dData, 500) },
    );
  } else {
    // Confirmed/Pending: message may be null/absent or success text — accept present string OR null/absent
    const stHasKey = Object.prototype.hasOwnProperty.call(stData, 'message');
    const dHasKey = Object.prototype.hasOwnProperty.call(dData, 'message');
    add(
      section,
      `${label}: status message key present`,
      'GET status Confirmed/Pending',
      'message key present (may be null/empty on success)',
      stHasKey ? 'PASS' : 'BUG',
      stHasKey ? `message=${JSON.stringify(stMsg)}` : `message key absent; keys=${Object.keys(stData).join(',')}`,
      { message: stMsg, responseSnippet: brief(stData, 400) },
    );
    add(
      section,
      `${label}: details message key present`,
      'GET details Confirmed/Pending',
      'message key present (may be null/empty on success)',
      dHasKey ? 'PASS' : 'BUG',
      dHasKey ? `message=${JSON.stringify(dMsg)}` : `message key absent; keys=${Object.keys(dData).join(',')}`,
      { message: dMsg, responseSnippet: brief(dData, 400) },
    );
  }

  return { stSales, dSales, stMsg, dMsg };
}

async function main() {
  console.log('Base:', config.baseUrl);
  if (!/canary/i.test(config.baseUrl)) {
    console.warn('WARN: BASE_URL is not canary — set BASE_URL=https://canary-api.travelvip.ai');
  }

  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  // ─── Negative: unknown / malformed ───
  console.log('\n=== Negative: invalid booking ids ===');
  {
    const unknown = `BR9${Date.now().toString().slice(-15)}`;
    const st = await hotel.getBookingStatus(unknown);
    const det = await hotel.getBookingDetail(unknown);
    add(
      'Negative',
      '1. Status unknown bookingId',
      `GET .../status ${unknown}`,
      'HTTP 404 + error.code (BOOKING_NOT_FOUND)',
      st.status === 404 && Boolean(st.data?.error?.code) ? 'PASS' : 'BUG',
      `HTTP ${st.status} code=${st.data?.error?.code || '-'}`,
      { responseSnippet: brief(st.data, 300) },
    );
    add(
      'Negative',
      '2. Details unknown bookingId',
      `GET .../bookings/${unknown}`,
      'HTTP 404 + error.code (BOOKING_NOT_FOUND)',
      det.status === 404 && Boolean(det.data?.error?.code) ? 'PASS' : 'BUG',
      `HTTP ${det.status} code=${det.data?.error?.code || '-'}`,
      { responseSnippet: brief(det.data, 300) },
    );
  }

  {
    const st = await hotel.getBookingStatus('!!bad!!');
    const det = await hotel.getBookingDetail('!!bad!!');
    add(
      'Negative',
      '3. Status malformed bookingId',
      'GET .../status !!bad!!',
      'HTTP 400 VALIDATION_ERROR envelope (or consistent error)',
      (st.status === 400 && st.data?.error?.code) || (st.status === 404 && st.data?.error?.code)
        ? 'PASS'
        : (st.status === 404 && st.data?.info ? 'BUG' : 'BUG'),
      `HTTP ${st.status} body=${brief(st.data, 160)}`,
      { responseSnippet: brief(st.data, 300) },
    );
    add(
      'Negative',
      '4. Details malformed bookingId',
      'GET .../bookings/!!bad!!',
      'HTTP 400 VALIDATION_ERROR envelope (or consistent error)',
      (det.status === 400 && det.data?.error?.code) || (det.status === 404 && det.data?.error?.code)
        ? 'PASS'
        : (det.status === 404 && det.data?.info ? 'BUG' : 'BUG'),
      `HTTP ${det.status} body=${brief(det.data, 160)}`,
      { responseSnippet: brief(det.data, 300) },
    );
  }

  // ─── History fallback for Confirmed / Failed ───
  console.log('\n=== History scan ===');
  const hist = await hotel.bookingHistory(0, 40);
  const bookings = hist.data?.bookings || [];
  const histConfirmed = bookings.find((b) => /confirm/i.test(String(b.status)));
  const histFailed = bookings.find((b) => /fail/i.test(String(b.status)));
  console.log('history', bookings.length, 'confirmed?', !!histConfirmed, 'failed?', !!histFailed);

  // ─── Positive: Confirmed ───
  console.log('\n=== Positive: Confirmed booking ===');
  let confirmed = null;
  if (histConfirmed?.bookingId) {
    confirmed = { br: histConfirmed.bookingId, status: histConfirmed.status, source: 'history' };
  } else {
    console.log('No history Confirmed — booking fresh...');
    const booked = await prepareAndBook(hotel, { forceFail: false });
    if (booked && /confirm/i.test(String(booked.status))) {
      confirmed = { br: booked.br, status: booked.status, source: 'fresh', hotelName: booked.hotelName };
    } else if (booked) {
      console.log('Fresh book ended as', booked.status, booked.br);
    }
  }

  if (confirmed) {
    const st = await hotel.getBookingStatus(confirmed.br);
    const det = await hotel.getBookingDetail(confirmed.br);
    console.log('Confirmed', confirmed.br, 'statusHTTP', st.status, 'detailHTTP', det.status);
    assertStatusDetailShape('Positive-Confirmed', 'Confirmed', st, det, confirmed.status || st.data?.status);

    // consistency: totals align
    const sTax = st.data?.salesSummary?.tax;
    const dTax = det.data?.salesSummary?.tax;
    if (typeof sTax === 'number' && typeof dTax === 'number') {
      add(
        'Positive-Confirmed',
        'Status vs Details tax consistency',
        'Compare salesSummary.tax',
        'Same tax on status and details',
        Math.abs(sTax - dTax) < 0.05 ? 'PASS' : 'BUG',
        `status.tax=${sTax} details.tax=${dTax}`,
      );
    }
  } else {
    add(
      'Positive-Confirmed',
      'Obtain Confirmed booking',
      'history or fresh book',
      'Confirmed BR available',
      'NOT TESTED',
      'No Confirmed hotel booking on canary',
    );
  }

  // ─── Negative/Failed: provider message ───
  console.log('\n=== Failed booking (provider message) ===');
  let failed = null;
  if (histFailed?.bookingId) {
    failed = { br: histFailed.bookingId, status: histFailed.status, source: 'history' };
  }

  // Also try fresh book — often fails on canary/riya
  console.log('Booking fresh to capture Failed + message...');
  const fresh = await prepareAndBook(hotel, { forceFail: true });
  if (fresh) {
    console.log('Fresh', fresh.br, fresh.status, fresh.hotelName);
    if (/fail/i.test(String(fresh.status))) {
      failed = { br: fresh.br, status: fresh.status, source: 'fresh', hotelName: fresh.hotelName };
    } else if (/confirm/i.test(String(fresh.status)) && !confirmed) {
      confirmed = { br: fresh.br, status: fresh.status, source: 'fresh', hotelName: fresh.hotelName };
      const st = await hotel.getBookingStatus(confirmed.br);
      const det = await hotel.getBookingDetail(confirmed.br);
      assertStatusDetailShape('Positive-Confirmed', 'Confirmed-fresh', st, det, confirmed.status);
    }
  }

  if (failed) {
    const st = await hotel.getBookingStatus(failed.br);
    const det = await hotel.getBookingDetail(failed.br);
    console.log('Failed', failed.br, 'statusHTTP', st.status, 'detailHTTP', det.status);
    console.log('status body', brief(st.data, 400));
    console.log('detail body', brief(det.data, 400));
    assertStatusDetailShape('Negative-Failed', 'Failed', st, det, 'Failed');

    // taxBreakup may still be present on failed (pricing known) — soft check
    if (det.data?.salesSummary && !det.data.salesSummary.taxBreakup) {
      add(
        'Negative-Failed',
        'Failed details may still include taxBreakup',
        'Inspect Failed details salesSummary',
        'Prefer taxBreakup when salesSummary present',
        'BUG',
        'salesSummary without taxBreakup on Failed details',
        { salesSummary: det.data.salesSummary },
      );
    }
  } else {
    add(
      'Negative-Failed',
      'Obtain Failed booking',
      'history or fresh book',
      'Failed BR with provider message',
      'NOT TESTED',
      'No Failed hotel booking available on canary',
    );
  }

  // If we got Confirmed from history but never ran fresh confirmed tax check after late book — already covered

  const score = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    confirmedBooking: confirmed,
    failedBooking: failed,
    score,
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n========== TAXBREAKUP / MESSAGE REPORT ==========');
  console.log('Score:', score);
  console.log('Report:', OUT);
  for (const r of rows) console.log(`| ${r.status} | ${r.section} | ${r.rule}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

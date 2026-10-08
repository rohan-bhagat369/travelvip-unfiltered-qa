/**
 * Canary: encrypted hotel bookingCode — no RIYA in details/prebook, still bookable E2E.
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/probe-hotel-encrypted-bookingcode-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
const OUT = path.join('reports', 'hotel-encrypted-bookingcode-canary.json');

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const SEEDED_PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };

const ENTITIES = [
  { id: '39627872', name: 'Hilltop Mumbai' },
  { id: '39604638', name: 'Treebo Diamond' },
  { id: '39626537', name: 'Vasantashram' },
  { id: '15599148', name: 'Haveli Pune' },
];
const DAYS = [28, 35, 21];

const VENDOR_RE = /\b(RIYA|RHK|RATEHAWK|RATE.?HAWK)\b/i;
const OLD_CODE_RE = /!TB!(RIYA|RHK)!TB!/i;

function walkHits(obj, pathStr = '', out = [], depth = 0) {
  if (obj == null || depth > 16 || out.length > 80) return out;
  if (typeof obj === 'string') {
    if (VENDOR_RE.test(obj) || OLD_CODE_RE.test(obj) || /riya/i.test(obj)) {
      out.push({
        path: pathStr || '(root)',
        value: obj.length > 220 ? `${obj.slice(0, 220)}…` : obj,
      });
    }
    return out;
  }
  if (typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.slice(0, 20).forEach((v, i) => walkHits(v, `${pathStr}[${i}]`, out, depth + 1));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'images' || k === 'image' || k === 'logo') continue;
    walkHits(v, pathStr ? `${pathStr}.${k}` : k, out, depth + 1);
  }
  return out;
}

function looksEncrypted(code) {
  const s = String(code || '');
  if (!s) return false;
  if (OLD_CODE_RE.test(s) || /!TB!/.test(s)) return false;
  if (/^[0-9]+!/.test(s)) return false;
  return s.length >= 24;
}

function roomCodes(data, limit = 8) {
  const rooms = data?.results?.[0]?.rooms || [];
  return rooms
    .filter((r) => r?.bookingCode)
    .slice(0, limit)
    .map((r) => ({
      bookingCode: r.bookingCode,
      encrypted: looksEncrypted(r.bookingCode),
      hasTbRiya: OLD_CODE_RE.test(String(r.bookingCode)),
      hasRiya: /riya/i.test(String(r.bookingCode)),
      amount: r.price?.totalAmount ?? null,
      title: r.title || r.roomType || null,
      isGSTClaimable: r.isGSTClaimable || r.isGstClaimable || false,
      isPANMandatory: r.isPANMandatory ?? null,
    }));
}

function payloadInfo(data) {
  const s = (() => { try { return JSON.stringify(data); } catch { return String(data); } })();
  return {
    keys: data && typeof data === 'object' ? Object.keys(data) : [typeof data],
    bytes: s.length,
    emptyEnvelope: Boolean(data && typeof data === 'object' && Object.keys(data).every((k) => k === '_meta')),
  };
}

function brief(d, n = 220) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

function add(rows, rule, how, expected, actual, status, extra = {}) {
  rows.push({ rule, how, expected, actual, status, ...extra });
  console.log(`  [${status}] ${rule} — ${actual}`);
}

async function waitTerminal(hotel, br, max = 40) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status poll ${i + 1}: ${st} message=${JSON.stringify(last.data?.message)}`);
    if (last.ok && isTerminalHotelStatus(st)) return last;
    await sleep(4000);
  }
  return last;
}

async function main() {
  clearSession();
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  const rows = [];
  const apiScans = [];
  let booked = null;
  const attempts = [];

  const auto = await hotel.autocomplete('hilltop mumbai', 1, 5);
  apiScans.push({
    api: 'GET /v1/hotels/autocomplete',
    http: auto.status,
    payload: payloadInfo(auto.data),
    vendorHits: walkHits(auto.data),
    requestHits: walkHits({ q: 'hilltop mumbai' }),
  });

  outer:
  for (const ent of ENTITIES) {
    for (const days of DAYS) {
      console.log(`\n=== ${ent.name} (${ent.id}) +${days}d ===`);
      const searchBody = buildSearchBody({
        entityId: ent.id,
        checkinDays: days,
        nights: 1,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      searchBody.type = 'HOTEL';
      searchBody.nationality = 'IN';

      const search = await hotel.search(searchBody);
      const searchHits = walkHits(search.data);
      apiScans.push({
        api: 'POST /v1/hotels/search',
        http: search.status,
        payload: payloadInfo(search.data),
        vendorHits: searchHits,
        requestHits: walkHits(searchBody),
        bookingCodes: roomCodes(search.data),
      });
      if (!search.ok) {
        attempts.push({ entityId: ent.id, days, step: 'search', status: search.status });
        continue;
      }

      const details = await hotel.getDetails(searchBody);
      const detailHits = walkHits(details.data);
      const codes = roomCodes(details.data, 12);
      const dInfo = payloadInfo(details.data);
      apiScans.push({
        api: 'POST /v1/hotels/details',
        http: details.status,
        hotelName: details.data?.results?.[0]?.name,
        payload: dInfo,
        vendorHits: detailHits,
        requestHits: walkHits(searchBody),
        bookingCodes: codes,
      });
      console.log(
        'details HTTP', details.status,
        'keys', dInfo.keys.join(','),
        'bytes', dInfo.bytes,
        'rooms', codes.length,
        'encrypted', codes.filter((c) => c.encrypted).length,
        'riyaInCode', codes.filter((c) => c.hasRiya || c.hasTbRiya).length,
      );

      if (!details.ok) {
        attempts.push({ entityId: ent.id, days, step: 'details', status: details.status });
        continue;
      }

      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      const rooms = (details.data?.results?.[0]?.rooms || [])
        .filter((r) => r.available !== false && r.bookingCode)
        .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
      if (!requestId || !rooms.length) continue;

      for (const room of rooms.slice(0, 2)) {
        console.log('prebook code', String(room.bookingCode).slice(0, 90), 'amt', room.price?.totalAmount);
        const preReq = { bookingCode: room.bookingCode, requestId };
        const pre = await hotel.prebook(preReq);
        const preHits = walkHits(pre.data);
        const preCodes = roomCodes(pre.data, 4);
        apiScans.push({
          api: 'POST /v1/hotels/prebook',
          http: pre.status,
          ok: isPrebookSuccess(pre),
          payload: payloadInfo(pre.data),
          vendorHits: preHits,
          requestHits: walkHits(preReq),
          bookingCodes: preCodes,
          requestBookingCode: room.bookingCode,
        });
        if (!isPrebookSuccess(pre)) {
          console.log('  prebook fail', brief(pre.data));
          continue;
        }

        const body = {
          bookingContext: extractBookingContext(pre.data),
          bookingCode: room.bookingCode,
          requestId,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          rooms: [{
            guests: [{
              title: 'Mr',
              firstName: 'Rohan',
              lastName: 'Bhagat',
              type: 'Adult',
              isLead: true,
            }],
          }],
          contact: {
            email: `hotel.enc.${Date.now()}@travelvip.ai`,
            countryCode: '+91',
            mobile: config.hotel.contactMobile,
            panCardNumber: SEEDED_PAN.panCardNumber,
            panCardName: SEEDED_PAN.panCardName,
          },
        };
        if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...VALID_GST };

        const fin = await hotel.finalizeBooking(body);
        const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
        const finHits = walkHits(fin.data);
        apiScans.push({
          api: 'POST /v1/hotels/finalize-booking',
          http: fin.status,
          br,
          payload: payloadInfo(fin.data),
          vendorHits: finHits,
          requestHits: walkHits(body),
        });
        console.log('finalize HTTP', fin.status, 'br', br, fin.data?.error?.code || '-');
        if (!fin.ok || !br) {
          console.log(' ', brief(fin.data, 240));
          attempts.push({
            entityId: ent.id, days, step: 'finalize', status: fin.status, error: fin.data?.error,
          });
          continue;
        }

        const stRes = await waitTerminal(hotel, br);
        const status = stRes?.data?.status;
        const stHits = walkHits(stRes.data);
        apiScans.push({
          api: `GET /v1/hotels/bookings/${br}/status`,
          http: stRes.status,
          status,
          payload: payloadInfo(stRes.data),
          vendorHits: stHits,
          requestHits: walkHits({ bookingRefId: br }),
        });
        attempts.push({ entityId: ent.id, days, br, status, message: stRes.data?.message });

        const det = await hotel.getBookingDetail(br);
        apiScans.push({
          api: `GET /v1/hotels/bookings/${br}`,
          http: det.status,
          status: det.data?.status,
          payload: payloadInfo(det.data),
          vendorHits: walkHits(det.data),
          requestHits: walkHits({ bookingRefId: br }),
        });

        if (/confirm/i.test(String(status))) {
          booked = {
            br,
            hotelName: details.data?.results?.[0]?.name,
            entityId: ent.id,
            checkin: searchBody.checkin,
            checkout: searchBody.checkout,
            amount: room.price?.totalAmount,
            status,
            confirmationNumber: det.data?.confirmationNumber || stRes.data?.confirmationNumber,
            detailsBookingCode: room.bookingCode,
            prebookBookingCode: pre.data?.results?.[0]?.rooms?.[0]?.bookingCode || null,
            detailsCodeEncrypted: looksEncrypted(room.bookingCode),
            prebookCodeEncrypted: looksEncrypted(pre.data?.results?.[0]?.rooms?.[0]?.bookingCode),
          };
          break outer;
        }
        console.log('not confirmed — next room/date');
      }
    }
  }

  const histBr = booked?.br;
  const hist = await hotel.bookingHistory(0, 10);
  apiScans.push({
    api: 'GET /v1/hotels/bookings/history',
    http: hist.status,
    payload: payloadInfo(hist.data),
    vendorHits: walkHits(hist.data),
  });
  if (histBr) {
    const pen = await hotel.penaltyCheck(histBr);
    apiScans.push({
      api: `GET /v1/hotels/bookings/${histBr}/penalty-check`,
      http: pen.status,
      payload: payloadInfo(pen.data),
      vendorHits: walkHits(pen.data),
      requestHits: walkHits({ bookingRefId: histBr }),
    });
  }

  const detailsScan = apiScans.filter((s) => s.api.includes('/details'));
  const prebookScan = apiScans.filter((s) => s.api.includes('/prebook'));
  const detailCodes = detailsScan.flatMap((s) => s.bookingCodes || []);
  const preCodes = prebookScan.flatMap((s) => s.bookingCodes || []);

  add(
    rows,
    '1. Details bookingCode encrypted (not entityId!TB!RIYA!TB!)',
    'POST /v1/hotels/details on Hilltop/Treebo',
    'bookingCode has no !TB!RIYA!TB! and does not contain RIYA',
    detailCodes.length
      ? `n=${detailCodes.length} encrypted=${detailCodes.filter((c) => c.encrypted).length} hasRiya=${detailCodes.filter((c) => c.hasRiya || c.hasTbRiya).length} sample=${String(detailCodes[0]?.bookingCode).slice(0, 80)}`
      : 'No details bookingCodes',
    detailCodes.length && detailCodes.every((c) => c.encrypted && !c.hasRiya && !c.hasTbRiya) ? 'PASS' : 'BUG',
  );
  add(
    rows,
    '2. Prebook bookingCode encrypted (no RIYA)',
    'POST /v1/hotels/prebook with details bookingCode',
    'prebook rooms[].bookingCode encrypted, no RIYA',
    preCodes.length
      ? `n=${preCodes.length} encrypted=${preCodes.filter((c) => c.encrypted).length} hasRiya=${preCodes.filter((c) => c.hasRiya || c.hasTbRiya).length} sample=${String(preCodes[0]?.bookingCode).slice(0, 80)}`
      : 'No prebook rooms / prebook failed',
    preCodes.length && preCodes.every((c) => c.encrypted && !c.hasRiya && !c.hasTbRiya) ? 'PASS' : 'BUG',
  );
  add(
    rows,
    '3. Encrypted bookingCode is bookable E2E',
    'prebook → finalize → poll status Confirmed',
    'HTTP 200 finalize + terminal Confirmed',
    booked
      ? `Confirmed ${booked.br} ${booked.hotelName} amt=${booked.amount} conf=${booked.confirmationNumber}`
      : `No Confirmed booking. attempts=${JSON.stringify(attempts.slice(-4))}`,
    booked ? 'PASS' : 'BUG',
  );

  const leakResponses = apiScans.filter((s) => (s.vendorHits || []).length);
  const leakRequests = apiScans.filter((s) => (s.requestHits || []).length);
  const searchScans = apiScans.filter((s) => s.api.includes('/search'));
  const emptyCatalog = [...searchScans, ...detailsScan].filter((s) => s.payload?.emptyEnvelope);

  add(
    rows,
    '4. No RIYA/RHK in any hotel API response',
    'Scan autocomplete/search/details/prebook/finalize/status/detail/history/penalty responses (skip image URLs)',
    'Zero matches for RIYA / RHK / RateHawk',
    leakResponses.length
      ? leakResponses.map((s) => `${s.api}: ${s.vendorHits.map((h) => `${h.path}=${h.value}`).join('; ')}`).join(' | ')
      : `Scanned ${apiScans.length} API responses — no RIYA/RHK hits`,
    leakResponses.length ? 'BUG' : 'PASS',
  );
  add(
    rows,
    '5. No RIYA/RHK in any hotel API request',
    'Scan search/details/prebook/finalize request bodies (bookingCode included)',
    'Zero matches for RIYA / !TB!RIYA!TB!',
    leakRequests.length
      ? leakRequests.map((s) => `${s.api}: ${s.requestHits.map((h) => `${h.path}=${String(h.value).slice(0, 80)}`).join('; ')}`).join(' | ')
      : `Scanned ${apiScans.filter((s) => s.requestHits).length} request bodies — no RIYA/RHK hits`,
    leakRequests.length ? 'BUG' : 'PASS',
  );
  add(
    rows,
    '6. Search/details still return hotel rooms after encryption deploy',
    'POST /v1/hotels/search and POST /v1/hotels/details must return results[].rooms, not empty {_meta} envelope',
    'HTTP 200 with hotel room bookingCodes',
    emptyCatalog.length
      ? `${emptyCatalog.length} empty {_meta}-only envelopes (e.g. details keys=${detailsScan[0]?.payload?.keys} bytes=${detailsScan[0]?.payload?.bytes})`
      : `Catalog payloads have results. details rooms n=${detailCodes.length}`,
    emptyCatalog.length || !detailCodes.length ? 'BUG' : 'PASS',
  );

  const score = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    score,
    rows,
    booked,
    attempts,
    apiScans,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n========== ENCRYPTED BOOKINGCODE CANARY ==========');
  console.log(JSON.stringify({ score, rows, booked }, null, 2));
  console.log('Report:', OUT);
  if (score.BUG) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

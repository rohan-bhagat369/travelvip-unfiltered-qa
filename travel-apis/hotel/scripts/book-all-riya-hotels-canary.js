/**
 * Book all 7 listed Riya hotels on canary. Check encrypted bookingCode (no RIYA).
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/book-all-riya-hotels-canary.js
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
const OUT = path.join('reports', 'book-all-riya-hotels-canary.json');
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const OLD_CODE_RE = /!TB!(RIYA|RHK)!TB!/i;
const ENTITIES = [
  { id: '39627872', name: 'Hilltop Hotel Mumbai' },
  { id: '39604638', name: 'Treebo Diamond Residency - DDPK Inn' },
  { id: '39626537', name: 'New Vasantashram Boarding & Lodging' },
  { id: '15599148', name: 'Hotel Haveli, Pune' },
  { id: '39613471', name: 'Hotel Indie Stays, Mumbai' },
  { id: '32923366', name: 'Tanvi Guest House, Mumbai' },
  { id: '16320317', name: 'Hotel National Residency, Mumbai' },
];
const DAYS = [28, 21, 35];

function looksEncrypted(code) {
  const s = String(code || '');
  if (!s) return false;
  if (OLD_CODE_RE.test(s) || /!TB!/.test(s) || /riya/i.test(s)) return false;
  if (/^[0-9]+!/.test(s)) return false;
  return s.length >= 24;
}

function codeScan(code) {
  const s = String(code || '');
  return {
    sample: s.length > 72 ? `${s.slice(0, 72)}…` : s,
    encrypted: looksEncrypted(s),
    hasRiya: /riya/i.test(s) || OLD_CODE_RE.test(s) || /!TB!/.test(s),
  };
}

function brief(d, n = 200) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

async function waitTerminal(hotel, br, max = 30) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status ${i + 1}: ${st}`);
    if (last.ok && isTerminalHotelStatus(st)) return last;
    await sleep(3500);
  }
  return last;
}

async function bookOne(hotel, ent) {
  for (const days of DAYS) {
    const searchBody = buildSearchBody({
      entityId: ent.id,
      checkinDays: days,
      nights: 1,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    searchBody.type = 'HOTEL';
    searchBody.nationality = 'IN';

    await hotel.search(searchBody);
    const details = await hotel.getDetails(searchBody);
    const result = details.data?.results?.[0];
    const rooms = (result?.rooms || [])
      .filter((r) => r?.bookingCode && r.available !== false)
      .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
    if (!details.ok || !rooms.length) {
      console.log(`${ent.name} +${days}d no rooms details=${details.status}`);
      continue;
    }

    const room = rooms[0];
    const allCodes = rooms.map((r) => r.bookingCode);
    const detailsScan = codeScan(room.bookingCode);
    const allEncrypted = allCodes.every((c) => looksEncrypted(c));
    const anyRiya = allCodes.some((c) => /riya/i.test(String(c)) || OLD_CODE_RE.test(String(c)));
    const requestId = extractRequestId(details.data);
    if (!requestId) continue;

    const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    const preCode = pre.data?.results?.[0]?.rooms?.[0]?.bookingCode || room.bookingCode;
    const preScan = codeScan(preCode);
    if (!isPrebookSuccess(pre)) {
      console.log(`${ent.name} prebook fail`, brief(pre.data));
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
        email: `hotel.canary.${ent.id}.${Date.now()}@travelvip.ai`,
        countryCode: '+91',
        mobile: config.hotel.contactMobile,
        panCardNumber: PAN.panCardNumber,
        panCardName: PAN.panCardName,
      },
    };
    if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

    console.log(`finalize ${ent.name} amt=${room.price?.totalAmount} enc=${detailsScan.encrypted} riya=${detailsScan.hasRiya}`);
    const fin = await hotel.finalizeBooking(body);
    const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
    if (!fin.ok || !br) {
      return {
        entityId: ent.id,
        hotel: result?.name || ent.name,
        rooms: rooms.length,
        pan: rooms.every((r) => r.isPANMandatory === true),
        detailsCode: detailsScan,
        prebookCode: preScan,
        allEncrypted,
        anyRiya,
        amount: room.price?.totalAmount,
        br: null,
        bookStatus: `finalize ${fin.status} ${brief(fin.data)}`,
        confirmationNumber: null,
        status: (!allEncrypted || anyRiya || detailsScan.hasRiya || preScan.hasRiya) ? 'BUG' : 'BUG',
      };
    }

    const st = await waitTerminal(hotel, br);
    const bookStatus = String(st?.data?.status || '');
    const det = await hotel.getBookingDetail(br);
    const encryptPass = allEncrypted && !anyRiya && detailsScan.encrypted && !detailsScan.hasRiya && preScan.encrypted && !preScan.hasRiya;
    const confirmed = /confirm/i.test(bookStatus);
    return {
      entityId: ent.id,
      hotel: result?.name || ent.name,
      rooms: rooms.length,
      pan: rooms.every((r) => r.isPANMandatory === true),
      detailsCode: detailsScan,
      prebookCode: preScan,
      allEncrypted,
      anyRiya,
      amount: room.price?.totalAmount,
      checkin: searchBody.checkin,
      br,
      bookStatus,
      confirmationNumber: det.data?.confirmationNumber || st.data?.confirmationNumber || null,
      status: encryptPass && confirmed ? 'PASS' : 'BUG',
    };
  }
  return {
    entityId: ent.id,
    hotel: ent.name,
    rooms: 0,
    pan: null,
    detailsCode: { sample: '', encrypted: false, hasRiya: false },
    prebookCode: { sample: '', encrypted: false, hasRiya: false },
    br: null,
    bookStatus: 'No rooms / prebook failed',
    confirmationNumber: null,
    status: 'BUG',
  };
}

async function main() {
  clearSession();
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  const rows = [];
  for (const ent of ENTITIES) {
    console.log(`\n=== ${ent.name} (${ent.id}) ===`);
    const row = await bookOne(hotel, ent);
    rows.push(row);
    console.log(`[${row.status}] ${row.hotel} br=${row.br} ${row.bookStatus} enc=${row.detailsCode?.encrypted} riya=${row.detailsCode?.hasRiya}`);
  }

  const table = rows.map((r, i) => ({
    n: i + 1,
    entityId: r.entityId,
    hotel: r.hotel,
    rooms: r.rooms,
    pan: r.pan,
    bookingCode: r.detailsCode?.sample,
    encrypted: r.detailsCode?.encrypted && r.prebookCode?.encrypted,
    hasRiya: r.detailsCode?.hasRiya || r.prebookCode?.hasRiya,
    br: r.br,
    confirmationNumber: r.confirmationNumber,
    bookStatus: r.bookStatus,
    amount: r.amount,
    status: r.status,
  }));
  const score = {
    PASS: table.filter((r) => r.status === 'PASS').length,
    BUG: table.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: 0,
  };
  fs.writeFileSync(OUT, JSON.stringify({ baseUrl: config.baseUrl, at: new Date().toISOString(), score, table, rows }, null, 2));
  console.log('\n========== BOOK ALL CANARY ==========');
  console.log(JSON.stringify({ score, table }, null, 2));
  console.log('Report:', OUT);
  if (score.BUG) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

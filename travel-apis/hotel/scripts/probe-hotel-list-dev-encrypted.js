/**
 * Dev/staging: listed Riya hotels — details/prebook bookingCode (encrypted? RIYA?) + one E2E book.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/probe-hotel-list-dev-encrypted.js
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

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join(
  'reports',
  String(process.env.BASE_URL || '').includes('canary')
    ? 'hotel-list-canary-encrypted.json'
    : 'hotel-list-dev-encrypted.json',
);

const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const SEEDED_PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };

const ENTITIES = [
  { id: '39627872', name: 'Hilltop Hotel Mumbai' },
  { id: '39604638', name: 'Treebo Diamond Residency' },
  { id: '39626537', name: 'New Vasantashram Boarding & Lodging, Mumbai' },
  { id: '15599148', name: 'Hotel Haveli, Pune' },
  { id: '39613471', name: 'Hotel Indie Stays, Mumbai' },
  { id: '32923366', name: 'Tanvi Guest House, Mumbai' },
  { id: '16320317', name: 'Hotel National Residency, Mumbai' },
];
const DAYS = [28, 21, 35];
const OLD_CODE_RE = /!TB!(RIYA|RHK)!TB!/i;

function looksEncrypted(code) {
  const s = String(code || '');
  if (!s) return false;
  if (OLD_CODE_RE.test(s) || /!TB!/.test(s)) return false;
  if (/^[0-9]+!/.test(s)) return false;
  return s.length >= 24;
}

function slimCode(code) {
  const s = String(code || '');
  return {
    bookingCode: s.length > 100 ? `${s.slice(0, 100)}…` : s,
    encrypted: looksEncrypted(s),
    hasTbRiya: OLD_CODE_RE.test(s),
    hasRiya: /riya/i.test(s),
    hasTb: /!TB!/.test(s),
  };
}

function brief(d, n = 240) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}

async function waitTerminal(hotel, br, max = 36) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log(`  status poll ${i + 1}: ${st}`);
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
  const hotels = [];
  let booked = null;

  for (const ent of ENTITIES) {
    let picked = null;
    for (const days of DAYS) {
      const searchBody = buildSearchBody({
        entityId: ent.id,
        checkinDays: days,
        nights: 1,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      searchBody.type = 'HOTEL';
      searchBody.nationality = 'IN';

      const search = await hotel.search(searchBody);
      const details = await hotel.getDetails(searchBody);
      const info = {
        bytes: JSON.stringify(details.data || {}).length,
        keys: details.data && typeof details.data === 'object' ? Object.keys(details.data) : [],
        emptyEnvelope: Boolean(details.data && Object.keys(details.data).every((k) => k === '_meta')),
      };
      const result = details.data?.results?.[0];
      const rooms = (result?.rooms || []).filter((r) => r?.bookingCode);
      const samples = rooms.slice(0, 3).map((r) => ({
        ...slimCode(r.bookingCode),
        title: r.title || r.roomType || null,
        amount: r.price?.totalAmount ?? null,
        isPANMandatory: r.isPANMandatory ?? null,
        isGSTClaimable: r.isGSTClaimable ?? r.isGstClaimable ?? null,
      }));
      console.log(
        `${ent.name} +${days}d search=${search.status} details=${details.status} bytes=${info.bytes} rooms=${rooms.length} name=${result?.name || '-'} riya=${samples.filter((s) => s.hasRiya || s.hasTbRiya).length} enc=${samples.filter((s) => s.encrypted).length}`,
      );

      if (!picked) {
        picked = {
          entityId: ent.id,
          askedName: ent.name,
          days,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          searchHttp: search.status,
          searchRooms: (search.data?.results?.[0]?.rooms || []).length,
          detailsHttp: details.status,
          detailsPayload: info,
          hotelName: result?.name || null,
          rooms: rooms.length,
          panRooms: rooms.filter((r) => r.isPANMandatory === true).length,
          gstRooms: rooms.filter((r) => r.isGSTClaimable || r.isGstClaimable).length,
          samples,
          allCodesEncrypted: rooms.length > 0 && rooms.every((r) => looksEncrypted(r.bookingCode)),
          anyRiyaInCode: rooms.some((r) => /riya/i.test(String(r.bookingCode)) || OLD_CODE_RE.test(String(r.bookingCode))),
        };
      }

      if (rooms.length && (!picked.rooms || picked.rooms === 0 || !picked._room)) {
        const room = [...rooms].sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12))[0];
        const requestId = extractRequestId(details.data) || extractRequestId(search.data);
        const pre = requestId
          ? await hotel.prebook({ bookingCode: room.bookingCode, requestId })
          : { ok: false, status: 0, data: { error: 'no requestId' } };
        const preRoom = pre.data?.results?.[0]?.rooms?.[0];
        picked = {
          ...picked,
          days,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          hotelName: result?.name || picked.hotelName,
          rooms: rooms.length,
          panRooms: rooms.filter((r) => r.isPANMandatory === true).length,
          samples,
          allCodesEncrypted: rooms.every((r) => looksEncrypted(r.bookingCode)),
          anyRiyaInCode: rooms.some((r) => /riya/i.test(String(r.bookingCode)) || OLD_CODE_RE.test(String(r.bookingCode))),
          requestId,
          _room: room,
          _searchBody: searchBody,
          _pre: pre,
          prebookHttp: pre.status,
          prebookOk: isPrebookSuccess(pre),
          prebookCode: slimCode(preRoom?.bookingCode || ''),
          detailsCode: slimCode(room.bookingCode),
        };
        if (rooms.length) break;
      }
    }
    delete picked?._searchBody;
    hotels.push(picked);
  }

  const bookable = hotels.find((h) => h.prebookOk && h._room && h.requestId && h.allCodesEncrypted && !h.anyRiyaInCode);
  if (bookable) {
    const room = bookable._room;
    const searchBody = {
      checkin: bookable.checkin,
      checkout: bookable.checkout,
    };
    const body = {
      bookingContext: extractBookingContext(bookable._pre.data),
      bookingCode: room.bookingCode,
      requestId: bookable.requestId,
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
        email: `hotel.devenc.${Date.now()}@travelvip.ai`,
        countryCode: '+91',
        mobile: config.hotel.contactMobile,
        panCardNumber: SEEDED_PAN.panCardNumber,
        panCardName: SEEDED_PAN.panCardName,
      },
    };
    if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...VALID_GST };

    console.log('\nE2E book', bookable.askedName, 'code', String(room.bookingCode).slice(0, 90));
    const fin = await hotel.finalizeBooking(body);
    const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
    console.log('finalize', fin.status, br, brief(fin.data, 180));
    let status = null;
    let conf = null;
    if (fin.ok && br) {
      const st = await waitTerminal(hotel, br);
      status = st.data?.status;
      const det = await hotel.getBookingDetail(br);
      conf = det.data?.confirmationNumber || st.data?.confirmationNumber;
      booked = {
        br,
        hotelName: bookable.hotelName,
        entityId: bookable.entityId,
        status,
        confirmationNumber: conf,
        amount: room.price?.totalAmount,
        detailsBookingCode: slimCode(room.bookingCode),
        prebookBookingCode: bookable.prebookCode,
      };
    } else {
      booked = { error: fin.data?.error || brief(fin.data), http: fin.status };
    }
  }

  for (const h of hotels) {
    delete h._room;
    delete h._pre;
  }

  const rows = hotels.map((h, i) => {
    const sample = h.samples?.[0];
    let status = 'BUG';
    let actual = '';
    if (!h.rooms) {
      actual = `No rooms. details HTTP ${h.detailsHttp} keys=${h.detailsPayload?.keys} bytes=${h.detailsPayload?.bytes}`;
      status = h.detailsPayload?.emptyEnvelope ? 'BUG' : 'NOT TESTED';
    } else if (h.anyRiyaInCode || sample?.hasTbRiya) {
      actual = `PLAINTEXT RIYA in bookingCode sample=${sample?.bookingCode}`;
      status = 'BUG';
    } else if (h.allCodesEncrypted) {
      actual = `encrypted n=${h.rooms} sample=${sample?.bookingCode} PAN=${h.panRooms}/${h.rooms} prebook=${h.prebookOk}`;
      status = 'PASS';
    } else {
      actual = `rooms=${h.rooms} but code not encrypted sample=${sample?.bookingCode}`;
      status = 'BUG';
    }
    return {
      rule: `${i + 1}. ${h.askedName} (${h.entityId}) bookingCode no RIYA / encrypted`,
      how: `POST /v1/hotels/details + prebook +${h.days}d`,
      expected: 'bookingCode encrypted, no RIYA, rooms returned',
      actual,
      status,
    };
  });

  rows.push({
    rule: `${hotels.length + 1}. Encrypted bookingCode E2E book on dest`,
    how: 'prebook → finalize → Confirmed on first hotel that prebooked',
    expected: 'Confirmed booking using details bookingCode (no RIYA in code)',
    actual: booked?.br
      ? `${booked.status} ${booked.br} ${booked.hotelName} conf=${booked.confirmationNumber} codeRiya=${booked.detailsBookingCode?.hasRiya} encrypted=${booked.detailsBookingCode?.encrypted}`
      : `No Confirmed booking ${JSON.stringify(booked) || '-'}`,
    status: booked?.br && /confirm/i.test(String(booked.status)) && !booked.detailsBookingCode?.hasRiya
      ? 'PASS'
      : (booked?.br ? 'BUG' : 'BUG'),
  });

  const score = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = { baseUrl: config.baseUrl, at: new Date().toISOString(), score, rows, hotels, booked };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n========== HOTEL LIST DEV ==========');
  console.log(JSON.stringify({ score, rows, booked }, null, 2));
  console.log('Report:', OUT);
  if (score.BUG) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

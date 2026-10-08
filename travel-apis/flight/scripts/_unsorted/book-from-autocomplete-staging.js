/**
 * Staging: start at autocomplete, take entityId from the suggestion, then
 * search → details → prebook → finalize. Detect if encrypted bookingCode breaks the flow.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/book-from-autocomplete-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { HotelService } from '../../../hotel/src/service.js';
import {
  buildSearchBody,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../../../hotel/src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const OLD_CODE_RE = /!TB!(RIYA|RHK)!TB!/i;
const DAYS = [28, 21, 35];

/** How to find each hotel in autocomplete (page=0). pick() chooses the hit. */
const TARGETS = [
  {
    label: 'Hilltop Hotel Mumbai',
    q: 'hiltop',
    pick: (hits) => hits.find((h) => /hiltop hotel/i.test(h.title) && /mumbai/i.test(h.city || '')),
  },
  {
    label: 'Treebo Diamond Residency - DDPK Inn',
    q: 'treebo diamond',
    pick: (hits) => hits.find((h) => /treebo diamond residency/i.test(h.title)),
  },
  {
    label: 'New Vasantashram Boarding & Lodging',
    q: 'vasantashram',
    pick: (hits) => hits.find((h) => /vasantashram/i.test(h.title)),
  },
  {
    label: 'Hotel Haveli, Pune',
    q: 'hotel haveli',
    pick: (hits) => hits.find((h) => /^hotel haveli$/i.test(h.title) && /pune/i.test(h.city || '')),
  },
  {
    label: 'Hotel Indie Stays, Mumbai',
    q: 'indie stays',
    pick: (hits) => hits.find((h) => /^indie stays$/i.test(h.title) && /mumbai/i.test(h.city || '')),
  },
  {
    label: 'Tanvi Guest House, Mumbai',
    q: 'tanvi guest',
    pick: (hits) => hits.find((h) => /^tanvi guest house$/i.test(h.title) && /mumbai/i.test(h.city || '')),
  },
  {
    label: 'Hotel National Residency, Mumbai',
    q: 'national residency',
    pick: (hits) => hits.find((h) => /hotel national residency/i.test(h.title) && /mumbai/i.test(h.city || '')),
  },
];

const BOOK_LIMIT = Math.max(1, Number(process.env.BOOK_LIMIT || TARGETS.length));
const OUT = path.join(
  'reports',
  process.env.BOOK_OUT
    || (process.env.BOOK_LIMIT === '1' ? 'book-one-hotel-staging.json' : 'book-from-autocomplete-staging.json'),
);

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
    sample: s.length > 80 ? `${s.slice(0, 80)}…` : s,
    encrypted: looksEncrypted(s),
    hasRiya: /riya/i.test(s) || OLD_CODE_RE.test(s) || /!TB!/.test(s),
  };
}
function brief(d, n = 220) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function slimHit(x) {
  return {
    entityId: x.entityId,
    title: x.title,
    type: x.type,
    city: x.city,
    country: x.country,
  };
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

async function bookFromAuto(hotel, target) {
  const auto = await hotel.autocomplete(target.q, 0, 20);
  const content = Array.isArray(auto.data?.content) ? auto.data.content : [];
  const hotels = content.filter((x) => String(x.type || '').toUpperCase() === 'HOTEL');
  const picked = target.pick(hotels) || null;
  const autoScan = {
    q: target.q,
    page: 0,
    http: auto.status,
    total: content.length,
    hotelHits: hotels.length,
    picked: picked ? slimHit(picked) : null,
    alternatives: hotels.slice(0, 6).map(slimHit),
    riyaInAuto: /riya/i.test(JSON.stringify(content.filter((x) => x !== content.images))),
  };
  console.log(`  autocomplete q="${target.q}" http=${auto.status} n=${content.length} picked=${picked?.entityId || 'NONE'} title=${picked?.title || '-'}`);

  if (!auto.ok || !picked?.entityId) {
    return {
      label: target.label,
      step: 'autocomplete',
      autocomplete: autoScan,
      status: 'BUG',
      bookStatus: 'Autocomplete did not return this hotel (page=0 HOTEL hit)',
      encryptPass: false,
    };
  }

  const entityId = String(picked.entityId);

  for (const days of DAYS) {
    const searchBody = buildSearchBody({
      entityId,
      checkinDays: days,
      nights: 1,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    searchBody.type = 'HOTEL';
    searchBody.nationality = 'IN';

    const search = await hotel.search(searchBody);
    const details = await hotel.getDetails(searchBody);
    const result = details.data?.results?.[0];
    const rooms = (result?.rooms || [])
      .filter((r) => r?.bookingCode && r.available !== false)
      .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
    console.log(`  search=${search.status} details=${details.status} entityId=${entityId} +${days}d rooms=${rooms.length} name=${result?.name || '-'}`);

    if (!details.ok || !rooms.length) {
      if (days === DAYS[DAYS.length - 1]) {
        return {
          label: target.label,
          autocomplete: autoScan,
          entityIdFromAuto: entityId,
          searchHttp: search.status,
          detailsHttp: details.status,
          detailsBrief: brief(details.data),
          step: 'details',
          status: 'BUG',
          bookStatus: `No rooms with autocomplete entityId=${entityId}`,
          encryptPass: false,
        };
      }
      continue;
    }

    const room = rooms[0];
    const detailsScan = codeScan(room.bookingCode);
    const allEncrypted = rooms.every((r) => looksEncrypted(r.bookingCode));
    const anyRiya = rooms.some((r) => /riya/i.test(String(r.bookingCode)) || OLD_CODE_RE.test(String(r.bookingCode)));
    const requestId = extractRequestId(details.data);
    if (!requestId) continue;

    const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    const preScan = codeScan(pre.data?.results?.[0]?.rooms?.[0]?.bookingCode || room.bookingCode);
    if (!isPrebookSuccess(pre)) {
      return {
        label: target.label,
        autocomplete: autoScan,
        entityIdFromAuto: entityId,
        detailsCode: detailsScan,
        step: 'prebook',
        status: 'BUG',
        bookStatus: `prebook fail ${brief(pre.data)}`,
        encryptPass: false,
        encrypted: detailsScan.encrypted,
        hasRiya: detailsScan.hasRiya,
      };
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
        email: `hotel.auto.${Date.now()}@travelvip.ai`,
        countryCode: '+91',
        mobile: config.hotel.contactMobile,
        panCardNumber: PAN.panCardNumber,
        panCardName: PAN.panCardName,
      },
    };
    if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

    console.log(`  finalize codeEnc=${detailsScan.encrypted} riya=${detailsScan.hasRiya} amt=${room.price?.totalAmount}`);
    const fin = await hotel.finalizeBooking(body);
    const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
    const encryptPass = allEncrypted && !anyRiya && detailsScan.encrypted && !detailsScan.hasRiya && preScan.encrypted && !preScan.hasRiya;

    if (!fin.ok || !br) {
      return {
        label: target.label,
        autocomplete: autoScan,
        entityIdFromAuto: entityId,
        detailsCode: detailsScan,
        prebookCode: preScan,
        encryptPass,
        step: 'finalize',
        status: 'BUG',
        bookStatus: `finalize ${fin.status} ${brief(fin.data)}`,
        hasRiya: detailsScan.hasRiya || preScan.hasRiya,
        encrypted: encryptPass,
      };
    }

    const st = await waitTerminal(hotel, br);
    const bookStatus = String(st?.data?.status || '');
    const det = await hotel.getBookingDetail(br);
    const confirmed = /confirm/i.test(bookStatus);
    return {
      label: target.label,
      autocomplete: autoScan,
      entityIdFromAuto: entityId,
      hotel: result?.name,
      rooms: rooms.length,
      pan: rooms.every((r) => r.isPANMandatory === true),
      detailsCode: detailsScan,
      prebookCode: preScan,
      encryptPass,
      amount: room.price?.totalAmount,
      checkin: searchBody.checkin,
      br,
      confirmationNumber: det.data?.confirmationNumber || st.data?.confirmationNumber,
      bookStatus,
      step: 'confirmed',
      hasRiya: detailsScan.hasRiya || preScan.hasRiya,
      encrypted: encryptPass,
      status: encryptPass && confirmed ? 'PASS' : 'BUG',
    };
  }

  return {
    label: target.label,
    autocomplete: autoScan,
    entityIdFromAuto: entityId,
    status: 'BUG',
    bookStatus: 'Flow started from autocomplete entityId but no bookable room',
  };
}

async function main() {
  clearSession();
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);
  const rows = [];
  for (const t of TARGETS.slice(0, BOOK_LIMIT)) {
    console.log(`\n=== ${t.label} ===`);
    const row = await bookFromAuto(hotel, t);
    rows.push(row);
    console.log(`[${row.status}] entityId=${row.entityIdFromAuto || '-'} br=${row.br || '-'} ${row.bookStatus} enc=${row.encryptPass} riya=${row.hasRiya}`);
  }

  const table = rows.map((r, i) => ({
    n: i + 1,
    hotelAsked: r.label,
    autocompleteQ: r.autocomplete?.q,
    entityIdFromAuto: r.entityIdFromAuto || r.autocomplete?.picked?.entityId || null,
    autoTitle: r.autocomplete?.picked?.title || null,
    hotelBooked: r.hotel || null,
    rooms: r.rooms ?? 0,
    bookingCode: r.detailsCode?.sample || null,
    encrypted: r.encryptPass || false,
    hasRiya: r.hasRiya || false,
    br: r.br || null,
    confirmationNumber: r.confirmationNumber || null,
    bookStatus: r.bookStatus || r.step,
    status: r.status,
  }));
  const score = {
    PASS: table.filter((x) => x.status === 'PASS').length,
    BUG: table.filter((x) => x.status === 'BUG').length,
    NOT_TESTED: table.filter((x) => x.status === 'NOT TESTED').length,
  };
  fs.writeFileSync(OUT, JSON.stringify({
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    note: 'entityId taken only from GET /v1/hotels/autocomplete (page=0). search/details/prebook/finalize use that id as-is (includes :IN).',
    score,
    table,
    rows,
  }, null, 2));
  console.log('\n========== AUTOCOMPLETE → BOOK STAGING ==========');
  console.log(JSON.stringify({ score, table }, null, 2));
  console.log('Report:', OUT);
  if (score.BUG) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

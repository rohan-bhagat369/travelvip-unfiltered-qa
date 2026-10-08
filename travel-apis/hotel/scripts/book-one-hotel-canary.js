/**
 * Book one hotel on canary and leave it Confirmed (no cancel).
 *
 *   $env:BASE_URL='https://canary-api.travelvip.ai'; node scripts/book-one-hotel-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
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

const OUT = path.join(
  'reports',
  String(process.env.BASE_URL || '').includes('staging')
    ? 'book-one-hotel-staging.json'
    : 'book-one-hotel-canary.json',
);
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

const ENTITIES = [
  { id: '39627872', name: 'Hilltop Mumbai' },
  { id: '39604638', name: 'Treebo Diamond' },
];
const DAYS = [28, 35, 21];
const SEEDED_PAN = {
  panCardNumber: 'EUIPB1672M',
  panCardName: 'Rohan Bhagat',
};

function brief(d, n = 240) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

async function waitTerminal(hotel, br, max = 36) {
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
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  console.log('Base:', config.baseUrl);
  const { client } = await authenticate(true);
  const hotel = new HotelService(client);

  let booked = null;
  const attempts = [];

  outer:
  for (const ent of ENTITIES) {
    for (const days of DAYS) {
      console.log(`\n=== ${ent.name} (${ent.id}) +${days}d 1ADT ===`);
      const searchBody = buildSearchBody({
        entityId: ent.id,
        checkinDays: days,
        nights: 1,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      searchBody.type = 'HOTEL';

      const search = await hotel.search(searchBody);
      if (!search.ok) {
        console.log('search fail', search.status, brief(search.data));
        attempts.push({ entityId: ent.id, days, step: 'search', status: search.status });
        continue;
      }
      const details = await hotel.getDetails(searchBody);
      if (!details.ok) {
        console.log('details fail', details.status);
        attempts.push({ entityId: ent.id, days, step: 'details', status: details.status });
        continue;
      }

      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      const hotelName = details.data?.results?.[0]?.name || ent.name;
      const rooms = (details.data?.results?.[0]?.rooms || [])
        .filter((r) => r.available !== false && r.bookingCode)
        .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
      console.log('hotel', hotelName, 'rooms', rooms.length, 'checkin', searchBody.checkin);
      if (!requestId || !rooms.length) {
        attempts.push({ entityId: ent.id, days, step: 'rooms', rooms: 0 });
        continue;
      }

      for (const room of rooms.slice(0, 2)) {
        console.log('prebook', String(room.bookingCode).slice(0, 80), 'amt', room.price?.totalAmount);
        const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
        if (!isPrebookSuccess(pre)) {
          console.log('  prebook fail', brief(pre.data, 160));
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
              firstName: config.hotel.guestFirstName,
              lastName: config.hotel.guestLastName,
              type: 'Adult',
              isLead: true,
            }],
          }],
          contact: {
            email: `hotel.canary.book.${Date.now()}@travelvip.ai`,
            countryCode: '+91',
            mobile: config.hotel.contactMobile,
            panCardNumber: SEEDED_PAN.panCardNumber,
            panCardName: SEEDED_PAN.panCardName,
          },
        };
        if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...VALID_GST };

        const fin = await hotel.finalizeBooking(body);
        const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
        console.log('finalize HTTP', fin.status, 'br', br, fin.data?.error?.code || '-');
        if (!fin.ok || !br) {
          console.log(' ', brief(fin.data, 200));
          continue;
        }

        const stRes = await waitTerminal(hotel, br);
        const status = stRes?.data?.status;
        console.log('terminal', status);
        attempts.push({
          entityId: ent.id,
          hotelName,
          days,
          br,
          status,
          message: stRes?.data?.message,
        });

        if (/confirm/i.test(String(status))) {
          const detail = await hotel.getBookingDetail(br);
          booked = {
            br,
            hotelName,
            entityId: ent.id,
            checkin: searchBody.checkin,
            checkout: searchBody.checkout,
            amount: room.price?.totalAmount,
            status,
            confirmationNumber: detail.data?.confirmationNumber || stRes.data?.confirmationNumber,
            salesSummary: detail.data?.salesSummary || stRes.data?.salesSummary,
            supplier: String(room.bookingCode || '').split('!TB!')[1] || null,
          };
          break outer;
        }
        console.log('not confirmed — try next room/date');
      }
    }
  }

  const report = {
    ok: Boolean(booked),
    baseUrl: config.baseUrl,
    at: new Date().toISOString(),
    booked,
    attempts,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (!booked) {
    console.error('\nFAILED: no Confirmed hotel booking');
    process.exit(1);
  }

  console.log('\n=== HOTEL BOOKED ===');
  console.log(JSON.stringify(booked, null, 2));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

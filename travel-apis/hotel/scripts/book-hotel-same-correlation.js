/**
 * Hotel book flow. Every call uses the same X-Correlation-ID.
 *
 *   BASE_URL=https://canary-api.travelvip.ai CORRELATION_ID=f7892c72-40aa-4694-afb9-5c6654431388 node scripts/book-hotel-same-correlation.js
 */
import fs from 'fs';
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
const CORRELATION_ID = process.env.CORRELATION_ID || 'f7892c72-40aa-4694-afb9-5c6654431388';
process.env.CORRELATION_ID = CORRELATION_ID;
const OUT = 'reports/book-hotel-same-correlation.json';

const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};
const PAN = { panCardNumber: 'EUIPB1672M', panCardName: 'Rohan Bhagat' };
const ENTITIES = [
  { id: '39627872', name: 'Hilltop Mumbai' },
];

const calls = [];

function brief(d, n = 220) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

function logCall(step, path, res) {
  const sent = res?.sentCorrelationId || CORRELATION_ID;
  const got = res?.data?._meta?.correlation_id || null;
  const row = {
    step,
    path,
    http: res?.status ?? null,
    ok: Boolean(res?.ok),
    sentCorrelationId: sent,
    responseCorrelationId: got,
    sameAsPinned: sent === CORRELATION_ID,
    responseMatchesPinned: got ? got === CORRELATION_ID : null,
    error: res?.data?.error?.code || null,
  };
  calls.push(row);
  console.log(
    `${row.ok ? 'OK' : '!!'} ${step} HTTP ${row.http} sent=${sent} resp=${got || '-'} match=${row.responseMatchesPinned}`,
  );
  return row;
}

async function waitTerminal(hotel, br) {
  let last = null;
  for (let i = 0; i < 20; i += 1) {
    last = await hotel.getBookingStatus(br);
    logCall(`status-${i + 1}`, `/v1/hotels/bookings/${br}/status`, last);
    const st = String(last.data?.status || '');
    console.log('  hotel status', st);
    if (last.ok && isTerminalHotelStatus(st)) return last;
    await sleep(4000);
  }
  return last;
}

async function main() {
  clearSession();
  console.log('Pinned correlation ID:', CORRELATION_ID);
  console.log('Base:', config.baseUrl);

  const session = await authenticate(true);
  session.client.setCorrelationId(CORRELATION_ID);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  const auto = await hotel.autocomplete('mumbai');
  logCall('autocomplete', '/v1/hotels/autocomplete', auto);

  let booked = null;
  const left = [];

  outer:
  for (const ent of ENTITIES) {
    for (const days of [28]) {
      console.log(`\n=== ${ent.name} +${days}d ===`);
      const searchBody = buildSearchBody({
        entityId: ent.id,
        checkinDays: days,
        nights: 1,
        rooms: [{ adults: 1, children: 0, childrenAges: [] }],
      });
      searchBody.type = 'HOTEL';

      const search = await hotel.search(searchBody);
      logCall(`search-${ent.id}-${days}`, '/v1/hotels/search', search);
      if (!search.ok) continue;

      const details = await hotel.getDetails(searchBody);
      logCall(`details-${ent.id}-${days}`, '/v1/hotels/details', details);
      if (!details.ok) continue;

      const requestId = extractRequestId(details.data) || extractRequestId(search.data);
      const hotelName = details.data?.results?.[0]?.name || ent.name;
      const rooms = (details.data?.results?.[0]?.rooms || [])
        .filter((r) => r.available !== false && r.bookingCode)
        .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
      console.log('rooms', rooms.length, 'checkin', searchBody.checkin);
      if (!requestId || !rooms.length) continue;

      for (const room of rooms.slice(0, 1)) {
        const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
        logCall('prebook', '/v1/hotels/prebook', pre);
        if (!isPrebookSuccess(pre)) {
          console.log('prebook fail', brief(pre.data));
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
            email: `hotel.cid.${Date.now()}@travelvip.ai`,
            countryCode: '+91',
            mobile: config.hotel.contactMobile,
            panCardNumber: PAN.panCardNumber,
            panCardName: PAN.panCardName,
          },
        };
        if (room.isGSTClaimable || room.isGstClaimable) body.gstDetails = { ...GST };

        const fin = await hotel.finalizeBooking(body);
        logCall('finalize', '/v1/hotels/finalize-booking', fin);
        const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
        if (!fin.ok || !br) {
          console.log('finalize fail', brief(fin.data));
          continue;
        }

        const stRes = await waitTerminal(hotel, br);
        const status = String(stRes?.data?.status || '');
        if (!/confirm/i.test(status)) {
          console.log('not confirmed', br, status, '— leave');
          left.push({ br, status });
          continue;
        }

        booked = {
          br,
          status,
          hotelName,
          entityId: ent.id,
          checkin: searchBody.checkin,
          checkout: searchBody.checkout,
          amount: room.price?.totalAmount,
          confirmationNumber: stRes.data?.confirmationNumber || null,
        };
        break outer;
      }
    }
  }

  if (!booked) throw new Error('No Confirmed hotel booking');

  const detail = await hotel.getBookingDetail(booked.br);
  logCall('booking-detail', `/v1/hotels/bookings/${booked.br}`, detail);
  booked.confirmationNumber =
    detail.data?.confirmationNumber || booked.confirmationNumber;

  const history = await hotel.bookingHistory(0, 10);
  logCall('booking-history', '/v1/hotels/bookings/history', history);

  const pen = await hotel.penaltyCheck(booked.br);
  logCall('penalty-check', `/v1/hotels/bookings/${booked.br}/penalty-check`, pen);

  const mismatch = calls.filter((c) => c.sentCorrelationId !== CORRELATION_ID);
  const respMismatch = calls.filter((c) => c.responseCorrelationId && c.responseCorrelationId !== CORRELATION_ID);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    pinnedCorrelationId: CORRELATION_ID,
    booked,
    left,
    counts: {
      calls: calls.length,
      sentAlwaysPinned: mismatch.length === 0,
      responseAlwaysPinned: respMismatch.length === 0,
      responseMismatch: respMismatch.map((c) => c.step),
    },
    calls,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nPinned', CORRELATION_ID);
  console.log('Sent always pinned?', mismatch.length === 0);
  console.log('Response always pinned?', respMismatch.length === 0);
  console.log('Booked', booked.br, booked.status, booked.hotelName);
  console.log('Wrote', OUT);
}

main().catch((e) => {
  console.error('STOP:', e.message || e);
  fs.writeFileSync(OUT, JSON.stringify({
    ranAt: new Date().toISOString(),
    pinnedCorrelationId: CORRELATION_ID,
    error: String(e.message || e),
    calls,
  }, null, 2));
  process.exit(1);
});

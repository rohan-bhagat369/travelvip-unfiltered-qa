/**
 * ENG-22 fallback: hotel booking flow on zenith-api (flights search was empty).
 * Hilltop Mumbai. Unique X-Correlation-ID per hop. Cancels if Confirmed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../../../travel-apis/hotel/src/service.js';
import { isPrebookSuccess } from '../../../travel-apis/hotel/src/helpers.js';
import {
  hilltopSearchDetails,
  prebookRoom,
  buildFinalizeBodyFromStay,
  waitTerminal,
  uniqueEmail,
} from '../../../travel-apis/hotel/src/regression/session.js';
import { HILLTOP, PAN_ROHAN, INVALID_PAN } from '../../../travel-apis/hotel/src/regression/fixtures.js';

const PREFIX = process.env.CORR_PREFIX || `qa-otel-eng22-hotel-${Date.now()}`;
const OUT = path.join('reports', 'zenith-otel-eng22-hotel-book.json');
const steps = [];

function brief(data, n = 280) {
  try {
    return JSON.stringify(data).slice(0, n);
  } catch {
    return String(data).slice(0, n);
  }
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

async function timed(label, corr, client, fn) {
  client.setCorrelationId(corr);
  const t0 = Date.now();
  const res = await fn();
  const row = {
    label,
    corr,
    path: res?.path || null,
    http: res?.status ?? null,
    ok: Boolean(res?.ok),
    clientMs: Date.now() - t0,
    errorCode: errCode(res),
    status: res?.data?.status || null,
    bookingRefId: res?.data?.bookingRefId || res?.data?.bookingReferenceId || null,
    bodyPreview: brief(res?.data),
  };
  steps.push(row);
  console.log(JSON.stringify(row));
  return res;
}

(async () => {
  const started = new Date().toISOString();
  console.log(JSON.stringify({
    baseUrl: process.env.BASE_URL,
    prefix: PREFIX,
    hotel: HILLTOP,
    note: 'live finalize; cancel if Confirmed',
  }));

  clearSession();
  process.env.CORRELATION_ID = `${PREFIX}-auth`;
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);
  if (session.accessToken) client.setPartnerKey(session.accessToken);

  const daysList = [28, 35, 21];
  let stay;
  let room;
  let pre;

  for (const days of daysList) {
    client.setCorrelationId(`${PREFIX}-search-${days}`);
    const tSearch = Date.now();
    stay = await hilltopSearchDetails(hotel, { checkinDays: days, nights: 1 });
    room = stay.rooms[0];
    const searchRow = {
      label: `search-${days}`,
      corr: `${PREFIX}-search-${days}`,
      path: '/v1/hotels/search',
      http: stay.search.status,
      ok: stay.search.ok,
      clientMs: Date.now() - tSearch,
      errorCode: errCode(stay.search),
      bodyPreview: brief({
        checkin: stay.searchBody.checkin,
        checkout: stay.searchBody.checkout,
        total: stay.search.data?.totalResults,
        name: stay.search.data?.results?.[0]?.name || stay.hotelName,
      }),
    };
    steps.push(searchRow);
    console.log(JSON.stringify(searchRow));

    const detailsRow = {
      label: `details-${days}`,
      corr: `${PREFIX}-search-${days}`,
      path: '/v1/hotels/details',
      http: stay.details.status,
      ok: stay.details.ok,
      errorCode: errCode(stay.details),
      bodyPreview: brief({
        name: stay.hotelName,
        rooms: stay.rooms.length,
        requestId: stay.requestId,
        pan: room?.isPANMandatory,
        gst: room?.isGSTClaimable || room?.isGstClaimable,
        price: room?.price?.totalAmount,
        bookingCodeLen: String(room?.bookingCode || '').length,
      }),
    };
    steps.push(detailsRow);
    console.log(JSON.stringify(detailsRow));

    if (stay.details.ok && room && stay.requestId) {
      pre = await timed('prebook', `${PREFIX}-prebook`, client, () => prebookRoom(hotel, stay, room));
      if (isPrebookSuccess(pre)) break;
    }
    pre = null;
    room = null;
  }

  const report = {
    started,
    prefix: PREFIX,
    baseUrl: process.env.BASE_URL,
    stay: stay ? { checkin: stay.searchBody.checkin, checkout: stay.searchBody.checkout, requestId: stay.requestId } : null,
    steps,
  };

  if (!room || !isPrebookSuccess(pre)) {
    report.verdict = 'BUG';
    report.note = 'No Hilltop prebook';
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const badPan = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    email: uniqueEmail('hotel.otel.badpan'),
  });
  badPan.contact.panCardNumber = INVALID_PAN;
  await timed('neg-badpan', `${PREFIX}-neg-badpan`, client, () => hotel.finalizeBooking(badPan));

  const body = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    firstName: 'Rohan',
    lastName: 'Bhagat',
    pan: PAN_ROHAN,
    email: uniqueEmail('hotel.otel.e2e'),
  });
  const fin = await timed('finalize', `${PREFIX}-finalize`, client, () => hotel.finalizeBooking(body));
  const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
  report.bookingRefId = br;

  if (!br) {
    report.verdict = 'BUG';
    report.note = `finalize HTTP ${fin.status} ${errCode(fin)}`;
    report.ended = new Date().toISOString();
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const statusRes = await timed('status-poll', `${PREFIX}-status`, client, () => waitTerminal(hotel, br));
  const st = String(statusRes.data?.status || '');
  report.bookingStatus = st;
  const confirmed = /confirmed/i.test(st);
  const inprog = /inprogress|in.progress|pending/i.test(st);

  const detail = await timed('booking-detail', `${PREFIX}-detail`, client, () => hotel.getBookingDetail(br));
  await timed('history', `${PREFIX}-history`, client, () => hotel.bookingHistory(0, 20));
  await timed('unknown-br', `${PREFIX}-unknown-br`, client, () => hotel.getBookingDetail('BR0000000000000001'));

  if (confirmed) {
    await timed('penalty', `${PREFIX}-penalty`, client, () => hotel.penaltyCheck(br));
    const cancel = await timed('cancel', `${PREFIX}-cancel`, client, () => hotel.cancelBooking(br));
    const after = await timed('status-after-cancel', `${PREFIX}-status-after-cancel`, client, () => waitTerminal(hotel, br, { max: 12, intervalMs: 4000 }));
    report.cancelHttp = cancel.status;
    report.statusAfterCancel = after.data?.status || null;
  }

  report.ended = new Date().toISOString();
  report.verdict = confirmed ? 'PASS' : (inprog ? 'NOT TESTED' : 'BUG');
  report.note = confirmed
    ? 'Confirmed then cancel attempted'
    : (inprog ? 'Left Inprogress; did not keep polling' : `terminal ${st}`);
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    wrote: OUT,
    br,
    status: st,
    verdict: report.verdict,
    prefix: PREFIX,
  }));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

/**
 * ENG-22 round 2 — zenith-api with api-staging vgm creds (same as B2B Dev Postman).
 * Unique X-Correlation-ID per hop. Live Hilltop book + cancel.
 * Extra PII + special-char negatives for collector / redaction follow-ups.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../../shared/config/env.js';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { TravelVipClient } from '../../../shared/lib/TravelVipClient.js';
import { HotelService } from '../../../travel-apis/hotel/src/service.js';
import { isPrebookSuccess } from '../../../travel-apis/hotel/src/helpers.js';
import {
  hilltopSearchDetails,
  prebookRoom,
  buildFinalizeBodyFromStay,
  waitTerminal,
  uniqueEmail,
} from '../../../travel-apis/hotel/src/regression/session.js';
import { HILLTOP, PAN_ROHAN, INVALID_PAN, CITY_MUMBAI } from '../../../travel-apis/hotel/src/regression/fixtures.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const PREFIX = process.env.CORR_PREFIX || `qa-otel-eng22-r2-${Date.now()}`;
const OUT = path.join('reports', 'zenith-otel-eng22-round2.json');
const steps = [];

function brief(data, n = 320) {
  try {
    return JSON.stringify(data).slice(0, n);
  } catch {
    return String(data).slice(0, n);
  }
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

async function timed(label, corr, client, fn) {
  client.setCorrelationId(corr);
  const t0 = Date.now();
  const res = await fn();
  const row = {
    label,
    corr,
    method: res?.method || null,
    path: res?.path || null,
    http: res?.status ?? null,
    ok: Boolean(res?.ok),
    clientMs: Date.now() - t0,
    errorCode: errCode(res),
    status: res?.data?.status ?? res?.data?.statusCode ?? null,
    bookingRefId: res?.data?.bookingRefId || res?.data?.bookingReferenceId || null,
    bodyPreview: brief(res?.data),
  };
  steps.push(row);
  console.log(JSON.stringify(row));
  return res;
}

(async () => {
  const started = new Date().toISOString();
  const baseUrl = process.env.BASE_URL || 'https://zenith-api.travelvip.ai';
  console.log(JSON.stringify({
    baseUrl,
    prefix: PREFIX,
    partner: config.partnerId,
    tierId: config.tierId,
    note: 'B2B Dev creds from .env; only BASE_URL is zenith. Same signing as Postman B2B collection.',
  }));

  clearSession();
  process.env.CORRELATION_ID = `${PREFIX}-auth`;
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);
  if (session.accessToken) client.setPartnerKey(session.accessToken);

  // --- TC-2 timing (client). Compare later to SigNoz http.duration_ms (gap must be <= 1s).
  for (let i = 0; i < 3; i += 1) {
    await timed(`time-ac-${i}`, `${PREFIX}-time-ac-${i}`, client, () => hotel.autocomplete('hiltop'));
  }

  const searchBody = {
    entityId: CITY_MUMBAI.entityId,
    type: 'CITY',
    nationality: 'IN',
    checkin: futureDate(28),
    checkout: futureDate(29),
    occupancy: [{ adults: 1 }],
  };
  for (let i = 0; i < 3; i += 1) {
    await timed(`time-search-${i}`, `${PREFIX}-time-search-${i}`, client, () => hotel.search(searchBody));
  }
  await timed('time-airports', `${PREFIX}-time-airports`, client, () => client.request({
    method: 'GET',
    path: '/v1/flights/airports',
    query: { airport: 'BOM' },
  }));

  // --- Hotel book fixture
  const daysList = [28, 35, 21];
  let stay;
  let room;
  let pre;
  for (const days of daysList) {
    client.setCorrelationId(`${PREFIX}-search-${days}`);
    const tSearch = Date.now();
    stay = await hilltopSearchDetails(hotel, { checkinDays: days, nights: 1 });
    steps.push({
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
    });
    room = stay.rooms[0];
    steps.push({
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
      }),
    });
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
    baseUrl,
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

  // --- Negatives / edge (clone valid baseline, mutate one field)
  const baseline = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    email: uniqueEmail('hotel.otel.r2'),
  });

  const badPan = JSON.parse(JSON.stringify(baseline));
  badPan.contact.panCardNumber = INVALID_PAN;
  await timed('neg-badpan', `${PREFIX}-neg-badpan`, client, () => hotel.finalizeBooking(badPan));

  const extraPii = JSON.parse(JSON.stringify(baseline));
  extraPii.contact.panCardNumber = INVALID_PAN;
  extraPii.rooms[0].guests[0].middleName = 'Kumar';
  extraPii.rooms[0].guests[0].dateOfBirth = '1990-01-15';
  extraPii.rooms[0].guests[0].gender = 'MALE';
  extraPii.rooms[0].guests[0].nationality = 'IN';
  extraPii.rooms[0].guests[0].passportNumber = 'Z1234567';
  extraPii.rooms[0].guests[0].address = '12 Marine Drive, Mumbai';
  extraPii.contact.cardNumber = '4111111111111111';
  extraPii.contact.address = '12 Marine Drive, Mumbai';
  extraPii.profile = { fullName: 'Rohan Kumar Bhagat', dob: '1990-01-15' };
  extraPii.passport = { passportNumber: 'Z1234567', issuedDate: '2019-06-01' };
  await timed('neg-pii-shaped', `${PREFIX}-neg-pii-shaped`, client, () => hotel.finalizeBooking(extraPii));

  const commaName = JSON.parse(JSON.stringify(baseline));
  commaName.rooms[0].guests[0].firstName = 'Rohan,';
  await timed('neg-comma-firstname', `${PREFIX}-neg-comma-fn`, client, () => hotel.finalizeBooking(commaName));

  const punctName = JSON.parse(JSON.stringify(baseline));
  punctName.rooms[0].guests[0].firstName = '!@#$';
  await timed('neg-punct-firstname', `${PREFIX}-neg-punct-fn`, client, () => hotel.finalizeBooking(punctName));

  const htmlName = JSON.parse(JSON.stringify(baseline));
  htmlName.rooms[0].guests[0].firstName = '<script>alert(1)</script>';
  await timed('neg-html-firstname', `${PREFIX}-neg-html-fn`, client, () => hotel.finalizeBooking(htmlName));

  const commaEmail = JSON.parse(JSON.stringify(baseline));
  commaEmail.contact.email = 'qa,otel@travelvip.ai';
  await timed('neg-comma-email', `${PREFIX}-neg-comma-email`, client, () => hotel.finalizeBooking(commaEmail));

  await timed('neg-checkout-before', `${PREFIX}-neg-dates`, client, () => hotel.search({
    entityId: HILLTOP.entityId,
    type: 'HOTEL',
    nationality: 'IN',
    checkin: futureDate(29),
    checkout: futureDate(28),
    occupancy: [{ adults: 1 }],
  }));

  await timed('neg-nationality-html', `${PREFIX}-neg-nat-html`, client, () => hotel.search({
    entityId: CITY_MUMBAI.entityId,
    type: 'CITY',
    nationality: '<script>',
    checkin: futureDate(28),
    checkout: futureDate(29),
    occupancy: [{ adults: 1 }],
  }));

  const anon = new TravelVipClient({ baseUrl, correlationId: `${PREFIX}-neg-omit-bearer` });
  await timed('neg-omit-bearer', `${PREFIX}-neg-omit-bearer`, anon, () => anon.request({
    method: 'GET',
    path: '/v1/hotels/autocomplete',
    query: { q: 'pune', page: 1, perpage: 20 },
    auth: false,
    signed: false,
  }));

  const garbage = new TravelVipClient({
    baseUrl,
    correlationId: `${PREFIX}-neg-garbage-bearer`,
    authToken: 'not-a-jwt',
  });
  await timed('neg-garbage-bearer', `${PREFIX}-neg-garbage-bearer`, garbage, () => garbage.request({
    method: 'GET',
    path: '/v1/hotels/autocomplete',
    query: { q: 'pune', page: 1, perpage: 20 },
    signed: false,
  }));

  // --- Happy path book + cancel
  const body = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    firstName: 'Rohan',
    lastName: 'Bhagat',
    pan: PAN_ROHAN,
    email: uniqueEmail('hotel.otel.r2e2e'),
  });
  body.rooms[0].guests[0].dateOfBirth = '1990-01-15';
  body.rooms[0].guests[0].gender = 'MALE';
  body.rooms[0].guests[0].nationality = 'IN';
  const fin = await timed('finalize', `${PREFIX}-finalize`, client, () => hotel.finalizeBooking(body));
  const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
  report.bookingRefId = br;

  if (br) {
    const statusRes = await timed('status-poll', `${PREFIX}-status`, client, () => waitTerminal(hotel, br));
    const st = String(statusRes.data?.status || '');
    report.bookingStatus = st;
    const confirmed = /confirmed/i.test(st);
    await timed('booking-detail', `${PREFIX}-detail`, client, () => hotel.getBookingDetail(br));
    await timed('history', `${PREFIX}-history`, client, () => hotel.bookingHistory(0, 20));
    await timed('unknown-br', `${PREFIX}-unknown-br`, client, () => hotel.getBookingDetail('BR0000000000000001'));
    if (confirmed) {
      await timed('penalty', `${PREFIX}-penalty`, client, () => hotel.penaltyCheck(br));
      const cancel = await timed('cancel', `${PREFIX}-cancel`, client, () => hotel.cancelBooking(br));
      const after = await timed('status-after-cancel', `${PREFIX}-status-after-cancel`, client, () => waitTerminal(hotel, br, { max: 12, intervalMs: 4000 }));
      report.cancelHttp = cancel.status;
      report.statusAfterCancel = after.data?.status || null;
    }
    report.verdict = confirmed ? 'PASS' : 'NOT TESTED';
    report.note = confirmed ? 'Confirmed then cancelled' : `terminal ${st}`;
  } else {
    report.verdict = 'BUG';
    report.note = `finalize HTTP ${fin.status} ${errCode(fin)}`;
  }

  report.ended = new Date().toISOString();
  report.steps = steps;
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ wrote: OUT, br, prefix: PREFIX, verdict: report.verdict }));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

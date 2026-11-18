/**
 * Case D recheck — provider_no_response + status/cancel + webhook finish blockers
 * BASE_URL=https://theta-api.travelvip.ai node travel-apis/scripts/probe-theta-case-d-webhook-recheck.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../shared/lib/authService.js';
import { config } from '../../shared/config/env.js';
import { HotelService } from '../hotel/src/service.js';
import {
  buildSearchBody,
  buildFinalizeBody,
  extractRequestId,
  extractBookingContext,
} from '../hotel/src/helpers.js';
import { CabService } from '../cab/src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody as buildCabFinalize,
  pickCab,
} from '../cab/src/helpers.js';

const BASE = (process.env.BASE_URL || 'https://theta-api.travelvip.ai').replace(/\/$/, '');
const OUT = path.join('travel-apis', 'reports', 'theta-case-d-webhook-recheck.json');
const SIM = 'provider_no_response';

function brief(d, n = 600) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function walletFeed(accessToken) {
  const url = new URL(`${BASE}/v1/wallet/activity`);
  url.searchParams.set('page', '1');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  return {
    status: res.status,
    available: data?.summary?.available ?? data?.summary?.cashBalance ?? null,
    summary: data?.summary || null,
  };
}

async function hotelCaseD(client, hotel, attempt) {
  const checkinDays = 20 + attempt;
  const searchBody = buildSearchBody({
    entityId: '39627872',
    checkinDays,
    nights: 1,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  const search = await hotel.search(searchBody);
  const details = await hotel.getDetails(searchBody);
  const requestId = extractRequestId(details.data);
  const room = (details.data?.results?.[0]?.rooms || []).find((r) => r.available !== false && r.bookingCode)
    || (details.data?.results?.[0]?.rooms || [])[0];
  if (!room?.bookingCode || !requestId) {
    return { attempt, stage: 'prebook-prep', ok: false, searchHttp: search.status, detail: brief(details.data, 300) };
  }
  const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
  const bookingContext = extractBookingContext(prebook.data);
  if (!bookingContext) {
    return { attempt, stage: 'prebook', ok: false, http: prebook.status, detail: brief(prebook.data, 300) };
  }
  // Confirmed-friendly lead (same as Case A that worked)
  const guests = [{
    title: 'Mr',
    firstName: 'Rohan',
    lastName: 'Bhagat',
    type: 'Adult',
    isLead: true,
  }];
  const body = buildFinalizeBody({
    bookingContext,
    bookingCode: room.bookingCode,
    requestId,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    guests,
  });
  body.rooms = [{ guests }];
  body.contact.panCardNumber = 'EUIPB1672M';
  body.contact.panCardName = 'Rohan Bhagat';

  const fin = await client.request({
    method: 'POST',
    path: '/v1/hotels/finalize-booking',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders: { 'X-Simulate-Failure': SIM },
  });

  const br = fin.data?.bookingReference || fin.data?.bookingReferenceId || fin.data?.bookingRefId || null;
  const row = {
    attempt,
    checkin: searchBody.checkin,
    amount: room?.price?.totalAmount || room?.totalAmount,
    http: fin.status,
    status: fin.data?.status ?? null,
    statusCode: fin.data?.statusCode ?? null,
    br,
    code: fin.data?.error?.code || null,
    refund: fin.data?.refund || null,
    snippet: brief(fin.data),
  };

  if (br) {
    const st = await hotel.getBookingStatus(br);
    const detail = await hotel.getBookingDetail(br);
    row.statusProbe = { http: st.status, status: st.data?.status, snippet: brief(st.data, 300) };
    row.detailProbe = { http: detail.status, status: detail.data?.status, snippet: brief(detail.data, 300) };
  }
  return row;
}

async function cabCaseD(client, cab) {
  const body = buildAirportSearchBody();
  const d = new Date(body.pickupDatetime);
  d.setUTCMinutes(d.getUTCMinutes() + Math.floor(Math.random() * 40));
  body.pickupDatetime = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const search = await cab.search(body);
  const selected = pickCab(search.data?.cabs);
  if (!selected?.searchId) {
    return { stage: 'search', ok: false, detail: brief(search.data, 300) };
  }
  const fare = await cab.fare(selected.searchId);
  if (!fare.data?.priceId || !fare.data?.bookingReference) {
    return { stage: 'fare', ok: false, detail: brief(fare.data, 300) };
  }
  const finBody = buildCabFinalize({
    bookingReference: fare.data.bookingReference,
    priceId: fare.data.priceId,
  });
  finBody.passengers[0].profile.lastName = `QaD${Date.now().toString(36).slice(-5)}`;

  const fin = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking',
    query: { lang: 'en', currency: 'INR' },
    body: finBody,
    correlation: true,
    partnerKey: client.partnerKey,
    extraHeaders: { 'X-Simulate-Failure': SIM },
  });
  const br = fin.data?.bookingRefId || fin.data?.bookingReference || null;
  const row = {
    amount: fare.data?.priceDetail?.totalAmount || fare.data?.totalAmount,
    http: fin.status,
    status: fin.data?.status ?? null,
    statusCode: fin.data?.statusCode ?? null,
    br,
    code: fin.data?.error?.code || null,
    refund: fin.data?.refund || null,
    snippet: brief(fin.data),
  };

  if (!br) return row;

  // Probe every known status/cancel shape
  const probes = [
    { name: 'GET /cabs/{br}/status', method: 'GET', path: `/v1/airportServices/cabs/${br}/status` },
    { name: 'GET /cabs/bookings/{br}/status', method: 'GET', path: `/v1/airportServices/cabs/bookings/${br}/status` },
    { name: 'GET /cabs/bookings/{br}/cancel', method: 'GET', path: `/v1/airportServices/cabs/bookings/${br}/cancel` },
    {
      name: 'POST /cabs/bookings/{br}/cancel',
      method: 'POST',
      path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
      body: { cancelledBy: 'USER', cancellationReason: 'Case D webhook recheck — do not keep' },
    },
  ];
  row.probes = [];
  for (const p of probes) {
    const res = await client.request({
      method: p.method,
      path: p.path,
      query: { lang: 'en', currency: 'INR' },
      body: p.body,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    row.probes.push({
      name: p.name,
      http: res.status,
      code: res.data?.error?.code || null,
      status: res.data?.status || res.data?.result?.bookingStatus || null,
      snippet: brief(res.data, 350),
    });
  }
  return row;
}

async function webhookSmoke(br) {
  // Without CAB_WEBHOOK_* we still prove the endpoint shape / auth gate.
  const url = new URL(`${BASE}/v1/airportServices/cabs/partner-webhook`);
  url.searchParams.set('lang', 'en');
  const attempts = [];

  const noAuth = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  attempts.push({
    name: 'no-auth empty body',
    http: noAuth.status,
    data: brief(await noAuth.json().catch(() => null), 300),
  });

  const badAuth = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from('bad:creds').toString('base64')}`,
    },
    body: JSON.stringify({
      bookingRefId: br || 'BR0000000000000001',
      status: 'CONFIRMED',
      event: 'booking.confirmed',
    }),
  });
  attempts.push({
    name: 'bad-auth CONFIRMED payload',
    http: badAuth.status,
    data: brief(await badAuth.json().catch(() => null), 300),
  });

  // Also try hotel-ish webhook paths (discovery)
  for (const p of [
    '/v1/hotels/partner-webhook',
    '/v1/hotels/webhook',
    '/api/v1/hotels/partner-webhook',
  ]) {
    const r = await fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingRefId: br || 'BR0', status: 'FAILED' }),
    });
    const text = await r.text().catch(() => '');
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
    attempts.push({ name: `hotel path ${p}`, http: r.status, data: brief(data, 200) });
  }

  return {
    hasWebhookCreds: !!(process.env.CAB_WEBHOOK_USER && process.env.CAB_WEBHOOK_PASS),
    attempts,
    note: 'CONFIRMED/FAILED/refund-fail webhook finish needs supplier webhook or CAB_WEBHOOK_* + known payload schema',
  };
}

async function main() {
  clearSession();
  const { client, tokens } = await authenticate(true);
  const accessToken = tokens?.access_token || tokens?.accessToken;
  const hotel = new HotelService(client);
  const cab = new CabService(client);

  const waBefore = await walletFeed(accessToken);
  console.log('wallet before', waBefore.available);

  const hotelAttempts = [];
  for (let i = 1; i <= 3; i++) {
    console.log(`\n--- Hotel Case D attempt ${i} ---`);
    const row = await hotelCaseD(client, hotel, i);
    hotelAttempts.push(row);
    console.log(JSON.stringify({
      attempt: i, http: row.http, status: row.status, br: row.br, code: row.code,
    }));
    if (row.br) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log('\n--- Cab Case D ---');
  const cabRow = await cabCaseD(client, cab);
  console.log(JSON.stringify({
    http: cabRow.http, status: cabRow.status, br: cabRow.br,
    probes: (cabRow.probes || []).map((p) => ({ name: p.name, http: p.http, code: p.code })),
  }));

  const waAfter = await walletFeed(accessToken);
  console.log('wallet after', waAfter.available);

  const webhook = await webhookSmoke(cabRow.br || hotelAttempts.find((h) => h.br)?.br);
  console.log('webhook smoke', JSON.stringify(webhook.attempts.map((a) => ({ name: a.name, http: a.http }))));

  // Score
  const hotelOk = hotelAttempts.find((h) => h.br && /pending/i.test(String(h.status || '')));
  const hotelNullBrPending = hotelAttempts.find((h) =>
    /pending/i.test(String(h.status || '')) && !h.br && h.http < 500);
  const hotel500 = hotelAttempts.every((h) => h.http >= 500 || (!h.br && !h.status));

  const cabStatusBroken = (cabRow.probes || []).some((p) => /status/i.test(p.name) && p.http >= 500);
  const cabCancelBroken = (cabRow.probes || []).some((p) => /cancel/i.test(p.name) && p.http >= 500);

  const score = {
    hotel_D_finalize: hotelOk
      ? { verdict: 'PASS', note: `BR ${hotelOk.br} PENDING` }
      : hotelNullBrPending
        ? { verdict: 'BUG', note: `Pending with null bookingRefId http=${hotelNullBrPending.http}` }
        : hotel500
          ? { verdict: 'BUG', note: 'all attempts HTTP 500 / empty — no BR for webhook' }
          : { verdict: 'BUG', note: brief(hotelAttempts.map((h) => ({ http: h.http, status: h.status, br: h.br }))) },
    cab_D_finalize: cabRow.br && /pending/i.test(String(cabRow.status || ''))
      ? { verdict: 'PASS', note: `BR ${cabRow.br} PENDING charged path` }
      : { verdict: 'BUG', note: `http=${cabRow.http} status=${cabRow.status} br=${cabRow.br}` },
    cab_D_status_api: cabStatusBroken
      ? { verdict: 'BUG', note: 'status endpoints HTTP 500' }
      : cabRow.br
        ? { verdict: 'PASS', note: 'status responded <500' }
        : { verdict: 'NOT TESTED', note: 'no BR' },
    cab_D_cancel_api: cabCancelBroken
      ? { verdict: 'BUG', note: 'cancel endpoints HTTP 500' }
      : cabRow.br
        ? { verdict: 'PASS', note: 'cancel responded <500' }
        : { verdict: 'NOT TESTED', note: 'no BR' },
    webhook_finish_CONFIRMED: { verdict: 'NOT TESTED', note: webhook.note },
    webhook_finish_FAILED_refund: { verdict: 'NOT TESTED', note: webhook.note },
    webhook_finish_FAILED_refund_fail: { verdict: 'NOT TESTED', note: 'needs provider_reject path on webhook + wallet_refund_fail; blocked by missing BR (hotel) / status 500 (cab) + no webhook creds' },
  };

  const report = {
    at: new Date().toISOString(),
    base: BASE,
    sim: SIM,
    wallet: { before: waBefore.available, after: waAfter.available },
    hotelAttempts,
    cab: cabRow,
    webhook,
    score,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSCORE', JSON.stringify(score, null, 2));
  console.log('wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

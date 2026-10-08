/**
 * Live-run Partner + one flow per scenario (book + cancel), then inject
 * Sample request/response examples into the Postman collection.
 *
 *   node scripts/capture-postman-samples-live.js
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authenticate, refreshPartnerToken } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { HotelService } from '../../../hotel/src/service.js';
import { CabService } from '../../../cab/src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  buildSeatMapPassengers,
  extractOnwardSearchIds,
  extractReturnSearchId,
} from '../../src/helpers.js';
import { buildAirportSearchBody, futurePickupDatetime } from '../../../cab/src/helpers.js';
import { config } from '../../../../shared/config/env.js';
import { futureDate, sleep } from '../../../../shared/lib/testUtils.js';
import { createSignature, createTimestamp, createRequestId } from '../../../../shared/lib/signature.js';

const COLLECTION_PATH = path.resolve('postman/TravelVIP-B2B-Dynamic-E2E.postman_collection.json');
const REPORT_PATH = path.resolve('reports/postman-sample-capture.json');
const FLIGHT_Q = { lang: 'en', currency: 'INR' };
const MAX_BODY = 120_000;

const samplesByPath = new Map(); // "Folder > ... > RequestName" -> example

function truncJson(data) {
  let s = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (s.length > MAX_BODY) {
    s = `${s.slice(0, MAX_BODY)}\n/* truncated for Postman collection size */`;
  }
  return s;
}

function example({ name, method, url, headers, body, status, data }) {
  const hdr = Object.entries(headers || {}).map(([key, value]) => ({ key, value, type: 'text' }));
  const originalRequest = {
    method,
    header: hdr,
    url: typeof url === 'string' ? url : url,
  };
  if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
    originalRequest.body = {
      mode: 'raw',
      raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }
  return {
    name: name || 'Sample',
    originalRequest,
    status: status >= 200 && status < 300 ? 'OK' : String(status),
    code: status,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    cookie: [],
    body: truncJson(data),
  };
}

function saveSample(folderPath, requestName, ex) {
  const key = `${folderPath}|||${requestName}`;
  samplesByPath.set(key, ex);
  console.log(`  ✓ sample → ${folderPath} > ${requestName} [${ex.code}]`);
}

function findItemByPath(items, parts) {
  let cur = { item: items };
  for (const part of parts) {
    cur = (cur.item || []).find((x) => x.name === part);
    if (!cur) return null;
  }
  return cur;
}

function injectSamples(collection) {
  let injected = 0;
  for (const [key, ex] of samplesByPath.entries()) {
    const [folderPath, requestName] = key.split('|||');
    const parts = folderPath.split(' > ').filter(Boolean);
    const folder = findItemByPath(collection.item, parts);
    if (!folder?.item) {
      console.warn('folder missing', folderPath);
      continue;
    }
    const reqItem = folder.item.find((x) => x.name === requestName);
    if (!reqItem) {
      console.warn('request missing', folderPath, requestName);
      continue;
    }
    // Keep prior samples; replace same-named Sample or append
    const existing = Array.isArray(reqItem.response) ? reqItem.response : [];
    const withoutOld = existing.filter((r) => r.name !== 'Sample');
    reqItem.response = [...withoutOld, ex];
    injected += 1;
  }
  return injected;
}

function brOf(d) {
  return (
    d?.bookingReference
    || d?.bookingReferenceId
    || d?.bookingRefId
    || d?.data?.bookingReference
    || d?.data?.bookingReferenceId
    || null
  );
}

function adultProfile() {
  return {
    title: 'Mr',
    firstName: 'Rohan',
    lastName: 'Bhagat',
    gender: 'Male',
    dob: '1998-05-12',
  };
}

function mkPassengers(adults, children, infants) {
  const list = [];
  for (let i = 0; i < adults; i += 1) {
    list.push({
      paxId: `PAX${list.length + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: 'Mr',
        firstName: i === 0 ? 'Rohan' : 'Amit',
        lastName: 'Bhagat',
        gender: 'Male',
        dob: '1998-05-12',
        nationality: 'IN',
      },
      city: { cityCode: 'DEL', cityName: 'Delhi' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    });
  }
  for (let i = 0; i < children; i += 1) {
    list.push({
      paxId: `PAX${list.length + 1}`,
      type: 'child',
      isLead: false,
      profile: {
        title: 'Mstr',
        firstName: i === 0 ? 'Aarav' : 'Kabir',
        lastName: 'Bhagat',
        gender: 'Male',
        dob: '2018-06-01',
        nationality: 'IN',
      },
      city: { cityCode: 'DEL', cityName: 'Delhi' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    });
  }
  for (let i = 0; i < infants; i += 1) {
    list.push({
      paxId: `PAX${list.length + 1}`,
      type: 'infant',
      isLead: false,
      profile: {
        title: 'Mstr',
        firstName: i === 0 ? 'Vihaan' : 'Reyansh',
        lastName: 'Bhagat',
        gender: 'Male',
        dob: '2025-08-01',
        nationality: 'IN',
      },
      city: { cityCode: 'DEL', cityName: 'Delhi' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    });
  }
  return list;
}

async function signedGet(client, pathName, query = {}, headersExtra = {}) {
  const timestamp = createTimestamp();
  const body = '';
  const signature = createSignature(body, timestamp, config.signingKey);
  return client.request({
    method: 'GET',
    path: pathName,
    query,
    signed: false,
    auth: true,
    correlation: true,
    extraHeaders: {
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Request-Id': createRequestId(),
      ...headersExtra,
    },
  });
}

async function captureClientCall(folderPath, requestName, client, opts, sampleMeta = {}) {
  const res = await client.request(opts);
  const url = `${config.baseUrl}${opts.path}${opts.query ? `?${new URLSearchParams(opts.query)}` : ''}`;
  saveSample(
    folderPath,
    requestName,
    example({
      name: 'Sample',
      method: opts.method || 'POST',
      url,
      headers: {
        Authorization: 'Bearer {{auth_token}}',
        'Content-Type': 'application/json',
        ...(opts.partnerKey ? { 'X-Partner-Key': '{{access_token}}' } : {}),
        ...sampleMeta.headers,
      },
      body: opts.body,
      status: res.status,
      data: res.data,
    }),
  );
  return res;
}

async function runPartner(session) {
  const folder = 'Partner Api';
  const client = session.client;

  // Access token already done via authenticate — re-call for sample
  const tokenRes = await client.request({
    method: 'POST',
    path: '/auth/partner/token',
    body: { partner_id: config.partnerId, partner_secret: config.partnerSecret },
    signed: false,
    auth: false,
    extraHeaders: { 'X-Request-Id': createRequestId() },
  });
  saveSample(folder, '01 Access Token', example({
    name: 'Sample',
    method: 'POST',
    url: `${config.baseUrl}/auth/partner/token`,
    headers: { 'Content-Type': 'application/json' },
    body: { partner_id: '{{partner_id}}', partner_secret: '{{partner_secret}}' },
    status: tokenRes.status,
    data: {
      ...tokenRes.data,
      access_token: tokenRes.data?.access_token ? '[REDACTED]' : null,
      refresh_token: tokenRes.data?.refresh_token ? '[REDACTED]' : null,
    },
  }));

  let refreshData = null;
  try {
    refreshData = await refreshPartnerToken(tokenRes.data.refresh_token);
    saveSample(folder, '02 Refresh Token', example({
      name: 'Sample',
      method: 'POST',
      url: `${config.baseUrl}/auth/partner/refresh`,
      headers: { 'Content-Type': 'application/json' },
      body: { refresh_token: '{{refresh_token}}' },
      status: 200,
      data: {
        ...refreshData,
        access_token: refreshData?.access_token ? '[REDACTED]' : null,
        refresh_token: refreshData?.refresh_token ? '[REDACTED]' : null,
      },
    }));
    if (refreshData?.access_token) {
      session.accessToken = refreshData.access_token;
      session.client.setPartnerKey(refreshData.access_token);
    }
  } catch (e) {
    console.warn('refresh failed', e.message);
  }

  const userRes = await client.request({
    method: 'POST',
    path: '/v1/auth/session',
    body: { tierId: config.tierId },
    signed: false,
    auth: false,
    partnerKey: session.accessToken,
    extraHeaders: { 'X-Request-Id': createRequestId() },
  });
  saveSample(folder, '03 User Auth', example({
    name: 'Sample',
    method: 'POST',
    url: `${config.baseUrl}/v1/auth/session`,
    headers: { 'Content-Type': 'application/json', 'X-Partner-Key': '{{access_token}}' },
    body: { tierId: Number(config.tierId) },
    status: userRes.status,
    data: {
      ...userRes.data,
      auth_token: userRes.data?.auth_token ? '[REDACTED]' : null,
    },
  }));
  if (userRes.data?.auth_token) {
    session.client.setAuthToken(userRes.data.auth_token);
  }

  const tiersRes = await client.request({
    method: 'GET',
    path: '/v1/tiers',
    signed: false,
    auth: false,
    partnerKey: session.accessToken,
    extraHeaders: { 'X-Request-Id': createRequestId() },
  });
  saveSample(folder, '04 Tiers List', example({
    name: 'Sample',
    method: 'GET',
    url: `${config.baseUrl}/v1/tiers`,
    headers: { 'X-Partner-Key': '{{access_token}}' },
    status: tiersRes.status,
    data: tiersRes.data,
  }));

  return { ok: tokenRes.ok && userRes.ok };
}

async function flightLookups(folder, flight) {
  const client = flight.client;
  const airports = await signedGet(client, '/v1/flights/airports', {
    ...FLIGHT_Q, airport: 'DEL', page: 0, perpage: 10,
  });
  saveSample(folder, '01 Airport Search', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/airports?lang=en&currency=INR&airport=DEL&page=0&perpage=10`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: airports.status, data: airports.data,
  }));

  const airlines = await signedGet(client, '/v1/flights/airlines', {
    ...FLIGHT_Q, airline: '6E', page: 1, perpage: 10,
  });
  saveSample(folder, '02 Airline Search', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/airlines?lang=en&currency=INR&airline=6E&perpage=10&page=1`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: airlines.status, data: airlines.data,
  }));

  const cities = await signedGet(client, '/v1/flights/citySearch', {
    ...FLIGHT_Q, q: 'Pune', page: 0, perpage: 10,
  });
  saveSample(folder, '03 City Search', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/citySearch?lang=en&currency=INR&q=Pune&page=0&perpage=10`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: cities.status, data: cities.data,
  }));
}

async function cancelFlightChain(folder, flight, br, startNum) {
  // nums: 14/15/16 for OW or 15/16/17 for RT — pass labels explicitly
  const penalty = await flight.checkCancellationPenalty(br, 2);
  saveSample(folder, startNum, example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/${br}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY', retryCount: 2 },
    status: penalty.status, data: penalty.data,
  }));

  // Prefer PENALTY_AND_CANCEL as the actual cancel so we don't cancel twice
  const pac = await flight.cancelBooking(br, 2);
  // Our service cancelBooking always sends CANCEL — call raw for PENALTY_AND_CANCEL sample + effect
  const pacRes = await flight.client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: FLIGHT_Q,
    body: { action: 'PENALTY_AND_CANCEL', retryCount: 2 },
    partnerKey: flight.client.partnerKey,
    correlation: true,
  });
  saveSample(folder, startNum.replace('Penalty Check', 'Penalty Check').includes('14') ? '16 Penalty + Cancel' : '17 Penalty + Cancel', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/${br}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY_AND_CANCEL', retryCount: 2 },
    status: pacRes.status, data: pacRes.data,
  }));

  // Also save a CANCEL sample (may already be cancelled — still capture response)
  const cancelOnly = await flight.client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: FLIGHT_Q,
    body: { action: 'CANCEL', retryCount: 2 },
    partnerKey: flight.client.partnerKey,
    correlation: true,
  });
  const cancelLabel = startNum.startsWith('14') ? '15 Cancel' : '16 Cancel';
  const pacLabel = startNum.startsWith('14') ? '16 Penalty + Cancel' : '17 Penalty + Cancel';
  // re-save with correct labels
  saveSample(folder, '14 Cancellation Penalty Check'.replace('14', startNum.startsWith('14') ? '14' : '15').includes('x') ? startNum : (startNum.startsWith('14') ? '14 Cancellation Penalty Check' : '15 Cancellation Penalty Check'), example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/${br}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY', retryCount: 2 },
    status: penalty.status, data: penalty.data,
  }));
  saveSample(folder, cancelLabel, example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/${br}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'CANCEL', retryCount: 2 },
    status: cancelOnly.status, data: cancelOnly.data,
  }));
  saveSample(folder, pacLabel, example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/${br}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY_AND_CANCEL', retryCount: 2 },
    status: pacRes.status, data: pacRes.data,
  }));

  return { penalty, cancelOnly, pacRes };
}

async function runOwScenario(session, { folder, adults, children, infants, ancillary }) {
  console.log('\n====', folder, '====');
  const flight = new FlightService(session.client);
  await flightLookups(folder, flight);

  const body = buildOneWaySearchBody(42, {
    origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: null,
  });
  body.travellers = { adults, children, infants };
  body.preferences.airlines = [];

  let search;
  try {
    search = await flight.searchUntilComplete(body);
  } catch (e) {
    console.warn('search fail', e.message);
    return { ok: false, error: e.message };
  }
  saveSample(folder, '04 Search OW', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/search?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body,
    status: search.response.status,
    data: search.response.data,
  }));

  const sid = search.searchId || search.searchIds?.[0];
  if (!sid) return { ok: false, error: 'no searchId' };

  const details = await flight.getDetails([sid], 'ONE_WAY');
  saveSample(folder, '05 Details', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/details?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [sid] } },
    status: details.status, data: details.data,
  }));

  const rules = await flight.getFareRules([sid], 'ONE_WAY');
  saveSample(folder, '06 Fare Rules', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/fareRules?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [sid] } },
    status: rules.status, data: rules.data,
  }));

  const pricing = await flight.getPricing([sid], 'ONE_WAY');
  saveSample(folder, '07 Pricing', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/pricing?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { journeyType: 'ONE_WAY', selection: { selectedSearchIds: [sid] } },
    status: pricing.status, data: pricing.data,
  }));
  if (!pricing.ok) return { ok: false, error: 'pricing failed', data: pricing.data };

  const ssr = await flight.getSsr(pricing.data.priceId);
  saveSample(folder, '08 SSR (meals/baggage)', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/ssr?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { priceId: pricing.data.priceId },
    status: ssr.status, data: ssr.data,
  }));

  const seat = await flight.getSeatMap(pricing.data.bookingContext, buildSeatMapPassengers(adultProfile()));
  saveSample(folder, '09 SeatMap', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/seatmap?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { currency: 'INR', requestReference: '{{booking_context}}', passengers: buildSeatMapPassengers(adultProfile()) },
    status: seat.status, data: seat.data,
  }));

  // Build issue payload
  const passengers = mkPassengers(adults, children, infants);
  if (ancillary) {
    // attach cheapest meal/bag if any
    const mealSeg = ssr.data?.meal?.segments?.[0];
    const meal = (mealSeg?.Meals || mealSeg?.meals || []).find((m) => (m.priceReference || m.pricing?.priceReference));
    const bagSeg = ssr.data?.baggage?.segments?.[0];
    const bag = (bagSeg?.Baggage || bagSeg?.baggage || []).find((b) => (b.priceReference || b.pricing?.priceReference));
    if (meal) {
      passengers[0].ssr.meals = [{
        priceReference: meal.priceReference || meal.pricing?.priceReference,
        segmentId: meal.segmentId || 'SEG_1',
        origin: 'DEL', destination: 'BOM',
        title: meal.title || 'Meal', description: meal.description || 'Meal',
        amount: Number(meal.pricing?.totalAmount || meal.amount || 0), quantity: 1,
      }];
    }
    if (bag) {
      passengers[0].ssr.baggage = [{
        priceReference: bag.priceReference || bag.pricing?.priceReference,
        segmentId: bag.segmentId || 'SEG_1',
        origin: 'DEL', destination: 'BOM',
        title: bag.title || 'Bag', description: bag.description || 'Bag',
        amount: Number(bag.pricing?.totalAmount || bag.amount || 0), quantity: 1,
      }];
    }
  }

  const issueBody = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: pricing.data.bookingContext,
    searchIds: [sid],
    journeyType: 'ONE_WAY',
    timezone: 'Asia/Calcutta',
    data: {
      priceId: pricing.data.priceId,
      passportType: pricing.data.passportType || 'NONE',
      includeGst: false,
      gstDetails: null,
      contact: {
        email: config.flight.contactEmail,
        mobile: config.flight.contactMobile,
        countryCode: config.flight.contactCountryCode,
      },
      passengers,
    },
  };

  const issueName = ancillary ? '10 Issue Ticket (with ancillaries)' : '10 Issue Ticket';
  const issue = await flight.client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...FLIGHT_Q, count: 10, page: 0, perpage: 20 },
    body: issueBody,
    correlation: true,
    partnerKey: session.accessToken,
  });
  saveSample(folder, issueName, example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/issue-ticket?lang=en&currency=INR`,
    headers: {
      Authorization: 'Bearer {{auth_token}}',
      'X-Partner-Key': '{{access_token}}',
      'Content-Type': 'application/json',
    },
    body: issueBody,
    status: issue.status, data: issue.data,
  }));

  const br = brOf(issue.data);
  if (!br) {
    console.warn('issue failed', JSON.stringify(issue.data).slice(0, 300));
    return { ok: false, error: 'no BR', data: issue.data };
  }

  const waited = await flight.waitForBookingStatus(br, 30);
  saveSample(folder, '11 Booking Status', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/booking/${br}/status?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: waited.response?.status || 200, data: waited.response?.data || { status: waited.status },
  }));

  const detail = await flight.getBookingDetail(br);
  saveSample(folder, '12 Booking Detail', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/booking/${br}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: detail.status, data: detail.data,
  }));

  const hist = await signedGet(flight.client, '/v1/flights/bookings/history', {
    ...FLIGHT_Q, perpage: 10, page: 1, status: '',
  });
  saveSample(folder, '13 Booking History', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/bookings/history?lang=en&currency=INR&perpage=10&page=1`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: hist.status, data: hist.data,
  }));

  // Cancel chain
  const penalty = await flight.client.request({
    method: 'POST', path: `/v1/flights/booking/${br}/cancel`, query: FLIGHT_Q,
    body: { action: 'PENALTY', retryCount: 2 }, partnerKey: session.accessToken, correlation: true,
  });
  saveSample(folder, '14 Cancellation Penalty Check', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY', retryCount: 2 },
    status: penalty.status, data: penalty.data,
  }));

  const cancel = await flight.client.request({
    method: 'POST', path: `/v1/flights/booking/${br}/cancel`, query: FLIGHT_Q,
    body: { action: 'CANCEL', retryCount: 2 }, partnerKey: session.accessToken, correlation: true,
  });
  saveSample(folder, '15 Cancel', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'CANCEL', retryCount: 2 },
    status: cancel.status, data: cancel.data,
  }));

  const pac = await flight.client.request({
    method: 'POST', path: `/v1/flights/booking/${br}/cancel`, query: FLIGHT_Q,
    body: { action: 'PENALTY_AND_CANCEL', retryCount: 2 }, partnerKey: session.accessToken, correlation: true,
  });
  saveSample(folder, '16 Penalty + Cancel', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY_AND_CANCEL', retryCount: 2 },
    status: pac.status, data: pac.data,
  }));

  console.log('OW done BR', br, 'status', waited.status, 'cancel', cancel.status);
  return { ok: true, br, status: waited.status };
}

async function runRtScenario(session, { folder, adults, children, infants, ancillary }) {
  console.log('\n====', folder, '====');
  const flight = new FlightService(session.client);
  await flightLookups(folder, flight);

  const body = buildRoundTripSearchBody(43, 50, {
    origin: 'DEL', destination: 'BOM', fareType: 'NORMAL', maxStops: null,
  });
  body.travellers = { adults, children, infants };
  body.preferences.airlines = [];

  let search;
  try {
    search = await flight.searchRoundTripUntilComplete(body);
  } catch (e) {
    console.warn('RT search fail', e.message);
    return { ok: false, error: e.message };
  }

  const ids = search.searchIds?.slice(0, 2);
  saveSample(folder, '04 Search RT (onward)', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/search?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { ...body, selection: { selectedSearchIds: [] } },
    status: 200, data: search.response?.data || { searchIds: ids },
  }));

  const returnBody = { ...body, selection: { selectedSearchIds: [ids[0]] } };
  saveSample(folder, '05 Search RT (select onward → return)', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/search?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: returnBody,
    status: 200, data: search.response?.data || { searchIds: ids },
  }));

  if (!ids || ids.length < 2) return { ok: false, error: 'need 2 searchIds' };

  const details = await flight.getDetails(ids, 'ROUND_TRIP');
  saveSample(folder, '06 Details', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/details?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { journeyType: 'ROUND_TRIP', selection: { selectedSearchIds: ids } },
    status: details.status, data: details.data,
  }));

  const rules = await flight.getFareRules(ids, 'ROUND_TRIP');
  saveSample(folder, '07 Fare Rules', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/fareRules?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { journeyType: 'ROUND_TRIP', selection: { selectedSearchIds: ids } },
    status: rules.status, data: rules.data,
  }));

  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  saveSample(folder, '08 Pricing', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/pricing?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { journeyType: 'ROUND_TRIP', selection: { selectedSearchIds: ids } },
    status: pricing.status, data: pricing.data,
  }));
  if (!pricing.ok) return { ok: false, error: 'pricing failed', data: pricing.data };

  const ssr = await flight.getSsr(pricing.data.priceId);
  saveSample(folder, '09 SSR (meals/baggage)', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/ssr?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { priceId: pricing.data.priceId },
    status: ssr.status, data: ssr.data,
  }));

  const seat = await flight.getSeatMap(pricing.data.bookingContext, buildSeatMapPassengers(adultProfile()));
  saveSample(folder, '10 SeatMap', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/seatmap?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { currency: 'INR', requestReference: '{{booking_context}}', passengers: buildSeatMapPassengers(adultProfile()) },
    status: seat.status, data: seat.data,
  }));

  const passengers = mkPassengers(adults, children, infants);
  const issueBody = {
    type: 'ticket', currency: 'INR', language: 'en',
    bookingReference: pricing.data.bookingContext,
    searchIds: ids, journeyType: 'ROUND_TRIP', timezone: 'Asia/Calcutta',
    data: {
      priceId: pricing.data.priceId,
      passportType: pricing.data.passportType || 'NONE',
      includeGst: false, gstDetails: null,
      contact: {
        email: config.flight.contactEmail,
        mobile: config.flight.contactMobile,
        countryCode: config.flight.contactCountryCode,
      },
      passengers,
    },
  };

  const issueName = ancillary ? '11 Issue Ticket (with ancillaries)' : '11 Issue Ticket';
  const issue = await flight.client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...FLIGHT_Q, count: 10, page: 0, perpage: 20 },
    body: issueBody,
    correlation: true,
    partnerKey: session.accessToken,
  });
  saveSample(folder, issueName, example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/issue-ticket?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'X-Partner-Key': '{{access_token}}', 'Content-Type': 'application/json' },
    body: issueBody, status: issue.status, data: issue.data,
  }));

  const br = brOf(issue.data);
  if (!br) return { ok: false, error: 'no BR', data: issue.data };

  const waited = await flight.waitForBookingStatus(br, 30);
  saveSample(folder, '12 Booking Status', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}/status?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: waited.response?.status || 200, data: waited.response?.data || { status: waited.status },
  }));

  const detail = await flight.getBookingDetail(br);
  saveSample(folder, '13 Booking Detail', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: detail.status, data: detail.data,
  }));

  const hist = await signedGet(flight.client, '/v1/flights/bookings/history', {
    ...FLIGHT_Q, perpage: 10, page: 1, status: '',
  });
  saveSample(folder, '14 Booking History', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/flights/bookings/history?lang=en&currency=INR&perpage=10&page=1`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: hist.status, data: hist.data,
  }));

  const penalty = await flight.client.request({
    method: 'POST', path: `/v1/flights/booking/${br}/cancel`, query: FLIGHT_Q,
    body: { action: 'PENALTY', retryCount: 2 }, partnerKey: session.accessToken, correlation: true,
  });
  saveSample(folder, '15 Cancellation Penalty Check', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY', retryCount: 2 }, status: penalty.status, data: penalty.data,
  }));

  const cancel = await flight.client.request({
    method: 'POST', path: `/v1/flights/booking/${br}/cancel`, query: FLIGHT_Q,
    body: { action: 'CANCEL', retryCount: 2 }, partnerKey: session.accessToken, correlation: true,
  });
  saveSample(folder, '16 Cancel', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'CANCEL', retryCount: 2 }, status: cancel.status, data: cancel.data,
  }));

  const pac = await flight.client.request({
    method: 'POST', path: `/v1/flights/booking/${br}/cancel`, query: FLIGHT_Q,
    body: { action: 'PENALTY_AND_CANCEL', retryCount: 2 }, partnerKey: session.accessToken, correlation: true,
  });
  saveSample(folder, '17 Penalty + Cancel', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/flights/booking/{{booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { action: 'PENALTY_AND_CANCEL', retryCount: 2 }, status: pac.status, data: pac.data,
  }));

  console.log('RT done BR', br, waited.status);
  return { ok: true, br, status: waited.status };
}

async function runHotel(session) {
  const folder = 'Hotel > Hotel - Single Booking';
  console.log('\n====', folder, '====');
  const hotel = new HotelService(session.client);
  const client = session.client;

  const ac = await hotel.autocomplete('Pune');
  saveSample(folder, '01 Hotel Autocomplete', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/hotels/autocomplete?lang=en&currency=INR&page=1&perpage=20&q=pune`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: ac.status, data: ac.data,
  }));
  const city = (ac.data?.content || []).find((x) => /CITY/i.test(String(x.type || '')) && /pune/i.test(x.title || ''));
  const entityId = city?.entityId;
  if (!entityId) return { ok: false, error: 'no city' };

  const checkin = futureDate(21);
  const checkout = futureDate(23);
  const searchBody = {
    checkin, checkout, entityId, nationality: 'IN', type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
  const search = await client.request({
    method: 'POST', path: '/v1/hotels/search',
    query: { currency: 'INR', page: 0, perpage: 20, lang: 'en' },
    body: searchBody, correlation: true,
  });
  saveSample(folder, '02 Hotel Search', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/hotels/search?currency=INR&page=0&perpage=20&lang=en`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: searchBody, status: search.status, data: search.data,
  }));

  const hotels = search.data?.content || search.data?.hotels || [];
  const first = hotels[0];
  const hotelId = first?.hotelId || first?.id || first?.entityId;
  const searchId = first?.searchId || first?.hotelSearchId;

  const detailBody = {
    hotelId, searchId, checkin, checkout, nationality: 'IN',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
  const detail = await client.request({
    method: 'POST', path: '/v1/hotels/details',
    query: FLIGHT_Q, body: detailBody, correlation: true,
  });
  saveSample(folder, '03 Hotel Detail', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/hotels/details?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: detailBody, status: detail.status, data: detail.data,
  }));

  const bookingCode = detail.data?.bookingCode || first?.bookingCode;
  const requestId = detail.data?.requestId || crypto.randomUUID();
  const prebookBody = { bookingCode, requestId };
  const prebook = await client.request({
    method: 'POST', path: '/v1/hotels/prebook',
    query: FLIGHT_Q, body: prebookBody, correlation: true,
  });
  saveSample(folder, '04 Hotel Prebook', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/hotels/prebook?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: prebookBody, status: prebook.status, data: prebook.data,
  }));

  const bookingContext = prebook.data?.bookingContext || detail.data?.bookingContext;
  const finalizeBody = {
    bookingContext,
    bookingCode: prebook.data?.bookingCode || bookingCode,
    requestId: prebook.data?.requestId || requestId,
    checkin, checkout,
    rooms: [{
      guests: [{
        title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true,
      }],
    }],
    contact: {
      email: config.flight.contactEmail,
      countryCode: config.flight.contactCountryCode,
      mobile: config.flight.contactMobile,
    },
  };
  const finalize = await client.request({
    method: 'POST', path: '/v1/hotels/finalize-booking',
    query: { ...FLIGHT_Q, page: 0, perpage: 20 },
    body: finalizeBody, correlation: true, partnerKey: session.accessToken,
  });
  saveSample(folder, '05 Hotel Finalize Booking', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/hotels/finalize-booking?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'X-Partner-Key': '{{access_token}}', 'Content-Type': 'application/json' },
    body: finalizeBody, status: finalize.status, data: finalize.data,
  }));

  const br = brOf(finalize.data);
  if (!br) {
    console.warn('hotel finalize no BR', JSON.stringify(finalize.data).slice(0, 400));
    return { ok: false, error: 'no hotel BR', data: finalize.data };
  }

  const status = await signedGet(client, `/v1/hotels/bookings/${br}/status`, FLIGHT_Q);
  saveSample(folder, '06 Hotel Booking Status', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/hotels/bookings/{{hotel_booking_reference}}/status?currency=INR&lang=en`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: status.status, data: status.data,
  }));

  const hDetail = await signedGet(client, `/v1/hotels/bookings/${br}`, FLIGHT_Q);
  saveSample(folder, '07 Hotel Booking Detail', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/hotels/bookings/{{hotel_booking_reference}}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: hDetail.status, data: hDetail.data,
  }));

  const hist = await signedGet(client, '/v1/hotels/bookings/history', { ...FLIGHT_Q, status: 'Confirmed' });
  saveSample(folder, '08 Hotel Booking History', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/hotels/bookings/history?lang=en&currency=INR&status=Confirmed`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: hist.status, data: hist.data,
  }));

  const cancel = await signedGet(client, `/v1/hotels/bookings/${br}/cancel`, FLIGHT_Q);
  saveSample(folder, '09 Hotel Cancel', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/hotels/bookings/{{hotel_booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: cancel.status, data: cancel.data,
  }));

  console.log('Hotel BR', br, 'cancel', cancel.status);
  return { ok: true, br };
}

async function runCab(session) {
  const folder = 'Cab > Cab - Single Booking (AIRPORT DEL)';
  console.log('\n====', folder, '====');
  const cab = new CabService(session.client);
  const client = session.client;

  const loc = await signedGet(client, '/v1/airportServices/cabs/locations', {
    lang: 'en', latitude: 28.5201, longitude: 77.1591,
  });
  saveSample(folder, '01 Cab Locations (optional)', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/airportServices/cabs/locations?lang=en&latitude=28.5201&longitude=77.1591`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: loc.status, data: loc.data,
  }));

  const ac = await signedGet(client, '/v1/airportServices/cabs/places/autocomplete', {
    lang: 'en', searchText: 'vasant kunj',
  });
  saveSample(folder, '02 Places Autocomplete', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/airportServices/cabs/places/autocomplete?lang=en&searchText=vasant%20kunj`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: ac.status, data: ac.data,
  }));
  const placeId = ac.data?.predictions?.[0]?.placeId || ac.data?.content?.[0]?.placeId || ac.data?.[0]?.placeId;

  if (placeId) {
    const pd = await signedGet(client, '/v1/airportServices/cabs/places/details', {
      lang: 'en', placeId,
    });
    saveSample(folder, '03 Place Details', example({
      name: 'Sample', method: 'GET',
      url: `${config.baseUrl}/v1/airportServices/cabs/places/details?lang=en&placeId={{cab_place_id}}`,
      headers: { Authorization: 'Bearer {{auth_token}}' },
      status: pd.status, data: pd.data,
    }));
  } else {
    saveSample(folder, '03 Place Details', example({
      name: 'Sample', method: 'GET',
      url: `${config.baseUrl}/v1/airportServices/cabs/places/details?lang=en&placeId=`,
      headers: { Authorization: 'Bearer {{auth_token}}' },
      status: 0, data: { warning: 'No placeId from autocomplete' },
    }));
  }

  const distBody = {
    pickup: { latitude: 28.5201, longitude: 77.1591 },
    drop: { latitude: 28.5588, longitude: 77.0814 },
  };
  const dist = await client.request({
    method: 'POST', path: '/v1/airportServices/cabs/distance',
    query: { lang: 'en' }, body: distBody, correlation: true,
  });
  saveSample(folder, '04 Distance', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/airportServices/cabs/distance?lang=en`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: distBody, status: dist.status, data: dist.data,
  }));

  const searchBody = buildAirportSearchBody(futurePickupDatetime(9));
  const search = await cab.search(searchBody);
  saveSample(folder, '05 Search AIRPORT', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/airportServices/cabs/search?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: searchBody, status: search.status, data: search.data,
  }));

  const selected = (search.data?.cabs || [])[0];
  if (!selected?.searchId) return { ok: false, error: 'no cab' };

  const fare = await cab.fare(selected.searchId);
  saveSample(folder, '06 Fare', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/airportServices/cabs/fare?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'Content-Type': 'application/json' },
    body: { searchId: selected.searchId }, status: fare.status, data: fare.data,
  }));

  const finalizeBody = {
    bookingReference: fare.data?.bookingReference,
    priceId: fare.data?.priceId,
    passengers: [{
      paxId: 1, paxType: 'ADT', isLead: true,
      profile: {
        title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat',
        gender: 'male', dob: '1998-05-12', nationality: 'IN',
      },
    }],
    contact: {
      email: config.flight.contactEmail,
      countryCode: config.flight.contactCountryCode,
      mobile: config.flight.contactMobile,
    },
    otherDetails: 'QA automation booking',
  };
  const book = await client.request({
    method: 'POST', path: '/v1/airportServices/cabs/finalize-booking',
    query: FLIGHT_Q, body: finalizeBody, correlation: true, partnerKey: session.accessToken,
  });
  saveSample(folder, '07 Finalize Booking', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/airportServices/cabs/finalize-booking?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'X-Partner-Key': '{{access_token}}', 'Content-Type': 'application/json' },
    body: finalizeBody, status: book.status, data: book.data,
  }));

  const br = brOf(book.data);
  if (!br) return { ok: false, error: 'no cab BR', data: book.data };

  const st = await cab.getBookingStatus(br);
  saveSample(folder, '08 Booking Status', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/airportServices/cabs/{{cab_booking_reference}}/status?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: st.status, data: st.data,
  }));

  const det = await signedGet(client, `/v1/airportServices/cabs/booking/${br}`, FLIGHT_Q);
  saveSample(folder, '09 Booking Detail', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/airportServices/cabs/booking/{{cab_booking_reference}}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: det.status, data: det.data,
  }));

  const hist = await signedGet(client, '/v1/airportServices/cabs/booking/history', {
    ...FLIGHT_Q, page: 0, perpage: 10,
  });
  saveSample(folder, '10 Booking History', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/airportServices/cabs/booking/history?lang=en&currency=INR&page=0&perpage=10`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: hist.status, data: hist.data,
  }));

  const track = await signedGet(client, `/v1/airportServices/cabs/tracking/${br}/location`, FLIGHT_Q);
  saveSample(folder, '11 Tracking Location', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/airportServices/cabs/tracking/{{cab_booking_reference}}/location?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: track.status, data: track.data,
  }));

  const cancel = await cab.cancelBooking(br);
  saveSample(folder, '12 Cancel', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/airportServices/cabs/bookings/{{cab_booking_reference}}/cancel?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: cancel.status, data: cancel.data,
  }));

  console.log('Cab BR', br);
  return { ok: true, br };
}

async function runLoungeOrFt(session, kind) {
  const isLounge = kind === 'lounge';
  const folder = isLounge
    ? 'Lounge > Lounge - Single Booking'
    : 'Fast Track > Fast Track - Single Booking';
  console.log('\n====', folder, '====');
  const client = session.client;
  const q = isLounge ? 'dxb' : 'dxb';

  const airportPath = isLounge ? '/v1/airports/search' : '/v1/fasttracks/airports/search';
  const airports = await signedGet(client, airportPath, {
    ...FLIGHT_Q, page: 0, perpage: 20, q,
  });
  saveSample(folder, '01 Airport Search', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}${airportPath}?lang=en&currency=INR&page=0&perpage=20&q=${q}`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: airports.status, data: airports.data,
  }));

  const airportId =
    airports.data?.content?.[0]?.id
    || airports.data?.content?.[0]?.airportId
    || airports.data?.airports?.[0]?.id
    || airports.data?.[0]?.id;

  if (!airportId) {
    console.warn(kind, 'no airportId');
    return { ok: false, error: 'no airport' };
  }

  const listPath = isLounge ? '/v1/lounges' : '/v1/fasttracks';
  const listQuery = isLounge
    ? { ...FLIGHT_Q, page: 0, perpage: 5, airportId, terminal: 'Terminal 1' }
    : { ...FLIGHT_Q, page: 0, perpage: 5, airportId, terminal: 'Terminal 2', terminalSide: 'Departure' };
  const list = await signedGet(client, listPath, listQuery);
  saveSample(folder, isLounge ? '02 Lounge List' : '02 Fast Track List', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}${listPath}?${new URLSearchParams(listQuery)}`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: list.status, data: list.data,
  }));

  const item =
    list.data?.content?.[0]
    || list.data?.lounges?.[0]
    || list.data?.fasttracks?.[0]
    || list.data?.[0];
  const id = item?.id || item?.loungeId || item?.fasttrackId;
  const optionId = item?.optionId || item?.options?.[0]?.optionId || item?.options?.[0]?.id;
  if (!id) return { ok: false, error: 'no product' };

  const det = await signedGet(client, `${listPath}/${id}`, { ...FLIGHT_Q, optionId });
  saveSample(folder, isLounge ? '03 Lounge Details' : '03 Fast Track Details', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}${listPath}/${id}?lang=en&currency=INR&optionId=${optionId || ''}`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: det.status, data: det.data,
  }));

  const bookingContext =
    det.data?.bookingContext
    || det.data?.data?.bookingContext
    || item?.bookingContext
    || det.data?.options?.[0]?.bookingContext;

  if (!bookingContext) {
    console.warn(kind, 'no bookingContext — skip book');
    return { ok: false, error: 'no bookingContext' };
  }

  const travelDate = futureDate(30);
  const bookBody = {
    bookingContext,
    travelDate,
    travelTime: '07:20',
    passengers: [{
      paxType: 'ADT', isLead: true,
      profile: {
        title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat',
        gender: 'MALE', dob: '1998-05-12', nationality: 'IN',
      },
    }],
    contact: {
      email: config.flight.contactEmail,
      countryCode: config.flight.contactCountryCode,
      mobile: config.flight.contactMobile,
    },
  };
  const finalizePath = isLounge
    ? '/v1/airportServices/lounges/finalize-booking'
    : '/v1/airportServices/fasttracks/finalize-booking';
  const book = await client.request({
    method: 'POST', path: finalizePath, query: FLIGHT_Q,
    body: bookBody, correlation: true, partnerKey: session.accessToken,
  });
  saveSample(folder, isLounge ? '04 Lounge Finalize Booking' : '04 Fast Track Finalize Booking', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}${finalizePath}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'X-Partner-Key': '{{access_token}}', 'Content-Type': 'application/json' },
    body: bookBody, status: book.status, data: book.data,
  }));

  const br = brOf(book.data);
  if (!br) return { ok: false, error: 'no BR', data: book.data };

  const statusPath = isLounge
    ? `/v1/airportServices/lounge/${br}/status`
    : `/v1/airportServices/fasttrack/${br}/status`;
  const st = await signedGet(client, statusPath, FLIGHT_Q);
  saveSample(folder, isLounge ? '05 Lounge Booking Status' : '05 Fast Track Booking Status', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}${statusPath}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: st.status, data: st.data,
  }));

  const detailPath = isLounge
    ? `/v1/airportServices/lounge/booking/${br}`
    : `/v1/airportServices/fasttrack/booking/${br}`;
  const det2 = await signedGet(client, detailPath, FLIGHT_Q);
  saveSample(folder, isLounge ? '06 Lounge Booking Detail' : '06 Fast Track Booking Detail', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}${detailPath}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: det2.status, data: det2.data,
  }));

  const histPath = isLounge
    ? '/v1/airportServices/lounge/booking/history'
    : '/v1/airportServices/fasttrack/booking/history';
  const hist = await signedGet(client, histPath, { ...FLIGHT_Q, page: 0, perpage: 10 });
  saveSample(folder, isLounge ? '07 Lounge Booking History' : '07 Fast Track Booking History', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}${histPath}?lang=en&currency=INR&page=0&perpage=10`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: hist.status, data: hist.data,
  }));

  console.log(kind, 'BR', br);
  return { ok: true, br };
}

async function runEsim(session) {
  const folder = 'eSIM > eSIM - Single Booking';
  console.log('\n====', folder, '====');
  const client = session.client;

  const search = await signedGet(client, '/v1/esim/search', {
    ...FLIGHT_Q, page: 1, perpage: 20, q: 'united states',
  });
  saveSample(folder, '01 eSIM Search', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/esim/search?lang=en&currency=INR&page=1&perpage=20&q=united%20states`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: search.status, data: search.data,
  }));

  const product =
    search.data?.content?.[0]
    || search.data?.results?.[0]
    || search.data?.[0];
  const productId = product?.id || product?.productId || product?.slug;
  const optionId = product?.optionId || product?.options?.[0]?.optionId || product?.options?.[0]?.id;
  if (!productId) return { ok: false, error: 'no esim product' };

  const listing = await signedGet(client, `/v1/esims/${productId}`, { ...FLIGHT_Q, optionId });
  saveSample(folder, '02 eSIM Listing / Details', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/esims/{{esim_product_id}}?lang=en&currency=INR&optionId={{esim_option_id}}`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: listing.status, data: listing.data,
  }));

  const bookingContext =
    listing.data?.bookingContext
    || listing.data?.data?.bookingContext
    || listing.data?.options?.[0]?.bookingContext;
  if (!bookingContext) return { ok: false, error: 'no esim bookingContext' };

  const bookBody = {
    bookingContext,
    passengers: [{
      paxType: 'ADT',
      profile: {
        title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat',
        gender: 'MALE', dob: '1998-05-12', nationality: 'IN',
      },
    }],
    contact: {
      email: config.flight.contactEmail,
      countryCode: config.flight.contactCountryCode,
      mobile: config.flight.contactMobile,
    },
  };
  const book = await client.request({
    method: 'POST', path: '/v1/esims/finalize-booking', query: FLIGHT_Q,
    body: bookBody, correlation: true, partnerKey: session.accessToken,
  });
  saveSample(folder, '03 eSIM Finalize Booking', example({
    name: 'Sample', method: 'POST',
    url: `${config.baseUrl}/v1/esims/finalize-booking?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}', 'X-Partner-Key': '{{access_token}}', 'Content-Type': 'application/json' },
    body: bookBody, status: book.status, data: book.data,
  }));

  const br = brOf(book.data);
  if (!br) return { ok: false, error: 'no esim BR', data: book.data };

  const st = await signedGet(client, `/v1/esim/${br}/status`, FLIGHT_Q);
  saveSample(folder, '04 eSIM Booking Status', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/esim/{{esim_booking_reference}}/status?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: st.status, data: st.data,
  }));

  const det = await signedGet(client, `/v1/esim/booking/${br}`, FLIGHT_Q);
  saveSample(folder, '05 eSIM Booking Detail', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/esim/booking/{{esim_booking_reference}}?lang=en&currency=INR`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: det.status, data: det.data,
  }));

  const hist = await signedGet(client, '/v1/esim/booking/history', { ...FLIGHT_Q, page: 0, perpage: 10 });
  saveSample(folder, '06 eSIM Booking History', example({
    name: 'Sample', method: 'GET',
    url: `${config.baseUrl}/v1/esim/booking/history?lang=en&currency=INR&page=0&perpage=10`,
    headers: { Authorization: 'Bearer {{auth_token}}' },
    status: hist.status, data: hist.data,
  }));

  console.log('eSIM BR', br);
  return { ok: true, br };
}

async function main() {
  console.log('Base', config.baseUrl);
  console.log('Live capture WITH booking + cancellation; inject samples into collection');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);

  const results = {};
  results.partner = await runPartner(session);

  // Re-run failed multi-pax + ancillary only (1A already captured)
  const ONLY_FAILED = process.env.CAPTURE_ONLY_FAILED === '1';

  if (!ONLY_FAILED) {
  results.ow1a = await runOwScenario(session, {
    folder: 'Flight > OW > OW - 1 Adult',
    adults: 1, children: 0, infants: 0, ancillary: false,
  });
  await sleep(1000);
  }

  results.owFamily = await runOwScenario(session, {
    folder: 'Flight > OW > OW - 1 Adult 1 Child 1 Infant',
    adults: 1, children: 1, infants: 1, ancillary: false,
  });
  await sleep(1000);

  results.owAnc = await runOwScenario(session, {
    folder: 'Flight > OW > OW - 1 Adult 1 Child + Ancillary (seat/meal/bag)',
    adults: 1, children: 1, infants: 0, ancillary: true,
  });
  await sleep(1000);

  if (!ONLY_FAILED) {
  results.rt1a = await runRtScenario(session, {
    folder: 'Flight > Round Trip > RT - 1 Adult',
    adults: 1, children: 0, infants: 0, ancillary: false,
  });
  await sleep(1000);
  }

  results.rtFamily = await runRtScenario(session, {
    folder: 'Flight > Round Trip > RT - 1 Adult 1 Child 1 Infant',
    adults: 1, children: 1, infants: 1, ancillary: false,
  });
  await sleep(1000);

  results.rtAnc = await runRtScenario(session, {
    folder: 'Flight > Round Trip > RT - 1 Adult 1 Child + Ancillary (seat/meal/bag)',
    adults: 1, children: 1, infants: 0, ancillary: true,
  });

  results.hotel = await runHotel(session);
  if (!ONLY_FAILED) {
  results.cab = await runCab(session);
  }
  results.lounge = await runLoungeOrFt(session, 'lounge');
  results.ft = await runLoungeOrFt(session, 'ft');
  results.esim = await runEsim(session);

  const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));
  const injected = injectSamples(collection);
  fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2));

  const report = {
    ranAt: new Date().toISOString(),
    env: config.baseUrl,
    samplesCaptured: samplesByPath.size,
    injected,
    results,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n===== DONE =====');
  console.log('samples', samplesByPath.size, 'injected', injected);
  console.log('collection', COLLECTION_PATH);
  console.log('report', REPORT_PATH);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

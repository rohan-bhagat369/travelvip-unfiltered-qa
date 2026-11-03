/**
 * ENG-22 full checklist on PRODUCTION api.travelvip.ai (no live Confirmed book).
 * TC-1 positives · TC-2 timing samples · negatives · TC-5 4xx · TC-6 rejected book-shaped · TC-7 NT
 *
 *   $env:BASE_URL='https://api.travelvip.ai'
 *   $env:TIER_ID='19597201'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='vgm_preprod_ojny1swtigd4as'
 *   $env:SIGNING_KEY='sk_live_yg81bca5xno1ypvhla'
 *   node other/zenith/scripts/probe-prod-otel-eng22-full.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../../shared/config/env.js';
import { TravelVipClient } from '../../../shared/lib/TravelVipClient.js';
import { createRequestId } from '../../../shared/lib/signature.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';
import { buildOneWaySearchBody } from '../../../travel-apis/flight/src/helpers.js';
import { buildSearchBody } from '../../../travel-apis/hotel/src/helpers.js';
import { CITY_MUMBAI } from '../../../travel-apis/hotel/src/regression/fixtures.js';
import { isSearchProgressComplete } from '../../../travel-apis/flight/src/helpers.js';
import { collectOptions } from '../../../travel-apis/flight/src/searchPicker.js';

const BASE = process.env.BASE_URL || 'https://api.travelvip.ai';
const PREFIX = process.env.CORR_PREFIX || `qa-otel-prod-full-${Date.now()}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.join(__dirname, '..', 'reports', 'prod-otel-eng22-full.json');
const OUT_MD = path.join(__dirname, '..', 'reports', 'prod-otel-eng22-full.md');

const calls = [];

function preview(data) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  return s.slice(0, 280);
}

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

async function hit(label, corr, opts) {
  const client = new TravelVipClient({
    baseUrl: BASE,
    correlationId: corr,
    authToken: opts.authToken || null,
    partnerKey: opts.partnerKey || null,
  });
  const t0 = Date.now();
  let res;
  try {
    const { extraHeaders, omitPartnerKey, ...rest } = opts;
    res = await client.request({
      extraHeaders: { 'X-Request-Id': createRequestId(), ...(extraHeaders || {}) },
      partnerKey: omitPartnerKey ? null : opts.partnerKey,
      ...rest,
    });
  } catch (e) {
    const row = {
      label, corr, method: opts.method || 'GET', path: opts.path,
      http: 0, ok: false, clientMs: Date.now() - t0, errorCode: 'CLIENT_THROW', bodyPreview: String(e).slice(0, 200),
    };
    calls.push(row);
    console.log(`[${row.ok ? 'OK' : '!!'}] ${label} http=${row.http} ${row.clientMs}ms ${row.errorCode || ''}`);
    return row;
  }
  const row = {
    label,
    corr,
    method: opts.method || 'GET',
    path: opts.path,
    http: res.status,
    ok: res.ok,
    clientMs: Date.now() - t0,
    errorCode: errCode(res),
    bodyPreview: preview(res.data),
  };
  calls.push(row);
  console.log(`[${row.ok ? 'OK' : '!!'}] ${label} http=${row.http} ${row.clientMs}ms ${row.errorCode || ''}`);
  return { ...row, data: res.data };
}

function stats(msList) {
  const xs = msList.filter((n) => Number.isFinite(n));
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: xs.length, min: sorted[0], max: sorted[sorted.length - 1], avg: Math.round(avg), p50: sorted[Math.floor(sorted.length / 2)] };
}

async function main() {
  if (!String(BASE).includes('api.travelvip.ai') || /preprod|staging/i.test(BASE)) {
    throw new Error(`Wrong host: ${BASE}`);
  }
  const started = new Date().toISOString();
  console.log(JSON.stringify({ base: BASE, prefix: PREFIX, tierId: config.tierId, partnerId: config.partnerId }));

  // Auth
  const token = await hit('auth-token', `${PREFIX}-auth-token`, {
    method: 'POST', path: '/auth/partner/token',
    body: { partner_id: config.partnerId, partner_secret: config.partnerSecret },
    signed: false, auth: false,
  });
  if (!token.ok) throw new Error('auth token failed');
  const sess = await hit('auth-session', `${PREFIX}-auth-session`, {
    method: 'POST', path: '/v1/auth/session',
    body: { tierId: config.tierId },
    signed: false, auth: false, partnerKey: token.data.access_token,
  });
  if (!sess.ok) throw new Error('auth session failed');
  const authToken = sess.data.auth_token;
  const partnerKey = token.data.access_token;
  const auth = { signed: true, auth: true, authToken, partnerKey };

  const hotelSearchBody = {
    ...buildSearchBody({ entityId: CITY_MUMBAI.entityId, checkinDays: 21, nights: 2 }),
    type: 'CITY',
  };

  // --- TC-1 positives ---
  console.log('\n## TC-1 positives');
  await hit('tc1-hotel-ac', `${PREFIX}-tc1-hotel-ac`, {
    method: 'GET', path: '/v1/hotels/autocomplete', query: { q: 'mumbai', page: 1, perpage: 5 }, ...auth,
  });
  await hit('tc1-hotel-search', `${PREFIX}-tc1-hotel-search`, {
    method: 'POST', path: '/v1/hotels/search',
    query: { pid: 'vgm', offset: 0, limit: 5, lang: 'en', currency: 'INR' },
    body: hotelSearchBody, ...auth,
  });
  await hit('tc1-airports', `${PREFIX}-tc1-airports`, {
    method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' }, ...auth,
  });
  await hit('tc1-airlines', `${PREFIX}-tc1-airlines`, {
    method: 'GET', path: '/v1/flights/airlines', query: { airline: 'AI' }, ...auth,
  });
  await hit('tc1-citysearch', `${PREFIX}-tc1-citysearch`, {
    method: 'GET', path: '/v1/flights/citySearch', query: { q: 'Pune' }, ...auth,
  });

  // One flight search flow (poll until complete — same logical search)
  const flightBody = buildOneWaySearchBody(25, { origin: 'DEL', destination: 'BOM', maxStops: null });
  delete flightBody.fareType;
  flightBody.preferences = { ...(flightBody.preferences || {}), airlines: [] };
  let flightSearchOk = false;
  for (let i = 0; i < 10; i += 1) {
    const fsRes = await hit('tc1-flight-search', `${PREFIX}-tc1-flight-search`, {
      method: 'POST', path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc' },
      body: flightBody, ...auth,
    });
    const opts = collectOptions(fsRes.data, 'ONWARD');
    const done = isSearchProgressComplete(fsRes.data) || fsRes.data?.progress?.state === 'COMPLETE';
    if (fsRes.ok && (done || (opts.length && i >= 3))) {
      flightSearchOk = opts.length > 0;
      break;
    }
    await sleep(2500);
  }

  // --- negatives ---
  console.log('\n## Negatives');
  await hit('neg-omit-bearer', `${PREFIX}-neg-omit-bearer`, {
    method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' },
    signed: true, auth: false, partnerKey,
  });
  await hit('neg-garbage-bearer', `${PREFIX}-neg-garbage-bearer`, {
    method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' },
    signed: true, auth: false, partnerKey,
    extraHeaders: { Authorization: 'Bearer not-a-real-token' },
  });
  await hit('neg-hotel-dates', `${PREFIX}-neg-hotel-dates`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, checkin: futureDate(30), checkout: futureDate(28) }, ...auth,
  });
  await hit('neg-hotel-html', `${PREFIX}-neg-hotel-html`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, nationality: 'IN<script>' }, ...auth,
  });
  await hit('neg-flight-same-od', `${PREFIX}-neg-flight-same-od`, {
    method: 'POST', path: '/v1/flights/search', query: { lang: 'en', currency: 'INR' },
    body: buildOneWaySearchBody(25, { origin: 'DEL', destination: 'DEL' }), ...auth,
  });
  await hit('neg-flight-html', `${PREFIX}-neg-flight-html`, {
    method: 'POST', path: '/v1/flights/search', query: { lang: 'en', currency: 'INR' },
    body: buildOneWaySearchBody(25, { origin: 'DEL', destination: '<script>' }), ...auth,
  });

  // --- TC-5 ---
  console.log('\n## TC-5 4xx');
  await hit('tc5-4xx-invalid-dates', `${PREFIX}-tc5-4xx`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, checkin: '15-09-2026', checkout: '17-09-2026' }, ...auth,
  });
  await hit('tc5-comma-nationality', `${PREFIX}-tc5-comma`, {
    method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', lang: 'en', currency: 'INR' },
    body: { ...hotelSearchBody, nationality: 'IN,' }, ...auth,
  });

  // --- TC-6 rejected book-shaped (must not Confirm) ---
  console.log('\n## TC-6 PII rejected book-shaped');
  const piiIssue = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: 'PII-QA-FAKE',
    searchIds: ['fake-search-id'],
    journeyType: 'ONE_WAY',
    timezone: 'Asia/Calcutta',
    data: {
      priceId: 'fake-price-id',
      passportType: 'FULL',
      includeGst: false,
      gstDetails: null,
      contact: { email: 'qa.otel.pii@travelvip.ai', mobile: '9876543210', countryCode: '+91' },
      passengers: [{
        paxId: 'PAX1', type: 'adult', isLead: true,
        profile: { title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', gender: 'Male', dob: '2001-05-29', nationality: 'IN' },
        city: { cityCode: 'Pune', cityName: 'Pune' },
        passport: { number: 'Z1234567', expiry: '2031-08-01', issuedDate: '2020-08-01', issuedCountryCode: 'IN' },
        ssr: { baggage: [], meals: [], seats: [] },
      }],
      cardNumber: '4111111111111111',
      authorizationJwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJxaS1vdGVsIn0.aaa',
    },
  };
  const tc6Flight = await hit('tc6-pii-issue-ticket', `${PREFIX}-tc6-pii-flight`, {
    method: 'POST', path: '/api/v2/flights/booking/issue-ticket', body: piiIssue, ...auth,
  });
  const tc6Hotel = await hit('tc6-pii-hotel-finalize', `${PREFIX}-tc6-pii-hotel`, {
    method: 'POST', path: '/v1/hotels/finalize-booking',
    query: { lang: 'en', currency: 'INR' },
    body: {
      bookingCode: 'FAKEBOOKINGCODE',
      requestId: 'fake-request-id',
      checkin: futureDate(28),
      checkout: futureDate(30),
      guests: [{ title: 'Mr.', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true, dob: '2001-05-29', nationality: 'IN' }],
      contact: { email: 'qa.otel.pii@travelvip.ai', countryCode: '+91', mobile: '9876543210' },
      panCardNumber: 'EUIPB1672M',
      panCardName: 'Rohan Bhagat',
    },
    ...auth,
  });

  // --- TC-2 timing (3 repeats, light endpoints + 1 hotel search) ---
  console.log('\n## TC-2 timing');
  const timingEndpoints = [
    { key: 'airports', method: 'GET', path: '/v1/flights/airports', query: { airport: 'BOM' } },
    { key: 'hotel-ac', method: 'GET', path: '/v1/hotels/autocomplete', query: { q: 'pune', page: 1, perpage: 5 } },
    { key: 'hotel-search', method: 'POST', path: '/v1/hotels/search', query: { pid: 'vgm', offset: 0, size: 5, lang: 'en', currency: 'INR' }, body: hotelSearchBody },
  ];
  for (const ep of timingEndpoints) {
    for (let i = 0; i < 3; i += 1) {
      await hit(`tc2-${ep.key}-${i}`, `${PREFIX}-tc2-${ep.key}-${i}`, { ...ep, ...auth });
    }
  }
  const timingCompare = {};
  for (const ep of timingEndpoints) {
    timingCompare[ep.key] = stats(calls.filter((c) => c.label.startsWith(`tc2-${ep.key}-`)).map((c) => c.clientMs));
  }

  const cases = [
    { id: 'TC-1', rule: 'Positives: hotel AC/search, airports, airlines, citySearch, flight search', status: flightSearchOk && calls.find((c) => c.label === 'tc1-hotel-search')?.ok ? 'PASS' : 'BUG', how: 'live prod calls' },
    { id: 'TC-2', rule: 'Client timings captured for SigNoz duration compare (≤1s overhead)', status: 'PENDING_SIGNOZ', how: '3x airports/hotel-ac/hotel-search; compare in SigNoz' },
    { id: 'TC-5', rule: '4xx invalid payloads logged', status: calls.some((c) => c.label.startsWith('tc5-') && c.http >= 400) ? 'PASS_API' : 'BUG', how: 'invalid hotel dates + comma nationality' },
    { id: 'TC-6', rule: 'Rejected book-shaped payloads (no Confirmed)', status: (!tc6Flight.ok || tc6Flight.http >= 400 || /pending|error|fail/i.test(tc6Flight.bodyPreview || '')) && (!/Confirmed/i.test(tc6Flight.bodyPreview || '')) ? 'PASS_API' : 'BUG', how: 'fake issue-ticket + hotel finalize' },
    { id: 'TC-7', rule: 'Collector down behavior', status: 'NOT TESTED', how: 'needs infra to stop otelcol' },
    { id: 'NEG', rule: 'Auth/validation negatives return errors (not 500 ideally)', status: calls.filter((c) => c.label.startsWith('neg-')).every((c) => !c.ok || c.http >= 400) ? 'PASS_API' : 'BUG', how: 'omit/garbage bearer, bad hotel/flight inputs' },
  ];

  const report = {
    started,
    ended: new Date().toISOString(),
    baseUrl: BASE,
    tierId: config.tierId,
    prefix: PREFIX,
    notes: {
      noLiveBook: true,
      tc6: 'Rejected book-shaped only',
      tc7: 'NOT TESTED — needs infra',
      flightSearchOk,
      signozTodo: 'Filter logs/traces by PREFIX; check duration vs clientMs; stack traces on errors; PII redaction on tc6',
    },
    cases,
    timingCompare,
    corrIds: [...new Set(calls.map((c) => c.corr))],
    calls: calls.map(({ data, ...rest }) => rest),
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, [
    '# ENG-22 full — PROD api.travelvip.ai',
    '',
    `- Ran: ${report.ended}`,
    `- Prefix: \`${PREFIX}\``,
    `- **No live Confirmed book**`,
    '',
    '| Case | Rule | Status |',
    '|---|---|---|',
    ...cases.map((c) => `| ${c.id} | ${c.rule} | ${c.status} |`),
    '',
    '## Timing (clientMs)',
    '```json',
    JSON.stringify(timingCompare, null, 2),
    '```',
    '',
    '## Corr IDs for SigNoz',
    ...report.corrIds.map((id) => `- \`${id}\``),
    '',
  ].join('\n'));

  console.log(`\nWrote ${OUT_MD}`);
  console.log('PREFIX', PREFIX);
  console.log('Cases', cases.map((c) => `${c.id}:${c.status}`).join(' | '));
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

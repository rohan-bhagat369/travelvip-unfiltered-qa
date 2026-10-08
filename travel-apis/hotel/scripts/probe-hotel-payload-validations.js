/**
 * Hotel payload validations — Search / Details / Prebook / Finalize
 * Docs: VALIDATION_ERROR + HTTP 400 + details[] for every rule.
 *
 * Run: node scripts/probe-hotel-payload-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  HOTEL_QUERY,
  buildSearchBody,
  buildDetailsBody,
  extractRequestId,
  extractBookingCodes,
  extractBookingContext,
} from '../src/helpers.js';
import { futureDate } from '../../../shared/lib/testUtils.js';
import { GST as GST_FIXTURE } from '../src/regression/fixtures.js';

const OUT = path.join(
  'reports',
  process.env.HOTEL_VAL_OUT || 'hotel-payload-validations-staging.json',
);
const FIN_PATH = '/api/v2/hotels/finalize-booking';

const API_BY_SECTION = {
  'A. Search': 'POST /v1/hotels/search',
  'B. Details': 'POST /v1/hotels/details',
  'C. Prebook': 'POST /v1/hotels/prebook',
  Setup: 'search → details → POST /v1/hotels/prebook',
  'Finalize baseline': `POST ${FIN_PATH}`,
  Finalize: `POST ${FIN_PATH}`,
  '1. Stay dates': `POST ${FIN_PATH}`,
  '2. Guests': `POST ${FIN_PATH}`,
  '3. Contact': `POST ${FIN_PATH}`,
  '4. GST': `POST ${FIN_PATH}`,
  'Error envelope': `POST ${FIN_PATH}`,
};

function apiOf(section) {
  return API_BY_SECTION[section] || section;
}

function titledRule(section, rule) {
  if (String(rule).startsWith('POST ') || String(rule).includes(' — ')) return rule;
  return `${apiOf(section)} — ${rule}`;
}

const rows = [];
const bugs = [];

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

function errDetails(res) {
  const d = res?.data?.error?.details;
  return Array.isArray(d) ? d : [];
}

function brief(res, n = 400) {
  try {
    return JSON.stringify(res?.data).slice(0, n);
  } catch {
    return String(res?.data);
  }
}

function hasEnvelope(res) {
  const e = res?.data?.error;
  return Boolean(e && e.code && e.message != null && Array.isArray(e.details) && e.timestamp && e.request_id);
}

let finalizeNonce = 0;
/** Unique-ize finalize payload so duplicate-cache cannot return a prior success. */
function uniquifyFinalize(body) {
  finalizeNonce += 1;
  const n = String(finalizeNonce).padStart(3, '0');
  const b = clone(body);
  // letters-only names
  if (b.rooms?.[0]?.guests?.[0]) {
    b.rooms[0].guests[0].lastName = `BhagatTest${n}`.replace(/\d/g, (d) => 'ABCDEFGHIJ'[Number(d)]);
  }
  if (b.contact) {
    b.contact.email = `hotel.val.${finalizeNonce}@travelvip.ai`;
  }
  return b;
}

/** Expect rejection: HTTP 400 + VALIDATION_ERROR (+ optional detail hint) */
function expectReject(section, rule, res, hintRe = null) {
  const code = errCode(res);
  const det = errDetails(res);
  const http400 = res.status === 400;
  const body400 = res.data?.status === 400 || res.data?.statusCode === 400;
  const valErr = code === 'VALIDATION_ERROR';
  const msgBlob = [
    ...det,
    res.data?.error?.message,
    res.data?.message,
    res.data?.detail,
    typeof res.data?.checkin === 'string' ? res.data.checkin : '',
    typeof res.data?.checkout === 'string' ? res.data.checkout : '',
  ].filter(Boolean).join(' | ');
  const hintOk = !hintRe || hintRe.test(msgBlob) || hintRe.test(brief(res));
  const booked = Boolean(res.data?.bookingRefId || res.data?.bookingReference);
  const dup = Boolean(res.data?.duplicate);
  let status = 'PASS';
  let note = '';

  if ((res.status || 0) >= 500) {
    status = 'BUG';
    note = `HTTP ${res.status} Internal Server Error — invalid payload must return HTTP 400 VALIDATION_ERROR, never 500`;
  } else if (http400 && valErr && hintOk && Array.isArray(res.data?.error?.details)) {
    status = 'PASS';
    note = 'HTTP 400 VALIDATION_ERROR + details[]';
  } else if (http400 && valErr && !Array.isArray(res.data?.error?.details)) {
    status = 'BUG';
    note = `VALIDATION_ERROR but details is ${JSON.stringify(res.data?.error?.details)} (must be array)`;
  } else if (http400 && valErr && !hintOk) {
    status = 'BUG';
    note = `Wrong/missing detail. msg=${msgBlob.slice(0, 200)}`;
  } else if (dup && booked) {
    status = 'BUG';
    note = `duplicate:true returned prior BR ${res.data.bookingRefId || res.data.bookingReference} — validation skipped`;
  } else if (booked || (res.ok && !body400 && !valErr && !res.data?.message?.match?.(/required|invalid|must/i))) {
    status = 'BUG';
    note = booked
      ? `Invalid payload created/returned booking ${res.data.bookingRefId || res.data.bookingReference}`
      : `Accepted invalid payload HTTP ${res.status}`;
  } else if (!http400 && (body400 || /required|invalid|must|date/i.test(msgBlob))) {
    status = 'BUG';
    note = `Error returned as HTTP ${res.status} with legacy body (expected real HTTP 400 + VALIDATION_ERROR envelope). msg=${msgBlob.slice(0, 180)}`;
  } else {
    status = 'BUG';
    note = `Expected HTTP 400 VALIDATION_ERROR; got HTTP ${res.status} code=${code}`;
  }

  rows.push({
    section,
    api: apiOf(section),
    rule: titledRule(section, rule),
    how: `Clone a valid ${section} payload, change only this: ${rule}, then ${apiOf(section)}.`,
    expected: 'HTTP 400 VALIDATION_ERROR + details[] (never HTTP 500)',
    actual: `HTTP ${res.status} code=${code} bodyStatus=${res.data?.status ?? res.data?.statusCode ?? '-'} details=${JSON.stringify(det).slice(0, 160)} msg=${msgBlob.slice(0, 120)}`,
    status,
    note,
    responseSnippet: brief(res, 500),
  });
  if (status === 'BUG') bugs.push({ section, rule: titledRule(section, rule), note, response: brief(res, 800) });
}

/** Extra comma / special chars: 4xx + error.code = PASS; HTTP 500 or HTTP 200 = BUG */
function expectNoServerCrash(section, rule, res) {
  const code = errCode(res);
  const crash = (res.status || 0) >= 500;
  const accepted = res.ok || res.status === 200;
  const clientErr = res.status >= 400 && res.status < 500 && Boolean(code || res.data?.error);
  let status = 'PASS';
  let note = `HTTP ${res.status} code=${code}`;
  if (crash) {
    status = 'BUG';
    note = `HTTP ${res.status} Internal Server Error after special chars — expected 4xx error envelope`;
  } else if (accepted) {
    status = 'BUG';
    note = 'Accepted payload that added extra special characters / comma';
  } else if (clientErr) {
    status = 'PASS';
    note = `HTTP ${res.status} code=${code} (valid client error, not 500)`;
  } else if (res.status >= 400 && res.status < 500) {
    status = 'PASS';
    note = `HTTP ${res.status} (4xx, not 500)`;
  } else {
    status = 'BUG';
    note = `Expected 4xx error; got HTTP ${res.status} code=${code}`;
  }
  rows.push({
    section,
    api: apiOf(section),
    rule: titledRule(section, rule),
    how: `Clone a valid ${section} payload, add extra comma/special chars (${rule}), then ${apiOf(section)}.`,
    expected: 'HTTP 4xx with error.code (never HTTP 500)',
    actual: note,
    status,
    note,
    responseSnippet: brief(res, 500),
  });
  if (status === 'BUG') bugs.push({ section, rule: titledRule(section, rule), note, response: brief(res, 800) });
}

/** Expect accept (not a validation failure) */
function expectAccept(section, rule, res) {
  const code = errCode(res);
  const rejected = res.status === 400 && code === 'VALIDATION_ERROR';
  const status = rejected ? 'BUG' : (res.ok || res.status < 500 ? 'PASS' : 'BUG');
  rows.push({
    section,
    api: apiOf(section),
    rule: titledRule(section, rule),
    how: `Clone a valid ${section} payload, apply: ${rule}, then ${apiOf(section)}.`,
    expected: 'Accepted (not VALIDATION_ERROR, not HTTP 500)',
    actual: `HTTP ${res.status} code=${code}`,
    status: rejected ? 'BUG' : status,
    note: rejected ? 'Incorrectly rejected as VALIDATION_ERROR' : 'OK',
    responseSnippet: brief(res, 300),
  });
  if (status === 'BUG' || rejected) bugs.push({ section, rule: titledRule(section, rule), note: 'unexpected', response: brief(res, 800) });
}

async function search(client, body) {
  return client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
    body,
    correlation: true,
  });
}

async function detailsCall(client, body) {
  return client.request({
    method: 'POST',
    path: '/v1/hotels/details',
    query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
    body,
    correlation: true,
  });
}

async function prebook(client, body) {
  return client.request({
    method: 'POST',
    path: '/v1/hotels/prebook',
    query: HOTEL_QUERY,
    body,
    correlation: true,
  });
}

async function finalize(client, body) {
  return client.request({
    method: 'POST',
    path: FIN_PATH,
    query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

function adultGuest(overrides = {}) {
  return {
    title: 'Mr',
    firstName: config.hotel.guestFirstName || 'Rohan',
    lastName: config.hotel.guestLastName || 'Bhagat',
    type: 'Adult',
    isLead: true,
    ...overrides,
  };
}

function childGuest(overrides = {}) {
  return {
    title: 'Mstr',
    firstName: 'Arjun',
    lastName: 'Patil',
    type: 'Child',
    age: 8,
    isLead: false,
    ...overrides,
  };
}

function contactBase(overrides = {}) {
  // Hilltop (and many IN rates) require PAN; name must match lead guest.
  return {
    email: config.hotel.contactEmail,
    countryCode: config.hotel.contactCountryCode || '+91',
    mobile: config.hotel.contactMobile || '9876543210',
    panCardNumber: 'EUIPB1672M',
    panCardName: `${config.hotel.guestFirstName || 'Rohan'} ${config.hotel.guestLastName || 'Bhagat'}`,
    ...overrides,
  };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Probing hotel validations…');

  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);

  // ─── Valid baselines ───
  const searchBase = buildSearchBody({
    checkinDays: 30,
    nights: 2,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  // Ensure numbers not strings
  searchBase.rooms[0].adults = 1;
  searchBase.rooms[0].children = 0;

  console.log('\n=== A. Search baseline ===');
  const searchOk = await search(client, searchBase);
  rows.push({
    section: 'A. Search',
    api: apiOf('A. Search'),
    rule: titledRule('A. Search', 'valid search body with YYYY-MM-DD checkin/checkout and 1 adult'),
    how: 'POST /v1/hotels/search with a complete valid catalog search (entityId + dates + 1 adult). This is the baseline for the mutations below.',
    expected: 'HTTP 2xx (not VALIDATION_ERROR)',
    actual: `HTTP ${searchOk.status}`,
    status: searchOk.ok ? 'PASS' : 'BUG',
    note: searchOk.ok ? '' : brief(searchOk),
    responseSnippet: brief(searchOk, 200),
  });

  // ─── A. Search dates ───
  console.log('A. Search date formats…');
  {
    const mut = (fn) => {
      const b = clone(searchBase);
      fn(b);
      return b;
    };
    expectReject('A. Search', 'checkin DD-MM-YYYY rejected', await search(client, mut((b) => {
      b.checkin = '22-08-2026';
    })), /check.?in|date|YYYY-MM-DD/i);

    expectReject('A. Search', 'checkin slashes YYYY/MM/DD rejected', await search(client, mut((b) => {
      b.checkin = '2026/08/22';
    })), /check.?in|date|YYYY-MM-DD/i);

    expectReject('A. Search', 'checkin unpadded YYYY-M-D rejected', await search(client, mut((b) => {
      b.checkin = '2026-8-22';
    })), /check.?in|date|YYYY-MM-DD|zero.?pad/i);

    expectReject('A. Search', 'checkin impossible 2026-02-30 rejected', await search(client, mut((b) => {
      b.checkin = '2026-02-30';
      b.checkout = '2026-03-02';
    })), /check.?in|date|valid|real/i);

    expectReject('A. Search', 'checkout DD-MM-YYYY rejected', await search(client, mut((b) => {
      b.checkout = '25-08-2026';
    })), /check.?out|date|YYYY-MM-DD/i);

    expectReject('A. Search', 'checkout before checkin rejected', await search(client, mut((b) => {
      b.checkin = futureDate(40);
      b.checkout = futureDate(35);
    })), /check.?out|after|before/i);

    expectReject('A. Search', 'checkin in the past rejected', await search(client, mut((b) => {
      b.checkin = '2020-01-15';
      b.checkout = '2020-01-17';
    })), /check.?in|today|past|future/i);

    expectReject('A. Search', 'checkout >1 year from today rejected', await search(client, mut((b) => {
      b.checkin = futureDate(400);
      b.checkout = futureDate(402);
    })), /year|checkout|check.?out|far|range/i);
  }

  // ─── A. Search rooms ───
  console.log('A. Search rooms…');
  {
    const mut = (fn) => {
      const b = clone(searchBase);
      fn(b);
      return b;
    };

    expectReject('A. Search', 'adults as string "1" rejected', await search(client, mut((b) => {
      b.rooms[0].adults = '1';
    })), /adult|number|whole/i);

    expectReject('A. Search', 'adults decimal 1.5 rejected', await search(client, mut((b) => {
      b.rooms[0].adults = 1.5;
    })), /adult|whole|number/i);

    expectReject('A. Search', 'adults 0 rejected', await search(client, mut((b) => {
      b.rooms[0].adults = 0;
    })), /adult/i);

    expectReject('A. Search', 'adults 7 rejected', await search(client, mut((b) => {
      b.rooms[0].adults = 7;
    })), /adult/i);

    expectReject('A. Search', 'children decimal rejected', await search(client, mut((b) => {
      b.rooms[0].children = 1.5;
      b.rooms[0].childrenAges = [9];
    })), /child|whole|number/i);

    expectReject('A. Search', 'children 5 rejected', await search(client, mut((b) => {
      b.rooms[0].children = 5;
      b.rooms[0].childrenAges = [1, 2, 3, 4, 5];
    })), /child/i);

    expectReject('A. Search', 'children>0 without childrenAges rejected', await search(client, mut((b) => {
      b.rooms[0].children = 1;
      delete b.rooms[0].childrenAges;
    })), /childrenAges|age/i);

    expectReject('A. Search', 'childrenAges length mismatch rejected', await search(client, mut((b) => {
      b.rooms[0].children = 2;
      b.rooms[0].childrenAges = [9];
    })), /childrenAges|age|match|length/i);

    expectReject('A. Search', 'childrenAges entry 18 rejected', await search(client, mut((b) => {
      b.rooms[0].children = 1;
      b.rooms[0].childrenAges = [18];
    })), /age|childrenAges|17/i);

    expectReject('A. Search', 'childrenAges as string rejected', await search(client, mut((b) => {
      b.rooms[0].children = 1;
      b.rooms[0].childrenAges = ['9'];
    })), /age|number|childrenAges/i);

    expectAccept('A. Search', 'valid children + childrenAges accepted', await search(client, mut((b) => {
      b.rooms[0].children = 1;
      b.rooms[0].childrenAges = [9];
    })));

    expectReject('A. Search', 'missing entityId rejected', await search(client, mut((b) => {
      delete b.entityId;
    })), /entityId/i);

    expectReject('A. Search', 'missing type rejected', await search(client, mut((b) => {
      delete b.type;
    })), /type/i);

    expectReject('A. Search', 'nationality not 2-letter rejected', await search(client, mut((b) => {
      b.nationality = 'IND';
    })), /nationality|country/i);

    expectNoServerCrash('A. Search', 'nationality with trailing comma (IN,)', await search(client, mut((b) => {
      b.nationality = 'IN,';
    })));
    expectNoServerCrash('A. Search', 'entityId with extra punctuation', await search(client, mut((b) => {
      b.entityId = `${b.entityId},<>`;
    })));

    expectReject('A. Search', '>6 rooms rejected', await search(client, mut((b) => {
      b.rooms = Array.from({ length: 7 }, () => ({ adults: 1, children: 0, childrenAges: [] }));
    })), /room|maximum|6/i);
  }

  // ─── B. Details ───
  console.log('\n=== B. Details ===');
  const detailsBase = buildDetailsBody(searchBase);
  {
    const mut = (fn) => {
      const b = clone(detailsBase);
      fn(b);
      return b;
    };

    expectReject('B. Details', 'checkin DD-MM-YYYY rejected', await detailsCall(client, mut((b) => {
      b.checkin = '22-08-2026';
    })), /check.?in|date|YYYY-MM-DD/i);

    expectReject('B. Details', 'checkin slashes rejected', await detailsCall(client, mut((b) => {
      b.checkin = '2026/08/22';
    })), /check.?in|date|YYYY-MM-DD/i);

    expectReject('B. Details', 'checkin unpadded rejected', await detailsCall(client, mut((b) => {
      b.checkin = '2026-8-22';
    })), /check.?in|date|YYYY-MM-DD/i);

    expectReject('B. Details', 'impossible date 2026-02-30 rejected', await detailsCall(client, mut((b) => {
      b.checkin = '2026-02-30';
    })), /check.?in|date|valid/i);

    // Past date still accepted for details (lookup)
    expectAccept('B. Details', 'past checkin accepted (lookup)', await detailsCall(client, mut((b) => {
      b.checkin = '2020-01-15';
      b.checkout = '2020-01-17';
    })));

    // Dates not compared — checkout before checkin may still be format-valid only
    expectAccept('B. Details', 'checkout before checkin still accepted (no compare)', await detailsCall(client, mut((b) => {
      b.checkin = futureDate(40);
      b.checkout = futureDate(35);
    })));
  }

  // ─── C. Prebook ───
  console.log('\n=== C. Prebook ===');
  {
    expectReject('C. Prebook', 'blank bookingCode rejected', await prebook(client, {
      bookingCode: '',
      requestId: 'req-dummy',
    }), /bookingCode|blank|empty|required/i);

    expectReject('C. Prebook', 'blank requestId rejected', await prebook(client, {
      bookingCode: 'dummy-code',
      requestId: '',
    }), /requestId|blank|empty|required/i);

    const both = await prebook(client, {});
    const det = errDetails(both);
    const bothMsgs = det.length >= 2
      || (det.join(' ').match(/bookingCode/i) && det.join(' ').match(/requestId/i));
    const passBoth = both.status === 400 && errCode(both) === 'VALIDATION_ERROR' && bothMsgs;
    rows.push({
      section: 'C. Prebook',
      rule: 'Both bookingCode + requestId missing reported together',
      how: 'POST prebook {}',
      expected: 'HTTP 400 VALIDATION_ERROR with both fields in details',
      actual: `HTTP ${both.status} code=${errCode(both)} details=${JSON.stringify(det).slice(0, 200)}`,
      status: passBoth ? 'PASS' : 'BUG',
      note: passBoth ? '' : 'Expected both field messages in details[]',
      responseSnippet: brief(both),
    });
    if (!passBoth) bugs.push({ section: 'C. Prebook', rule: 'both missing', response: brief(both) });
  }

  // ─── Setup finalize baseline ───
  console.log('\n=== Finalize baseline (search→details→prebook) ===');
  let finBase = null;
  let prebookMeta = null;

  const searchBodyFin = buildSearchBody({
    checkinDays: 35,
    nights: 2,
    rooms: [{ adults: 2, children: 0, childrenAges: [] }],
  });
  searchBodyFin.rooms[0].adults = 2;
  searchBodyFin.rooms[0].children = 0;

  const sRes = await hotel.search(searchBodyFin);
  const dRes = await hotel.getDetails(searchBodyFin);
  const rid = extractRequestId(dRes.data);
  const codes = extractBookingCodes(dRes.data, 15);
  console.log('details requestId', rid, 'codes', codes.length);

  for (const code of codes) {
    const pre = await hotel.prebook({ bookingCode: code, requestId: rid });
    const ctx = extractBookingContext(pre.data);
    if (ctx) {
      prebookMeta = { pre, code, rid, ctx, data: pre.data };
      finBase = {
        bookingContext: ctx,
        bookingCode: code,
        requestId: rid,
        checkin: searchBodyFin.checkin,
        checkout: searchBodyFin.checkout,
        rooms: [{
          guests: [
            adultGuest({ isLead: true, firstName: 'Rohan', lastName: 'Bhagat' }),
            adultGuest({ isLead: false, firstName: 'Amit', lastName: 'Sharma', title: 'Mr' }),
          ],
        }],
        contact: contactBase(),
        // Hilltop rates are typically GST-claimable; omit → VALIDATION_ERROR
        gstDetails: { ...GST_FIXTURE },
      };
      console.log('Prebook OK', code, 'passport/PAN flags', {
        panMandatory: pre.data?.panMandatory ?? pre.data?.isPanMandatory,
        gstRequired: pre.data?.gstRequired ?? pre.data?.isGstRequired,
      });
      break;
    }
  }

  rows.push({
    section: 'Setup',
    api: apiOf('Setup'),
    rule: titledRule('Setup', 'search → details → prebook to get a bookingContext for finalize tests'),
    how: 'POST /v1/hotels/search, then POST /v1/hotels/details, then POST /v1/hotels/prebook with the returned bookingCode + requestId.',
    expected: 'prebook returns bookingContext used as finalize baseline',
    actual: finBase ? `OK code=${prebookMeta.code}` : `FAIL search=${sRes.status} details=${dRes.status}`,
    status: finBase ? 'PASS' : 'BUG',
    note: finBase ? '' : brief(dRes),
    responseSnippet: finBase ? 'ready' : brief(sRes),
  });

  if (!finBase) {
    const summary = summarize();
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
    printTables(summary);
    process.exitCode = 1;
    return;
  }

  // Sanity: valid finalize should NOT get VALIDATION_ERROR (may hit wallet/offer etc.)
  {
    const res = await finalize(client, uniquifyFinalize(finBase));
    const isVal = res.status === 400 && errCode(res) === 'VALIDATION_ERROR';
    rows.push({
      section: 'Finalize baseline',
      api: apiOf('Finalize baseline'),
      rule: titledRule('Finalize baseline', 'valid finalize body is not VALIDATION_ERROR'),
      how: `POST ${FIN_PATH} with guests/contact/dates taken from a successful prebook (bookingContext + rooms).`,
      expected: 'Not VALIDATION_ERROR (HTTP 2xx book or a later business error is OK; never 500)',
      actual: `HTTP ${res.status} code=${errCode(res)}`,
      status: isVal ? 'BUG' : ((res.status || 0) >= 500 ? 'BUG' : 'PASS'),
      note: isVal ? `Unexpected validation: ${JSON.stringify(errDetails(res)).slice(0, 200)}` : 'OK',
      responseSnippet: brief(res, 350),
    });
    if (isVal) bugs.push({ section: 'Finalize', rule: 'baseline', response: brief(res) });
  }

  // ─── 1. Stay dates ───
  console.log('\n=== Finalize §1 Stay dates ===');
  {
    const mut = async (fn) => {
      const b = uniquifyFinalize(finBase);
      fn(b);
      return finalize(client, b);
    };

    expectReject('1. Stay dates', 'checkin DD-MM-YYYY rejected', await mut((b) => {
      b.checkin = '14-09-2026';
    }), /checkin|YYYY-MM-DD|date/i);

    expectReject('1. Stay dates', 'checkin slashes rejected', await mut((b) => {
      b.checkin = '2026/09/14';
    }), /checkin|YYYY-MM-DD|date/i);

    expectReject('1. Stay dates', 'checkin unpadded rejected', await mut((b) => {
      b.checkin = '2026-9-14';
    }), /checkin|YYYY-MM-DD|date/i);

    expectReject('1. Stay dates', 'impossible 2026-02-30 rejected', await mut((b) => {
      b.checkin = '2026-02-30';
      b.checkout = '2026-03-02';
    }), /checkin|date|valid/i);

    expectReject('1. Stay dates', 'checkout before/equal checkin rejected', await mut((b) => {
      b.checkout = b.checkin;
    }), /checkout|after|checkin/i);

    expectReject('1. Stay dates', 'checkin in the past rejected', await mut((b) => {
      b.checkin = '2020-01-15';
      b.checkout = '2020-01-17';
    }), /checkin|today|past/i);

    // Same-day check-in is valid for the whole day — use today's date if API allows
    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(today.getUTCDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    const tomorrow = new Date(today.getTime() + 86400000);
    const t2 = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
    const sameDay = await mut((b) => {
      b.checkin = todayStr;
      b.checkout = t2;
    });
    // May fail for business reasons (rate expired / offer) but must NOT be date VALIDATION_ERROR about past
    const sameDayVal = sameDay.status === 400 && errCode(sameDay) === 'VALIDATION_ERROR'
      && errDetails(sameDay).some((m) => /past|today or later|checkin/i.test(m) && /past|today/i.test(m));
    // Simpler: if VALIDATION_ERROR mentions checkin past → BUG; if other errors or success → PASS for this rule
    const rejectedAsPast = sameDay.status === 400 && errCode(sameDay) === 'VALIDATION_ERROR'
      && errDetails(sameDay).some((m) => /past|today or later/i.test(m));
    rows.push({
      section: '1. Stay dates',
      rule: 'Same-day check-in accepted (date rule)',
      how: `checkin=${todayStr}`,
      expected: 'Not rejected solely for being today',
      actual: `HTTP ${sameDay.status} code=${errCode(sameDay)} details=${JSON.stringify(errDetails(sameDay)).slice(0, 160)}`,
      status: rejectedAsPast ? 'BUG' : 'PASS',
      note: rejectedAsPast ? 'Rejected as past/today rule' : 'Date rule OK (may fail other business codes)',
      responseSnippet: brief(sameDay, 300),
    });
    if (rejectedAsPast) bugs.push({ section: '1. Stay dates', rule: 'same-day', response: brief(sameDay) });
  }

  // ─── 2. Guests ───
  console.log('\n=== Finalize §2 Guests ===');
  {
    const mut = async (fn) => {
      const b = uniquifyFinalize(finBase);
      fn(b);
      return finalize(client, b);
    };

    expectReject('2. Guests', 'type Infant rejected', await mut((b) => {
      b.rooms[0].guests[1] = childGuest({ type: 'Infant', age: 1 });
    }), /type|Adult|Child/i);

    expectReject('2. Guests', 'title MR (wrong case) rejected', await mut((b) => {
      b.rooms[0].guests[0].title = 'MR';
    }), /title/i);

    expectReject('2. Guests', 'title mr lowercase rejected', await mut((b) => {
      b.rooms[0].guests[0].title = 'mr';
    }), /title/i);

    expectReject('2. Guests', 'Adult title Mstr rejected', await mut((b) => {
      b.rooms[0].guests[0].title = 'Mstr';
    }), /title/i);

    expectReject('2. Guests', 'Child title Mr rejected', await mut((b) => {
      b.rooms[0].guests[1] = childGuest({ title: 'Mr' });
    }), /title/i);

    expectReject('2. Guests', 'title Mr + gender Female mismatch', await mut((b) => {
      b.rooms[0].guests[0].gender = 'Female';
    }), /gender|title|Male/i);

    expectReject('2. Guests', 'firstName with digit rejected', await mut((b) => {
      b.rooms[0].guests[0].firstName = 'Rohan2';
    }), /firstName|letter/i);

    expectReject('2. Guests', 'lastName with hyphen rejected', await mut((b) => {
      b.rooms[0].guests[0].lastName = 'Jean-Luc';
    }), /lastName|letter|hyphen|punctuation/i);

    expectReject('2. Guests', 'lastName with apostrophe rejected', await mut((b) => {
      b.rooms[0].guests[0].lastName = "O'Brien";
    }), /lastName|letter|apostrophe|punctuation/i);

    expectNoServerCrash('2. Guests', 'firstName with trailing comma', await mut((b) => {
      b.rooms[0].guests[0].firstName = 'Rohan,';
    }));
    expectNoServerCrash('2. Guests', 'lastName with trailing comma', await mut((b) => {
      b.rooms[0].guests[0].lastName = 'Bhagat,';
    }));
    expectNoServerCrash('2. Guests', 'firstName with punctuation !@#$', await mut((b) => {
      b.rooms[0].guests[0].firstName = 'Rohan!@#$';
    }));

    expectReject('2. Guests', 'firstName too short (<2) rejected', await mut((b) => {
      b.rooms[0].guests[0].firstName = 'R';
    }), /firstName|2|minimum|character/i);

    expectReject('2. Guests', 'Child missing age rejected', await mut((b) => {
      b.rooms[0].guests[1] = { title: 'Mstr', firstName: 'Arjun', lastName: 'Patil', type: 'Child', isLead: false };
    }), /age/i);

    expectReject('2. Guests', 'Child age 18 rejected', await mut((b) => {
      b.rooms[0].guests[1] = childGuest({ age: 18 });
    }), /age|17/i);

    expectReject('2. Guests', 'dob in the future rejected', await mut((b) => {
      b.rooms[0].guests[0].dob = '2099-01-01';
    }), /dob|future|date/i);

    expectReject('2. Guests', 'dob wrong format DD-MM-YYYY rejected', await mut((b) => {
      b.rooms[0].guests[0].dob = '29-05-2001';
    }), /dob|YYYY-MM-DD|date/i);

    expectReject('2. Guests', 'no lead guest rejected', await mut((b) => {
      b.rooms[0].guests.forEach((g) => { g.isLead = false; });
    }), /isLead|lead/i);

    expectReject('2. Guests', 'two lead guests rejected', await mut((b) => {
      b.rooms[0].guests.forEach((g) => { g.isLead = true; });
    }), /isLead|lead|exactly one/i);

    // Adult DOB implying under 18 on checkin
    expectReject('2. Guests', 'Adult DOB under 18 on checkin rejected', await mut((b) => {
      // checkin ~35 days out — set DOB to 10 years before checkin
      const cin = b.checkin;
      const y = Number(cin.slice(0, 4)) - 10;
      b.rooms[0].guests[0].dob = `${y}${cin.slice(4)}`;
      b.rooms[0].guests[0].type = 'Adult';
    }), /18|Adult|age|dob|check-?in/i);

    // Child DOB implying adult on checkin
    expectReject('2. Guests', 'Child DOB 18+ on checkin rejected', await mut((b) => {
      const cin = b.checkin;
      const y = Number(cin.slice(0, 4)) - 20;
      b.rooms[0].guests[1] = childGuest({
        dob: `${y}${cin.slice(4)}`,
        age: 8, // mismatch + adult age
      });
    }), /Child|age|dob|17|18/i);

    expectAccept('2. Guests', 'type adult lowercase accepted (case-insensitive)', await mut((b) => {
      b.rooms[0].guests[0].type = 'adult';
    }));

    expectAccept('2. Guests', 'title Miss adult + gender Female OK', await mut((b) => {
      b.rooms[0].guests[1] = {
        title: 'Miss',
        firstName: 'Anita',
        lastName: 'Sharma',
        type: 'Adult',
        gender: 'Female',
        isLead: false,
      };
    }));
  }

  // ─── 3. Contact ───
  console.log('\n=== Finalize §3 Contact ===');
  {
    const mut = async (fn) => {
      const b = uniquifyFinalize(finBase);
      fn(b);
      return finalize(client, b);
    };

    expectReject('3. Contact', 'missing email rejected', await mut((b) => {
      delete b.contact.email;
    }), /email/i);

    expectReject('3. Contact', 'invalid email rejected', await mut((b) => {
      b.contact.email = 'not-an-email';
    }), /email/i);

    expectNoServerCrash('3. Contact', 'email with comma', await mut((b) => {
      b.contact.email = 'rohan,bhagat@travelvip.ai';
    }));
    expectNoServerCrash('3. Contact', 'mobile with comma', await mut((b) => {
      b.contact.mobile = '98765,43210';
    }));

    expectReject('3. Contact', 'missing countryCode rejected', await mut((b) => {
      delete b.contact.countryCode;
    }), /countryCode/i);

    expectReject('3. Contact', 'missing mobile rejected', await mut((b) => {
      delete b.contact.mobile;
    }), /mobile/i);

    expectReject('3. Contact', '+91 mobile not starting 6-9 rejected', await mut((b) => {
      b.contact.countryCode = '+91';
      b.contact.mobile = '5123456789';
    }), /mobile/i);

    expectReject('3. Contact', '+91 mobile length != 10 rejected', await mut((b) => {
      b.contact.countryCode = '+91';
      b.contact.mobile = '98765';
    }), /mobile/i);

    expectAccept('3. Contact', 'plain 91 countryCode accepted as +91', await mut((b) => {
      b.contact.countryCode = '91';
      b.contact.mobile = '9876543210';
    }));

    expectAccept('3. Contact', 'mobile with hyphens accepted', await mut((b) => {
      b.contact.mobile = '98765-43210';
    }));

    expectAccept('3. Contact', 'mobile repeating country code accepted', await mut((b) => {
      b.contact.countryCode = '+91';
      b.contact.mobile = '919876543210';
    }));

    // PAN format when sent (even if not mandatory — invalid format should reject)
    expectReject('3. Contact', 'invalid panCardNumber format rejected', await mut((b) => {
      b.contact.panCardNumber = 'BADPAN';
      b.contact.panCardName = 'TRAVELVIP';
    }), /pan/i);

    expectReject('3. Contact', 'panCardNumber without panCardName rejected', await mut((b) => {
      b.contact.panCardNumber = 'AABCT1332L';
      b.contact.panCardName = '';
    }), /panCardName|pan/i);
  }

  // ─── 4. GST ───
  console.log('\n=== Finalize §4 GST ===');
  {
    const mut = async (fn) => {
      const b = uniquifyFinalize(finBase);
      fn(b);
      return finalize(client, b);
    };

    // Baseline rate is GST-claimable → omit / empty must reject
    expectReject('4. GST', 'gstDetails omitted on GST-claimable rate rejected', await mut((b) => {
      delete b.gstDetails;
    }), /gstDetails|GST|claimable/i);

    expectReject('4. GST', 'empty gstDetails object on GST-claimable rate rejected', await mut((b) => {
      b.gstDetails = {};
    }), /gstDetails|GST|claimable|gstNumber/i);

    expectReject('4. GST', 'partial GST block rejected', await mut((b) => {
      b.gstDetails = { gstNumber: '27AABCT1332L1ZU' };
    }), /gst/i);

    expectReject('4. GST', 'invalid GSTIN rejected', await mut((b) => {
      b.gstDetails = {
        gstNumber: 'INVALID',
        gstCompanyName: 'TravelVIP',
        gstAddress: 'Mumbai',
        gstEmailID: 'accounts@travelvip.ai',
        gstMobileNumber: '9820011223',
      };
    }), /gstNumber|GSTIN|gst/i);

    expectReject('4. GST', 'gstEmailId (wrong casing) treated as missing', await mut((b) => {
      b.gstDetails = {
        gstNumber: '27AABCT1332L1ZU',
        gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
        gstAddress: '5th Floor, Trade Centre, BKC, Mumbai 400051',
        gstEmailId: 'accounts@travelvip.ai', // wrong key
        gstMobileNumber: '9820011223',
      };
    }), /gstEmailID|gstEmail/i);

    expectReject('4. GST', 'invalid gstMobileNumber rejected', await mut((b) => {
      b.gstDetails = {
        gstNumber: '27AABCT1332L1ZU',
        gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
        gstAddress: '5th Floor, Trade Centre, BKC, Mumbai 400051',
        gstEmailID: 'accounts@travelvip.ai',
        gstMobileNumber: '5123456789',
      };
    }), /gstMobile|mobile/i);

    // Full valid GST — should not be VALIDATION_ERROR
    const fullGst = await mut((b) => {
      b.gstDetails = {
        gstNumber: '27AABCT1332L1ZU',
        gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
        gstAddress: '5th Floor, Trade Centre, Bandra Kurla Complex, Mumbai 400051',
        gstEmailID: 'accounts@travelvip.ai',
        gstMobileNumber: '9820011223',
      };
    });
    expectAccept('4. GST', 'full valid gstDetails accepted (not VALIDATION_ERROR)', fullGst);
  }

  // ─── Envelope checks on a known reject ───
  {
    const res = await finalize(client, (() => {
      const b = uniquifyFinalize(finBase);
      b.contact.email = 'bad';
      return b;
    })());
    const pass = hasEnvelope(res) && res.status === 400 && errCode(res) === 'VALIDATION_ERROR';
    rows.push({
      section: 'Error envelope',
      rule: 'error has code/message/details[]/timestamp/request_id',
      how: 'Invalid email finalize',
      expected: 'Full shared error envelope',
      actual: brief(res, 250),
      status: pass ? 'PASS' : 'BUG',
      note: pass ? '' : 'Envelope incomplete or wrong status (details must be array)',
      responseSnippet: brief(res),
    });
    if (!pass) bugs.push({ section: 'Error envelope', rule: 'shape', response: brief(res) });
  }

  // Multi-error aggregation
  {
    const b = uniquifyFinalize(finBase);
    b.checkin = '14-09-2026';
    b.rooms[0].guests[0].firstName = 'R';
    b.contact.email = 'bad';
    const res = await finalize(client, b);
    const det = errDetails(res);
    const pass = res.status === 400 && errCode(res) === 'VALIDATION_ERROR' && det.length >= 2;
    rows.push({
      section: 'Error envelope',
      rule: 'Multiple validation problems listed together',
      how: 'Bad date + short name + bad email',
      expected: 'details[] length >= 2',
      actual: `HTTP ${res.status} detailsCount=${det.length} details=${JSON.stringify(det).slice(0, 250)} msg=${res.data?.error?.message}`,
      status: pass ? 'PASS' : 'BUG',
      note: pass ? '' : 'Expected aggregated details[] (got null/single message)',
      responseSnippet: brief(res),
    });
    if (!pass) bugs.push({ section: 'Error envelope', rule: 'aggregate', response: brief(res) });
  }

  // Rules that need special rate flags
  rows.push({
    section: '3. Contact',
    rule: 'PAN mandatory rate requires panCardNumber',
    how: 'Needs PAN-mandatory prebook rate',
    expected: 'VALIDATION_ERROR when missing on PAN rate',
    actual: 'NOT TESTED — no guaranteed PAN-mandatory rate in baseline',
    status: 'NOT TESTED',
    note: 'Requires rate flagged pan-mandatory',
  });
  rows.push({
    section: '4. GST',
    rule: 'GST-required rate makes gstDetails mandatory',
    how: 'Needs GST-required prebook rate',
    expected: "VALIDATION_ERROR 'gstDetails' is required…",
    actual: 'NOT TESTED — no guaranteed GST-required rate in baseline',
    status: 'NOT TESTED',
    note: 'Requires rate flagged GST-required',
  });
  rows.push({
    section: '2. Guests',
    rule: 'Child turns 18 during stay (checkout age rule)',
    how: 'DOB such that age 17 on checkin, 18 on checkout',
    expected: 'VALIDATION_ERROR',
    actual: 'NOT TESTED — edge DOB timing not automated this run',
    status: 'NOT TESTED',
    note: 'Needs precise DOB vs stay window',
  });

  const summary = summarize();
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  printTables(summary);
  if (summary.counts.BUG > 0) process.exitCode = 1;
}

function summarize() {
  const counts = { PASS: 0, BUG: 0, 'NOT TESTED': 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return {
    baseUrl: config.baseUrl,
    finalizePath: FIN_PATH,
    generatedAt: new Date().toISOString(),
    counts,
    bugs,
    rows,
  };
}

function printTables(summary) {
  console.log('\n========== HOTEL VALIDATION REPORT ==========');
  console.log(`Score: PASS ${summary.counts.PASS} | BUG ${summary.counts.BUG} | NOT TESTED ${summary.counts['NOT TESTED'] || 0}`);

  const sections = [...new Set(rows.map((r) => r.section))];
  for (const sec of sections) {
    const list = rows.filter((r) => r.section === sec);
    console.log(`\n### ${sec}`);
    console.log('| # | Rule | How tested | Status |');
    console.log('|---|------|------------|--------|');
    list.forEach((r, i) => {
      console.log(`| ${i + 1} | ${r.rule} | ${r.how} | ${r.status} |`);
    });
  }

  if (bugs.length) {
    console.log('\n--- BUG DETAILS ---');
    bugs.forEach((b, i) => {
      console.log(`\nBUG ${i + 1}: [${b.section}] ${b.rule}`);
      console.log(b.note || '');
      console.log(b.response?.slice(0, 500));
    });
  }
  console.log('\nReport:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});

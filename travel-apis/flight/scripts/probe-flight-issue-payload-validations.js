/**
 * Flight Issue Ticket — full payload validation matrix
 * POST /api/v2/flights/booking/issue-ticket
 * Env: BASE_URL from .env (Dev = api-staging)
 *
 * Run: node scripts/probe-flight-issue-payload-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  extractFirstSearchId,
} from '../src/helpers.js';

const OUT = path.join('reports', process.env.FLIGHT_ISSUE_VAL_OUT || 'flight-issue-payload-validations-dev.json');
const SKIP_RESCHEDULE = String(process.env.SKIP_RESCHEDULE || '1') !== '0';
const ISSUE_PATH = '/api/v2/flights/booking/issue-ticket';

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function detailsArr(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function detailsText(r) {
  return detailsArr(r).join(' | ') + ' | ' + String(r?.data?.error?.message || r?.data?.message || '');
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function setPath(obj, dotted, value) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function deletePath(obj, dotted) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur == null) return obj;
    cur = cur[parts[i]];
  }
  if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  return obj;
}

async function main() {
  console.log('Base (Dev):', config.baseUrl);
  console.log('Issue path:', ISSUE_PATH);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  // Price a domestic OW fare (passportType NONE)
  let base = null;
  let searchMeta = null;
  for (const days of [14, 21, 28, 35]) {
    const body = buildOneWaySearchBody(days, { origin: 'BOM', destination: 'DEL' });
    body.preferences = { ...(body.preferences || {}), airlines: ['SG'] };
    const search = await flight.search(body);
    if (!ok(search)) continue;
    const searchId = extractFirstSearchId(search.data);
    if (!searchId) continue;
    const pricing = await flight.getPricing([searchId], 'ONE_WAY');
    if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) continue;
    base = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [searchId],
      journeyType: 'ONE_WAY',
    });
    // ensure clean domestic defaults
    base.type = 'ticket';
    base.data.passportType = 'NONE';
    base.data.includeGst = false;
    base.data.gstDetails = null;
    searchMeta = { days, searchId, priceId: pricing.data.priceId, departDate: body.itinerary[0].date };
    console.log('Priced OK', searchMeta);
    break;
  }
  if (!base) throw new Error('Could not price a flight for validation base payload');

  const issue = (payload) => client.request({
    method: 'POST',
    path: ISSUE_PATH,
    query: FLIGHT_QUERY,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const ISSUE_PATH_V1 = '/v1/flights/booking/issue-ticket';
  const issueV1 = (payload) => client.request({
    method: 'POST',
    path: ISSUE_PATH_V1,
    query: FLIGHT_QUERY,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const API = `POST ${ISSUE_PATH}`;
  const rows = [];
  const add = (id, rule, expectedDetailHint, status, note, res, extra = {}) => {
    const titled = String(rule).startsWith('POST ') ? rule : `${API} — ${rule}`;
    const how = extra.how || (
      id === 'S0'
        ? `Priced OW BOM→DEL (searchId=${searchMeta?.searchId}, priceId=${searchMeta?.priceId}), then ${API} with a complete ticket body (passengers, contact, priceId, bookingReference).`
        : `Clone that priced issue-ticket body, change only this field/rule (${rule}), then ${API}.`
    );
    const expected = extra.expected || (
      id === 'S0'
        ? 'Must not return VALIDATION_ERROR (HTTP 200 book or a later business error is OK)'
        : `HTTP 400 VALIDATION_ERROR with details mentioning the field (never HTTP 500). Hint: ${expectedDetailHint}`
    );
    const row = {
      id,
      api: API,
      rule: titled,
      how,
      expected,
      actual: note || (res ? `HTTP ${res.status} code=${errCode(res)} details=${detailsArr(res).join('; ').slice(0, 180)}` : ''),
      expectedDetailHint,
      status,
      note,
      http: res?.status ?? null,
      code: errCode(res),
      details: detailsArr(res),
      snippet: res ? brief(res.data, 400) : null,
      responseSnippet: res ? brief(res.data, 400) : null,
      at: new Date().toISOString(),
    };
    rows.push(row);
    console.log(`[${status}] ${id} ${titled}`);
    if (row.http != null) console.log(' HTTP', row.http, row.code || '', (row.details[0] || '').slice(0, 120));
  };

  /**
   * Expect HTTP 400 VALIDATION_ERROR and details mentioning hint (regex or string).
   * HTTP 500 on bad input is always a BUG (must be a client validation error).
   */
  async function expectValidation(id, rule, mutator, hint, extra = {}) {
    const payload = deepClone(base);
    mutator(payload);
    const res = await issue(payload);
    const text = detailsText(res).toLowerCase();
    const hintOk = hint instanceof RegExp
      ? new RegExp(hint.source, hint.flags.includes('i') ? hint.flags : `${hint.flags}i`).test(text)
      : text.includes(String(hint).toLowerCase());
    const envelopeOk = res.status === 400 && errCode(res) === 'VALIDATION_ERROR';

    if ((res.status || 0) >= 500) {
      add(id, rule, String(hint), 'BUG', `HTTP ${res.status} Internal Server Error — invalid payload must return HTTP 400 VALIDATION_ERROR, never 500`, res, extra);
      return;
    }
    if (envelopeOk && hintOk) {
      add(id, rule, String(hint), 'PASS', `rejected as expected HTTP ${res.status} ${errCode(res)}`, res, extra);
      return;
    }
    if (ok(res) || res.status === 200) {
      add(id, rule, String(hint), 'BUG', 'Accepted invalid payload (should be 400 VALIDATION_ERROR)', res, extra);
      return;
    }
    if (envelopeOk && !hintOk) {
      add(id, rule, String(hint), 'FAIL', `VALIDATION_ERROR but detail mismatch. Got: ${detailsArr(res).join('; ').slice(0, 200)}`, res, extra);
      return;
    }
    add(id, rule, String(hint), 'FAIL', `Expected 400 VALIDATION_ERROR; got HTTP ${res.status} code=${errCode(res)}`, res, extra);
  }

  /** Invalid punctuation/special chars: 4xx + error.code = PASS; HTTP 500 or HTTP 200 = BUG. */
  async function expectNoServerCrash(id, rule, mutator, extra = {}) {
    const payload = deepClone(base);
    mutator(payload);
    const res = await issue(payload);
    const code = errCode(res);
    const extraOpts = {
      expected: 'HTTP 4xx with error.code (VALIDATION_ERROR preferred). Must never be HTTP 500.',
      ...extra,
    };
    if ((res.status || 0) >= 500) {
      add(id, rule, 'no-500', 'BUG', `HTTP ${res.status} Internal Server Error after special chars — expected 4xx error envelope`, res, extraOpts);
      return;
    }
    if (ok(res) || res.status === 200) {
      add(id, rule, 'no-500', 'BUG', 'Accepted payload that added extra special characters / comma', res, extraOpts);
      return;
    }
    if (res.status >= 400 && res.status < 500 && code) {
      add(id, rule, 'no-500', 'PASS', `HTTP ${res.status} code=${code} (valid client error, not 500)`, res, extraOpts);
      return;
    }
    add(id, rule, 'no-500', 'BUG', `Expected 4xx error.code; got HTTP ${res.status} code=${code}`, res, extraOpts);
  }

  // Sanity: valid priced ticket body should NOT fail validation (wallet/business errors later are OK)
  {
    const res = await issue(deepClone(base));
    const isVal = errCode(res) === 'VALIDATION_ERROR';
    if (isVal) {
      add('S0', 'valid priced issue-ticket body is accepted (not VALIDATION_ERROR)', 'none', 'BUG', `Valid payload hit VALIDATION_ERROR: ${detailsArr(res).join('; ')}`, res);
    } else {
      add('S0', 'valid priced issue-ticket body is accepted (not VALIDATION_ERROR)', 'none', 'PASS', `Not validation-blocked (HTTP ${res.status} code=${errCode(res)})`, res);
    }
  }

  // ===== 1. Top level =====
  await expectValidation('T1', 'type required', (p) => deletePath(p, 'type'), /type/);
  await expectValidation('T2', 'type non-empty', (p) => { p.type = ''; }, /type/);
  await expectValidation('T3', 'currency required', (p) => deletePath(p, 'currency'), /currency/);
  await expectValidation('T4', 'currency non-empty', (p) => { p.currency = ''; }, /currency/);
  await expectValidation('T5', 'language required', (p) => deletePath(p, 'language'), /language/);
  await expectValidation('T6', 'timezone required', (p) => deletePath(p, 'timezone'), /timezone/);
  await expectValidation('T7', 'bookingReference required', (p) => deletePath(p, 'bookingReference'), /bookingReference/);
  await expectValidation('T8', 'searchIds required', (p) => deletePath(p, 'searchIds'), /searchIds/);
  await expectValidation('T9', 'searchIds non-empty', (p) => { p.searchIds = []; }, /searchIds/);
  await expectValidation('T10', 'journeyType required', (p) => deletePath(p, 'journeyType'), /journeyType/);
  await expectValidation('T11', 'journeyType enum', (p) => { p.journeyType = 'ONEWAY'; }, /journeyType|ONE_WAY|ROUND_TRIP|MULTI_CITY/);

  if (!SKIP_RESCHEDULE) {
    await expectValidation('R1', 'reschedulingReferenceId alone rejected', (p) => {
      p.reschedulingReferenceId = 'BR1786017179800507';
    }, /reschedulingPnr/);
    await expectValidation('R2', 'reschedulingPnr alone rejected', (p) => {
      p.reschedulingPnr = 'ABCDEF';
    }, /reschedulingReferenceId/);
    await expectValidation('R3', 'reschedulingReferenceId max 100', (p) => {
      p.reschedulingReferenceId = 'B'.repeat(101);
      p.reschedulingPnr = 'ABCDEF';
    }, /reschedulingReferenceId|100/);
    await expectValidation('R4', 'reschedulingPnr max 50', (p) => {
      p.reschedulingReferenceId = 'BR1786017179800507';
      p.reschedulingPnr = 'P'.repeat(51);
    }, /reschedulingPnr|50/);
    await expectValidation('R5', 'reschedulingReferenceId blank', (p) => {
      p.reschedulingReferenceId = '   ';
      p.reschedulingPnr = 'ABCDEF';
    }, /reschedulingReferenceId/);
    await expectValidation('R6', 'reschedulingPnr blank', (p) => {
      p.reschedulingReferenceId = 'BR1786017179800507';
      p.reschedulingPnr = '   ';
    }, /reschedulingPnr/);
  }

  // ===== 2. data =====
  await expectValidation('D1', 'data required', (p) => deletePath(p, 'data'), /data/);
  await expectValidation('D2', 'priceId required', (p) => deletePath(p, 'data.priceId'), /priceId/);
  await expectValidation('D3', 'priceId non-empty', (p) => { p.data.priceId = ''; }, /priceId/);
  await expectValidation('D4', 'passportType required', (p) => deletePath(p, 'data.passportType'), /passportType/);
  await expectValidation('D5', 'passportType enum', (p) => { p.data.passportType = 'PARTIAL'; }, /passportType|NONE|MINI|FULL/);
  await expectValidation('D6', 'includeGst required', (p) => deletePath(p, 'data.includeGst'), /includeGst/);

  // ===== 3. contact =====
  await expectValidation('C1', 'contact.email required', (p) => deletePath(p, 'data.contact.email'), /email/);
  await expectValidation('C2', 'contact.email format', (p) => { p.data.contact.email = 'not-an-email'; }, /email/);
  await expectValidation('C3', 'contact.mobile required', (p) => deletePath(p, 'data.contact.mobile'), /mobile/);
  await expectValidation('C4', 'contact.mobile too short', (p) => { p.data.contact.mobile = '123'; }, /mobile|7 to 15|digits/);
  await expectValidation('C5', 'contact.mobile too long', (p) => { p.data.contact.mobile = '1'.repeat(16); }, /mobile|7 to 15|digits/);
  await expectValidation('C6', 'contact.mobile non-digits', (p) => { p.data.contact.mobile = 'abcdefgh'; }, /mobile|digit/);
  await expectValidation('C7', 'contact.countryCode required', (p) => deletePath(p, 'data.contact.countryCode'), /countryCode/);

  // ===== 4. gstDetails =====
  await expectValidation('G1', 'gstDetails required when includeGst true', (p) => {
    p.data.includeGst = true;
    p.data.gstDetails = null;
  }, /gst/i);
  await expectValidation('G2', 'gstNumber required', (p) => {
    p.data.includeGst = true;
    p.data.gstDetails = {
      gstNumber: '',
      gstCompanyName: 'Acme',
      gstAddress: 'Addr',
      gstEmailID: 'a@b.com',
      gstMobileNumber: '9876543210',
    };
  }, /gstNumber/i);
  await expectValidation('G3', 'gstEmailID format', (p) => {
    p.data.includeGst = true;
    p.data.gstDetails = {
      gstNumber: '27AAAAA0000A1Z5',
      gstCompanyName: 'Acme',
      gstAddress: 'Addr',
      gstEmailID: 'bad',
      gstMobileNumber: '9876543210',
    };
  }, /gstEmail|email/i);

  // ===== 5. passengers =====
  await expectValidation('P1', 'passengers required', (p) => deletePath(p, 'data.passengers'), /passenger/);
  await expectValidation('P2', 'passengers non-empty', (p) => { p.data.passengers = []; }, /passenger/);
  await expectValidation('P3', 'paxId required', (p) => deletePath(p, 'data.passengers[0].paxId'), /paxId/);
  await expectValidation('P4', 'type required', (p) => deletePath(p, 'data.passengers[0].type'), /type|adult|child|infant/);
  await expectValidation('P5', 'type enum', (p) => { p.data.passengers[0].type = 'senior'; }, /adult|child|infant/);
  await expectValidation('P6', 'isLead required', (p) => deletePath(p, 'data.passengers[0].isLead'), /isLead/);

  // profile
  await expectValidation('PF1', 'title required', (p) => deletePath(p, 'data.passengers[0].profile.title'), /title/);
  await expectValidation('PF2', 'Mrs + Male mismatch', (p) => {
    p.data.passengers[0].profile.title = 'Mrs';
    p.data.passengers[0].profile.gender = 'Male';
  }, /Mrs|Female|gender|title/);
  await expectValidation('PF3', 'Mr + Female mismatch', (p) => {
    p.data.passengers[0].profile.title = 'Mr';
    p.data.passengers[0].profile.gender = 'Female';
  }, /Mr|Male|gender|title/);
  await expectValidation('PF4', 'firstName too short', (p) => {
    p.data.passengers[0].profile.firstName = 'A';
  }, /firstName|2/);
  await expectValidation('PF5', 'firstName non-letters', (p) => {
    p.data.passengers[0].profile.firstName = 'Roh4n';
  }, /firstName|letter/);
  await expectValidation('PF6', 'lastName too short', (p) => {
    p.data.passengers[0].profile.lastName = 'B';
  }, /lastName|2/);
  await expectValidation('PF7', 'gender required', (p) => deletePath(p, 'data.passengers[0].profile.gender'), /gender/);
  await expectValidation('PF8', 'gender enum', (p) => { p.data.passengers[0].profile.gender = 'Other'; }, /Male|Female|gender/);
  await expectValidation('PF9', 'dob required', (p) => deletePath(p, 'data.passengers[0].profile.dob'), /dob/);
  await expectValidation('PF10', 'dob future', (p) => { p.data.passengers[0].profile.dob = '2099-01-01'; }, /dob|future/);
  await expectValidation('PF11', 'dob format', (p) => { p.data.passengers[0].profile.dob = '29-05-2001'; }, /dob|YYYY|format/);
  await expectValidation('PF12', 'nationality required', (p) => deletePath(p, 'data.passengers[0].profile.nationality'), /nationality/);
  await expectValidation('PF13', 'adult age too young (child dob)', (p) => {
    p.data.passengers[0].type = 'adult';
    p.data.passengers[0].profile.dob = '2021-01-01';
    p.data.passengers[0].profile.title = 'Mr';
    p.data.passengers[0].profile.gender = 'Male';
  }, /age|adult|12|dob|child/);

  const departDate = searchMeta.departDate;
  const dobYearsBefore = (years, dayDelta = 0) => {
    const d = new Date(`${departDate}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() + dayDelta);
    return d.toISOString().slice(0, 10);
  };
  const extraPax = (p, type, dob) => {
    const a = p.data.passengers[0];
    const isChild = type === 'child';
    p.data.passengers.push({
      ...deepClone(a),
      paxId: 'PAX2',
      type,
      isLead: false,
      profile: {
        ...deepClone(a.profile),
        title: isChild ? 'Miss' : 'Master',
        firstName: isChild ? 'Aarohi' : 'Aarav',
        lastName: 'Malhotra',
        gender: isChild ? 'Female' : 'Male',
        dob,
      },
    });
  };

  // Adult ≥12, child 2–11, infant <2 on departure date
  await expectValidation('PF14', 'adult 11 years on depart (1 day under 12)', (p) => {
    p.data.passengers[0].type = 'adult';
    p.data.passengers[0].profile.dob = dobYearsBefore(12, 1);
    p.data.passengers[0].profile.title = 'Mr';
    p.data.passengers[0].profile.gender = 'Male';
  }, /adult|12|dob|age/);
  await expectValidation('PF15', 'adult with infant dob (~6 months)', (p) => {
    p.data.passengers[0].type = 'adult';
    p.data.passengers[0].profile.dob = dobYearsBefore(0, -180);
    p.data.passengers[0].profile.title = 'Mr';
    p.data.passengers[0].profile.gender = 'Male';
  }, /adult|12|dob|age|infant/);
  await expectValidation('PF16', 'child dob makes 12+ on depart (adult age)', (p) => {
    extraPax(p, 'child', dobYearsBefore(12, 0));
  }, /child|12|adult|dob|age/);
  await expectValidation('PF17', 'child dob makes under 2 on depart (infant age)', (p) => {
    extraPax(p, 'child', dobYearsBefore(1, 0));
  }, /child|2|infant|dob|age/);
  await expectValidation('PF18', 'infant dob makes 2+ on depart (child age)', (p) => {
    extraPax(p, 'infant', dobYearsBefore(2, 0));
  }, /infant|2|child|dob|age/);
  await expectValidation('PF19', 'infant dob makes 12+ on depart (adult age)', (p) => {
    extraPax(p, 'infant', dobYearsBefore(20, 0));
  }, /infant|2|adult|dob|age/);

  // city
  await expectValidation('CY1', 'cityCode required', (p) => deletePath(p, 'data.passengers[0].city.cityCode'), /cityCode/);
  await expectValidation('CY2', 'cityName required', (p) => deletePath(p, 'data.passengers[0].city.cityName'), /cityName/);

  // passport MINI/FULL
  await expectValidation('PP1', 'passport required for MINI', (p) => {
    p.data.passportType = 'MINI';
    p.data.passengers[0].passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
  }, /passport|number|expiry/);
  await expectValidation('PP2', 'passport number length', (p) => {
    p.data.passportType = 'MINI';
    p.data.passengers[0].passport = {
      number: 'AB12',
      expiry: '2030-01-01',
      issuedDate: null,
      issuedCountryCode: null,
    };
  }, /passport|number|6 to 12|alphanumeric/);
  await expectValidation('PP3', 'passport expiry too soon', (p) => {
    p.data.passportType = 'MINI';
    p.data.passengers[0].passport = {
      number: 'AB1234567',
      expiry: '2026-09-01', // likely < 6 months from depart depending on search
      issuedDate: null,
      issuedCountryCode: null,
    };
  }, /passport|expiry|6 month/);
  await expectValidation('PP4', 'FULL issuedDate required', (p) => {
    p.data.passportType = 'FULL';
    p.data.passengers[0].passport = {
      number: 'AB1234567',
      expiry: '2030-06-01',
      issuedDate: null,
      issuedCountryCode: 'IN',
    };
  }, /issuedDate|passport/);
  await expectValidation('PP5', 'FULL issuedCountryCode required', (p) => {
    p.data.passportType = 'FULL';
    p.data.passengers[0].passport = {
      number: 'AB1234567',
      expiry: '2030-06-01',
      issuedDate: '2020-01-01',
      issuedCountryCode: null,
    };
  }, /issuedCountry|passport/);

  // ===== 6. Cross-passenger rules =====
  // Helper to add second adult
  const withTwoAdults = (p, mut = () => {}) => {
    const a = p.data.passengers[0];
    p.data.passengers.push({
      ...deepClone(a),
      paxId: 'PAX2',
      isLead: false,
      profile: {
        ...deepClone(a.profile),
        firstName: 'Amit',
        lastName: 'Sharma',
      },
    });
    mut(p);
  };

  await expectValidation('X1', 'exactly one isLead', (p) => {
    withTwoAdults(p);
    p.data.passengers[0].isLead = true;
    p.data.passengers[1].isLead = true;
  }, /isLead|lead|one/);
  await expectValidation('X2', 'no isLead', (p) => {
    withTwoAdults(p);
    p.data.passengers[0].isLead = false;
    p.data.passengers[1].isLead = false;
  }, /isLead|lead/);
  await expectValidation('X3', 'duplicate paxId', (p) => {
    withTwoAdults(p);
    p.data.passengers[1].paxId = p.data.passengers[0].paxId;
  }, /paxId|unique/);
  await expectValidation('X4', 'duplicate first+last name', (p) => {
    withTwoAdults(p);
    p.data.passengers[1].profile.firstName = p.data.passengers[0].profile.firstName;
    p.data.passengers[1].profile.lastName = p.data.passengers[0].profile.lastName;
  }, /firstName|lastName|same|unique|identical|duplicate/);
  await expectValidation('X5', 'firstName == lastName', (p) => {
    p.data.passengers[0].profile.firstName = 'Rohan';
    p.data.passengers[0].profile.lastName = 'Rohan';
  }, /firstName|lastName|identical|same/);
  await expectValidation('X6', 'child as only lead', (p) => {
    p.data.passengers[0].type = 'child';
    p.data.passengers[0].isLead = true;
    p.data.passengers[0].profile.title = 'Mstr';
    p.data.passengers[0].profile.gender = 'Male';
    p.data.passengers[0].profile.dob = '2018-01-01';
  }, /isLead|adult|lead/);
  await expectValidation('X7', 'more infants than adults', (p) => {
    const a = deepClone(p.data.passengers[0]);
    // 1 adult + 2 infants
    p.data.passengers = [
      { ...a, paxId: 'PAX1', type: 'adult', isLead: true },
      {
        ...a,
        paxId: 'PAX2',
        type: 'infant',
        isLead: false,
        profile: {
          ...a.profile,
          title: 'Mstr',
          firstName: 'Baby',
          lastName: 'One',
          gender: 'Male',
          dob: '2025-06-01',
        },
      },
      {
        ...a,
        paxId: 'PAX3',
        type: 'infant',
        isLead: false,
        profile: {
          ...a.profile,
          title: 'Miss',
          firstName: 'Baby',
          lastName: 'Two',
          gender: 'Female',
          dob: '2025-08-01',
        },
      },
    ];
  }, /infant|adult/);
  await expectValidation('X8', 'wrong order child before adult', (p) => {
    const adult = deepClone(p.data.passengers[0]);
    const child = {
      ...deepClone(adult),
      paxId: 'PAX2',
      type: 'child',
      isLead: false,
      profile: {
        ...adult.profile,
        title: 'Mstr',
        firstName: 'Kid',
        lastName: 'Test',
        gender: 'Male',
        dob: '2018-01-01',
      },
    };
    p.data.passengers = [child, { ...adult, paxId: 'PAX1', isLead: true }];
  }, /order|adult|child|infant/);
  await expectValidation('X9', 'child title Mr invalid', (p) => {
    withTwoAdults(p, (pp) => {
      pp.data.passengers[1].type = 'child';
      pp.data.passengers[1].profile.title = 'Mr';
      pp.data.passengers[1].profile.gender = 'Male';
      pp.data.passengers[1].profile.dob = '2018-05-01';
      pp.data.passengers[1].profile.firstName = 'Kid';
      pp.data.passengers[1].profile.lastName = 'Name';
    });
  }, /title|child|Mstr|Miss/);
  await expectValidation('X10', 'duplicate passport numbers', (p) => {
    p.data.passportType = 'MINI';
    withTwoAdults(p);
    const expiry = '2030-12-01';
    p.data.passengers[0].passport = { number: 'AB1234567', expiry, issuedDate: null, issuedCountryCode: null };
    p.data.passengers[1].passport = { number: 'AB1234567', expiry, issuedDate: null, issuedCountryCode: null };
  }, /passport|unique|same|duplicate/);

  // ===== Special characters / commas must be 4xx, never HTTP 500 =====
  await expectNoServerCrash('SC1', 'firstName with trailing comma', (p) => {
    p.data.passengers[0].profile.firstName = 'Rohan,';
  }, { how: `Clone priced issue-ticket; set passengers[0].profile.firstName="Rohan,"; ${API}.` });
  await expectNoServerCrash('SC2', 'lastName with trailing comma', (p) => {
    p.data.passengers[0].profile.lastName = 'Bhagat,';
  }, { how: `Clone priced issue-ticket; set passengers[0].profile.lastName="Bhagat,"; ${API}.` });
  await expectNoServerCrash('SC3', 'firstName with punctuation !@#$', (p) => {
    p.data.passengers[0].profile.firstName = 'Rohan!@#$';
  }, { how: `Clone priced issue-ticket; set firstName="Rohan!@#$"; ${API}.` });
  await expectNoServerCrash('SC4', 'firstName with HTML/script chars', (p) => {
    p.data.passengers[0].profile.firstName = 'Rohan<script>';
  }, { how: `Clone priced issue-ticket; set firstName="Rohan<script>"; ${API}.` });
  await expectNoServerCrash('SC5', 'currency with trailing comma (INR,)', (p) => {
    p.currency = 'INR,';
  }, { how: `Clone priced issue-ticket; set currency="INR,"; ${API}.` });
  await expectNoServerCrash('SC6', 'type with trailing comma (ticket,)', (p) => {
    p.type = 'ticket,';
  }, { how: `Clone priced issue-ticket; set type="ticket,"; ${API}.` });
  await expectNoServerCrash('SC7', 'journeyType with trailing comma', (p) => {
    p.journeyType = 'ONE_WAY,';
  }, { how: `Clone priced issue-ticket; set journeyType="ONE_WAY,"; ${API}.` });
  await expectNoServerCrash('SC8', 'contact.email with comma', (p) => {
    p.data.contact.email = 'rohan,bhagat@travelvip.ai';
  }, { how: `Clone priced issue-ticket; set contact.email="rohan,bhagat@travelvip.ai"; ${API}.` });
  await expectNoServerCrash('SC9', 'contact.mobile with comma', (p) => {
    p.data.contact.mobile = '98765,43210';
  }, { how: `Clone priced issue-ticket; set contact.mobile="98765,43210"; ${API}.` });
  await expectNoServerCrash('SC10', 'searchId with trailing comma', (p) => {
    p.searchIds = [`${p.searchIds[0]},`];
  }, { how: `Clone priced issue-ticket; append comma to searchIds[0]; ${API}.` });
  await expectNoServerCrash('SC11', 'cityName with comma and punctuation', (p) => {
    p.data.passengers[0].city.cityName = 'Pune, <>!';
  }, { how: `Clone priced issue-ticket; set city.cityName="Pune, <>!"; ${API}.` });

  // v1 issue-ticket (same payload rules; no extra live book)
  {
    const payload = deepClone(base);
    delete payload.type;
    const res = await issueV1(payload);
    const crash = (res.status || 0) >= 500;
    const accepted = ok(res) || res.status === 200;
    add(
      'V1-T1',
      `POST ${ISSUE_PATH_V1} — omit type`,
      '/type/',
      crash || accepted ? 'BUG' : (res.status >= 400 ? 'PASS' : 'BUG'),
      crash
        ? `HTTP ${res.status} Internal Server Error — expected 4xx, never 500`
        : (accepted ? 'Accepted invalid v1 payload' : `HTTP ${res.status} code=${errCode(res)}`),
      res,
      {
        how: `Clone priced ticket body, omit type, POST ${ISSUE_PATH_V1}.`,
        expected: 'HTTP 4xx VALIDATION_ERROR (never 500)',
      },
    );
  }
  {
    const payload = deepClone(base);
    payload.data.passengers[0].profile.firstName = 'Rohan,';
    const res = await issueV1(payload);
    const crash = (res.status || 0) >= 500;
    const accepted = ok(res) || res.status === 200;
    add(
      'V1-SC1',
      `POST ${ISSUE_PATH_V1} — firstName with trailing comma`,
      'no-500',
      crash || accepted ? 'BUG' : (res.status >= 400 && res.status < 500 ? 'PASS' : 'BUG'),
      crash
        ? `HTTP ${res.status} Internal Server Error after special chars`
        : (accepted ? 'Accepted v1 payload with comma in firstName' : `HTTP ${res.status} code=${errCode(res)}`),
      res,
      {
        how: `Clone priced ticket body, set firstName="Rohan,", POST ${ISSUE_PATH_V1}.`,
        expected: 'HTTP 4xx (never 500)',
      },
    );
  }
  {
    const payload = deepClone(base);
    payload.searchIds = [`${payload.searchIds[0]},`];
    const res = await issueV1(payload);
    const crash = (res.status || 0) >= 500;
    const accepted = ok(res) || res.status === 200;
    add(
      'V1-SC2',
      `POST ${ISSUE_PATH_V1} — searchId with trailing comma`,
      'no-500',
      crash || accepted ? 'BUG' : (res.status >= 400 && res.status < 500 ? 'PASS' : 'BUG'),
      crash
        ? `HTTP ${res.status} Internal Server Error`
        : (accepted ? 'Accepted v1 payload with comma on searchId' : `HTTP ${res.status} code=${errCode(res)}`),
      res,
      {
        how: `Clone priced ticket body, append comma to searchIds[0], POST ${ISSUE_PATH_V1}.`,
        expected: 'HTTP 4xx (never 500)',
      },
    );
  }

  // Aggregated errors — multiple failures in one request
  {
    const payload = deepClone(base);
    payload.currency = '';
    payload.data.contact.email = 'bad';
    payload.data.contact.mobile = '12';
    payload.data.passengers[0].profile.firstName = 'A';
    const res = await issue(payload);
    const dets = detailsArr(res);
    const envelopeOk = res.status === 400 && errCode(res) === 'VALIDATION_ERROR';
    const multi = dets.length >= 2;
    if (envelopeOk && multi) {
      add('A1', 'multiple validation errors aggregated', '>=2 details', 'PASS', `details count=${dets.length}`, res);
    } else if (envelopeOk && !multi) {
      add('A1', 'multiple validation errors aggregated', '>=2 details', 'BUG', `Only ${dets.length} detail(s) returned for multiple bad fields`, res);
    } else {
      add('A1', 'multiple validation errors aggregated', '>=2 details', 'FAIL', `HTTP ${res.status} code=${errCode(res)}`, res);
    }
  }

  // Doc example type "book" vs our "ticket" — observational
  {
    const payload = deepClone(base);
    payload.type = 'book';
    const res = await issue(payload);
    add('OBS1', 'type=book (doc example)', 'observe', ok(res) || errCode(res) !== 'VALIDATION_ERROR' ? 'INFO' : 'INFO',
      `HTTP ${res.status} code=${errCode(res)} details=${detailsArr(res).join('; ').slice(0, 120)}`, res);
  }

  const summary = {
    baseUrl: config.baseUrl,
    issuePath: ISSUE_PATH,
    searchMeta,
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      FAIL: rows.filter((r) => r.status === 'FAIL').length,
      BUG: rows.filter((r) => r.status === 'BUG').length,
      INFO: rows.filter((r) => r.status === 'INFO').length,
      total: rows.length,
    },
    bugs: rows.filter((r) => r.status === 'BUG'),
    fails: rows.filter((r) => r.status === 'FAIL'),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY (Dev) ===');
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log('BUGS:', summary.bugs.map((b) => `${b.id} ${b.rule} — ${b.note}`));
  console.log('FAILS:', summary.fails.map((b) => `${b.id} ${b.rule} — ${b.note}`));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});

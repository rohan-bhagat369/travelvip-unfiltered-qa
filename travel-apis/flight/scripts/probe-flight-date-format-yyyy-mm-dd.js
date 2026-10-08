/**
 * Check all flight date fields enforce YYYY-MM-DD on staging.
 * Run: node scripts/probe-flight-date-format-yyyy-mm-dd.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', process.env.FLIGHT_DATE_OUT || 'flight-date-format-yyyy-mm-dd-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function details(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function brief(d, n = 400) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function main() {
  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const rows = [];

  const add = (id, field, input, expectReject, status, note, res) => {
    rows.push({
      id, field, input, expectReject, status, note,
      http: res?.status ?? null,
      code: errCode(res),
      details: details(res),
      snippet: res ? brief(res.data) : null,
      at: new Date().toISOString(),
    });
    console.log(`[${status}] ${id} ${field} input=${input}`);
    console.log(' HTTP', res?.status, errCode(res), (details(res)[0] || '').slice(0, 140));
  };

  // ---- SEARCH itinerary.date ----
  async function searchWithDate(dateStr) {
    const body = buildOneWaySearchBody(21, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    body.itinerary[0].date = dateStr;
    return flight.search(body);
  }

  const searchCases = [
    { id: 'S1', input: '2026-09-15', expectReject: false, label: 'itinerary.date YYYY-MM-DD valid' },
    { id: 'S2', input: '15-09-2026', expectReject: true, label: 'itinerary.date DD-MM-YYYY' },
    { id: 'S3', input: '15/09/2026', expectReject: true, label: 'itinerary.date DD/MM/YYYY' },
    { id: 'S4', input: '09/15/2026', expectReject: true, label: 'itinerary.date MM/DD/YYYY' },
    { id: 'S5', input: '2026/09/15', expectReject: true, label: 'itinerary.date YYYY/MM/DD' },
    { id: 'S6', input: '20260915', expectReject: true, label: 'itinerary.date YYYYMMDD' },
  ];

  for (const c of searchCases) {
    const res = await searchWithDate(c.input);
    const rejected = !ok(res) || errCode(res) === 'VALIDATION_ERROR' || res.status === 400;
    if (!c.expectReject) {
      add(c.id, c.label, c.input, false, ok(res) ? 'PASS' : 'FAIL', ok(res) ? 'valid accepted' : 'valid rejected', res);
    } else if (rejected) {
      add(c.id, c.label, c.input, true, 'PASS', 'invalid rejected', res);
    } else {
      add(c.id, c.label, c.input, true, 'BUG', 'invalid date accepted by search', res);
    }
  }

  // ---- ISSUE TICKET dates: need priced baseline ----
  let base = null;
  for (const days of [18, 25, 32]) {
    const body = buildOneWaySearchBody(days, { origin: 'DEL', destination: 'BOM', fareType: 'NORMAL' });
    body.preferences = { airlines: ['SG'], maxStops: 0, refundableOnly: false };
    let search = null;
    for (let i = 0; i < 8; i += 1) {
      search = await flight.search(body);
      const sid = extractFirstSearchId(search.data);
      if (ok(search) && sid && (isSearchProgressComplete(search.data) || i > 2)) {
        const pricing = await flight.getPricing([sid], 'ONE_WAY');
        if (ok(pricing) && pricing.data?.bookingContext && pricing.data?.priceId) {
          base = buildIssueTicketPayload({
            bookingContext: pricing.data.bookingContext,
            priceId: pricing.data.priceId,
            searchIds: [sid],
            journeyType: 'ONE_WAY',
          });
          break;
        }
      }
      await sleep(2500);
    }
    if (base) break;
  }
  if (!base) throw new Error('Could not price baseline for issue-ticket date tests');

  const issue = (payload) => client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: FLIGHT_QUERY,
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  function clone() {
    return JSON.parse(JSON.stringify(base));
  }

  async function expectDob(id, label, dob, expectReject) {
    const p = clone();
    p.data.passengers[0].profile.dob = dob;
    const res = await issue(p);
    const valErr = res.status === 400 && errCode(res) === 'VALIDATION_ERROR';
    const acceptedPastValidation = ok(res) || errCode(res) === 'INSUFFICIENT_BALANCE'
      || /insufficient|wallet/i.test(JSON.stringify(res.data || {}));
    if (!expectReject) {
      // valid format — may fail wallet but must NOT be date validation error
      const dateValFail = valErr && /dob|date|format|yyyy/i.test(details(res).join(' '));
      add(id, label, dob, false, dateValFail ? 'FAIL' : 'PASS',
        dateValFail ? 'valid DOB rejected' : `not date-blocked (HTTP ${res.status} ${errCode(res)})`, res);
      return;
    }
    if (valErr && /dob|date|format|yyyy|valid/i.test(details(res).join(' ').toLowerCase() + JSON.stringify(res.data).toLowerCase())) {
      add(id, label, dob, true, 'PASS', 'invalid DOB rejected', res);
    } else if (acceptedPastValidation) {
      add(id, label, dob, true, 'BUG', 'invalid DOB accepted past validation', res);
    } else {
      add(id, label, dob, true, 'FAIL', `unexpected HTTP ${res.status} ${errCode(res)}`, res);
    }
  }

  console.log('\n=== DOB format ===');
  await expectDob('D1', 'passenger.dob YYYY-MM-DD valid', '2001-05-29', false);
  await expectDob('D2', 'passenger.dob DD-MM-YYYY', '29-05-2001', true);
  await expectDob('D3', 'passenger.dob DD/MM/YYYY', '29/05/2001', true);
  await expectDob('D4', 'passenger.dob MM/DD/YYYY', '05/29/2001', true);
  await expectDob('D5', 'passenger.dob YYYY/MM/DD', '2001/05/29', true);

  // Passport dates with MINI/FULL
  async function expectPassport(id, label, mutator, expectReject, hint) {
    const p = clone();
    p.data.passportType = 'FULL';
    p.data.passengers[0].passport = {
      number: 'AB1234567',
      expiry: '2030-06-01',
      issuedDate: '2020-01-15',
      issuedCountryCode: 'IN',
    };
    mutator(p);
    const res = await issue(p);
    const valErr = res.status === 400 && errCode(res) === 'VALIDATION_ERROR';
    const text = (details(res).join(' ') + brief(res.data)).toLowerCase();
    const acceptedPastValidation = ok(res) || errCode(res) === 'INSUFFICIENT_BALANCE'
      || /insufficient|wallet/i.test(JSON.stringify(res.data || {}));
    if (!expectReject) {
      const dateValFail = valErr && hint.test(text);
      add(id, label, 'see mutator', false, dateValFail ? 'FAIL' : 'PASS',
        `HTTP ${res.status} ${errCode(res)}`, res);
      return;
    }
    if (valErr && hint.test(text)) {
      add(id, label, 'invalid format', true, 'PASS', 'rejected', res);
    } else if (acceptedPastValidation) {
      add(id, label, 'invalid format', true, 'BUG', 'accepted past validation', res);
    } else if (valErr) {
      add(id, label, 'invalid format', true, 'PASS', `rejected (other detail): ${details(res)[0]}`, res);
    } else {
      add(id, label, 'invalid format', true, 'FAIL', `HTTP ${res.status} ${errCode(res)}`, res);
    }
  }

  console.log('\n=== Passport dates ===');
  await expectPassport('P1', 'passport.expiry YYYY-MM-DD valid', () => {}, false, /expiry/);
  await expectPassport('P2', 'passport.expiry DD-MM-YYYY', (p) => {
    p.data.passengers[0].passport.expiry = '01-06-2030';
  }, true, /expiry|date|format|yyyy|valid/);
  await expectPassport('P3', 'passport.expiry DD/MM/YYYY', (p) => {
    p.data.passengers[0].passport.expiry = '01/06/2030';
  }, true, /expiry|date|format|yyyy|valid/);
  await expectPassport('P4', 'passport.issuedDate DD-MM-YYYY', (p) => {
    p.data.passengers[0].passport.issuedDate = '15-01-2020';
  }, true, /issuedDate|date|format|yyyy|valid/);
  await expectPassport('P5', 'passport.issuedDate DD/MM/YYYY', (p) => {
    p.data.passengers[0].passport.issuedDate = '15/01/2020';
  }, true, /issuedDate|date|format|yyyy|valid/);

  // RT search return date bad format
  console.log('\n=== RT itinerary dates ===');
  {
    const body = {
      itinerary: [
        { origin: 'DEL', destination: 'BOM', date: '2026-09-10' },
        { origin: 'BOM', destination: 'DEL', date: '20-09-2026' },
      ],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      journeyType: 'ROUND_TRIP',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops: null, refundableOnly: false },
      appliedFilters: {},
      selection: { selectedSearchIds: [] },
      fareType: 'NORMAL',
    };
    const res = await flight.search(body);
    const rejected = !ok(res) || errCode(res) === 'VALIDATION_ERROR' || res.status === 400;
    add('R1', 'RT return date DD-MM-YYYY', '20-09-2026', true,
      rejected ? 'PASS' : 'BUG', rejected ? 'rejected' : 'accepted', res);
  }
  {
    const body = {
      itinerary: [
        { origin: 'DEL', destination: 'BOM', date: '10-09-2026' },
        { origin: 'BOM', destination: 'DEL', date: '2026-09-20' },
      ],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      journeyType: 'ROUND_TRIP',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops: null, refundableOnly: false },
      appliedFilters: {},
      selection: { selectedSearchIds: [] },
      fareType: 'NORMAL',
    };
    const res = await flight.search(body);
    const rejected = !ok(res) || errCode(res) === 'VALIDATION_ERROR' || res.status === 400;
    add('R2', 'RT onward date DD-MM-YYYY', '10-09-2026', true,
      rejected ? 'PASS' : 'BUG', rejected ? 'rejected' : 'accepted', res);
  }

  const summary = {
    baseUrl: config.baseUrl,
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      BUG: rows.filter((r) => r.status === 'BUG').length,
      FAIL: rows.filter((r) => r.status === 'FAIL').length,
      total: rows.length,
    },
    bugs: rows.filter((r) => r.status === 'BUG'),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.counts, null, 2));
  console.log('BUGS:', summary.bugs.map((b) => `${b.id} ${b.field} input=${b.input}`));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});

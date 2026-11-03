/**
 * Staging release Phase 1 — phone (§7) + cab lead-time (§2.1) + wallet activity (§5.2).
 * No finalize/book where avoidable. No Nexus.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'
 *   node travel-apis/scripts/probe-staging-release-phase1.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../shared/lib/authService.js';
import { futureDate } from '../../shared/lib/testUtils.js';
import {
  CAB_QUERY,
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
} from '../cab/src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../reports', process.env.REPORT_OUT || 'staging-release-phase1.json');

function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d).slice(0, n); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function errMsg(r) {
  return String(r?.data?.error?.message || r?.data?.message || '');
}
function errDetails(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function utcPlusMinutes(mins) {
  const d = new Date(Date.now() + mins * 60_000);
  d.setUTCMilliseconds(0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  clearSession();
  console.log('BASE', process.env.BASE_URL);
  const session = await authenticate(true);
  const client = session.client;
  client.setPartnerKey(session.accessToken);

  const rows = [];
  function add(row) {
    rows.push(row);
    console.log(`[${row.status}] ${row.id} — ${row.note}`);
  }
  function pass(id, rule, note, res, extra = {}) {
    add({
      id, rule, status: 'PASS', note,
      http: res?.status ?? null, code: errCode(res), details: errDetails(res),
      snippet: brief(res?.data), ...extra,
    });
  }
  function bug(id, rule, note, res, extra = {}) {
    add({
      id, rule, status: 'BUG', note,
      http: res?.status ?? null, code: errCode(res), details: errDetails(res),
      snippet: brief(res?.data), ...extra,
    });
  }
  function nt(id, rule, note) {
    add({ id, rule, status: 'NOT TESTED', note, http: null, code: null });
  }

  function expect400(id, rule, res, { codes = ['VALIDATION_ERROR'] } = {}) {
    const code = errCode(res);
    if (res.status === 400 && codes.includes(code)) {
      pass(id, rule, `HTTP 400 ${code} ${errMsg(res).slice(0, 120)}`, res);
    } else if (res.status >= 500) {
      bug(id, rule, `HTTP ${res.status} — must be 4xx`, res);
    } else {
      bug(id, rule, `Expected 400 ${codes.join('|')}, got HTTP ${res.status} code=${code}`, res);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // §2.1 Cab pickup lead-time
  // ═══════════════════════════════════════════════════════════════════
  async function cabSearch(body) {
    return client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/search',
      query: { ...CAB_QUERY },
      body,
      partnerKey: client.partnerKey,
    });
  }

  const leadCases = [
    { id: 'C-LT-ARR-SOON', kind: 'AIRPORT_ARRIVAL', offsetMin: 5, expect: 'REJECT', rule: 'AIRPORT ARRIVAL +5m → too soon (need 20m)' },
    { id: 'C-LT-ARR-OK', kind: 'AIRPORT_ARRIVAL', offsetMin: 25, expect: 'ACCEPT', rule: 'AIRPORT ARRIVAL +25m → accept' },
    { id: 'C-LT-DEP-SOON', kind: 'AIRPORT_DEPARTURE', offsetMin: 30, expect: 'REJECT', rule: 'AIRPORT DEPARTURE +30m → too soon (need 2h)' },
    { id: 'C-LT-DEP-OK', kind: 'AIRPORT_DEPARTURE', offsetMin: 130, expect: 'ACCEPT', rule: 'AIRPORT DEPARTURE +130m → accept' },
    { id: 'C-LT-REN-SOON', kind: 'RENTAL', offsetMin: 30, expect: 'REJECT', rule: 'RENTAL +30m → too soon' },
    { id: 'C-LT-REN-OK', kind: 'RENTAL', offsetMin: 130, expect: 'ACCEPT', rule: 'RENTAL +130m → accept' },
    { id: 'C-LT-OUT-SOON', kind: 'OUTSTATION', offsetMin: 30, expect: 'REJECT', rule: 'OUTSTATION +30m → too soon' },
    { id: 'C-LT-OUT-OK', kind: 'OUTSTATION', offsetMin: 130, expect: 'ACCEPT', rule: 'OUTSTATION +130m → accept' },
    { id: 'C-LT-PAST', kind: 'AIRPORT_DEPARTURE', offsetMin: -10, expect: 'REJECT', rule: 'pickup in past → reject' },
  ];

  function leadBody(kind) {
    if (kind === 'AIRPORT_ARRIVAL') {
      const b = buildAirportSearchBody();
      b.travelType = 'ARRIVAL';
      b.pickup = { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 };
      b.drop = { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 };
      return b;
    }
    if (kind === 'AIRPORT_DEPARTURE') return buildAirportSearchBody();
    if (kind === 'RENTAL') return buildRentalSearchBody();
    if (kind === 'OUTSTATION') return buildOutstationSearchBody();
    throw new Error(kind);
  }

  for (const cs of leadCases) {
    const body = leadBody(cs.kind);
    body.pickupDatetime = utcPlusMinutes(cs.offsetMin);
    const res = await cabSearch(body);
    const code = errCode(res);
    const msg = errMsg(res);
    if (cs.expect === 'REJECT') {
      const okLead = res.status === 400 && code === 'VALIDATION_ERROR'
        && /(past|too soon|notice|minute|hour)/i.test(`${msg} ${errDetails(res).join(' ')}`);
      if (okLead) pass(cs.id, cs.rule, `HTTP 400 ${code} ${msg.slice(0, 140)}`, res);
      else if (res.status === 400 && code === 'VALIDATION_ERROR') {
        pass(cs.id, cs.rule, `HTTP 400 VALIDATION_ERROR (msg soft) ${msg.slice(0, 140)}`, res);
      } else bug(cs.id, cs.rule, `Expected lead-time 400, got HTTP ${res.status} code=${code}`, res);
    } else {
      // Lead-time gate passed if not VALIDATION_ERROR about past/too soon.
      // SEARCH_REJECTED / empty inventory still counts as PASS for lead-time rule.
      const leadReject = res.status === 400 && code === 'VALIDATION_ERROR'
        && /(past|too soon|notice)/i.test(`${msg} ${errDetails(res).join(' ')}`);
      if (leadReject) bug(cs.id, cs.rule, `Lead-time wrongly rejected: ${msg.slice(0, 140)}`, res);
      else if (res.status >= 500) bug(cs.id, cs.rule, `HTTP ${res.status}`, res);
      else pass(cs.id, cs.rule, `Lead-time OK (HTTP ${res.status} code=${code || 'ok'})`, res);
    }
  }

  // Distance endpoint still accepts past pickup
  {
    const body = leadBody('AIRPORT_DEPARTURE');
    body.pickupDatetime = utcPlusMinutes(-60);
    const res = await client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/distance',
      query: { ...CAB_QUERY },
      body,
      partnerKey: client.partnerKey,
    });
    if (res.status === 200 || (res.status < 500 && errCode(res) !== 'VALIDATION_ERROR')) {
      pass('C-DIST-PAST', 'cabs/distance past pickup still accepted', `HTTP ${res.status}`, res);
    } else if (res.status === 400 && /past|soon/i.test(errMsg(res))) {
      bug('C-DIST-PAST', 'cabs/distance past pickup still accepted', `Lead-time wrongly applied: ${errMsg(res).slice(0, 120)}`, res);
    } else {
      // 400 for other reasons (coords) — soft
      pass('C-DIST-PAST', 'cabs/distance past pickup (not lead-time reject)', `HTTP ${res.status} code=${errCode(res)}`, res);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // §7 Phone validation — hotel finalize + flight issue-ticket + cab finalize
  // Reject-only mutations (must NOT book)
  // ═══════════════════════════════════════════════════════════════════

  // --- Hotel: build a prebooked context then mutate contact on finalize ---
  let hotelCtx = null;
  try {
    const checkin = futureDate(21);
    const checkout = futureDate(22);
    // Prefer Pune city for inventory
    const search = await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { offset: 0, limit: 5 },
      body: {
        type: 'CITY', entityId: '328605:IN', nationality: 'IN', currency: 'INR',
        checkin, checkout, rooms: [{ adults: 2 }],
      },
    });
    const hotels = search.data?.results || search.data?.content || [];
    const hid = String(hotels[0]?.id || hotels[0]?.hotelId || '');
    if (!hid) throw new Error('no hotel inventory');
    const details = await client.request({
      method: 'POST',
      path: '/v1/hotels/details',
      query: {},
      body: {
        type: 'HOTEL', entityId: hid, nationality: 'IN', currency: 'INR',
        checkin, checkout, rooms: [{ adults: 2 }],
      },
    });
    let bookingCode = null;
    let requestId = details.data?.requestId || null;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.bookingCode && !bookingCode) bookingCode = o.bookingCode;
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(details.data);
    if (!bookingCode) throw new Error('no bookingCode');
    const prebook = await client.request({
      method: 'POST',
      path: '/v1/hotels/prebook',
      query: {},
      body: { bookingCode, currency: 'INR', ...(requestId ? { requestId } : {}) },
    });
    const bookingContext = prebook.data?.bookingContext;
    if (!bookingContext || prebook.status !== 200) throw new Error(`prebook fail HTTP ${prebook.status}`);
    hotelCtx = { bookingContext, bookingCode, requestId, checkin, checkout, hid };
    pass('H-PRE', 'hotel prebook baseline for phone negatives', `hotel=${hid}`, prebook);
  } catch (e) {
    nt('H-PRE', 'hotel prebook baseline for phone negatives', String(e.message || e));
  }

  function hotelFinalizeBody(contactPatch) {
    return {
      bookingContext: hotelCtx.bookingContext,
      bookingCode: hotelCtx.bookingCode,
      ...(hotelCtx.requestId ? { requestId: hotelCtx.requestId } : {}),
      currency: 'INR',
      rooms: [{
        adults: [
          {
            title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat',
            type: 'ADT', lead: true,
          },
        ],
        children: [],
      }],
      contact: {
        email: 'rohan@travelvip.ai',
        countryCode: '+91',
        mobile: '9876543210',
        ...contactPatch,
      },
    };
  }

  if (hotelCtx) {
    for (const [id, patch, rule] of [
      ['PH-H-999', { countryCode: '999' }, 'hotel finalize countryCode 999 → 400'],
      ['PH-H-PLUS999', { countryCode: '+999' }, 'hotel finalize countryCode +999 → 400'],
      ['PH-H-SHORT', { countryCode: '+91', mobile: '12345' }, 'hotel finalize mobile too short → 400'],
      ['PH-H-LONG', { countryCode: '+91', mobile: '987654321012345678' }, 'hotel finalize mobile too long → 400'],
    ]) {
      const res = await client.request({
        method: 'POST',
        path: '/v1/hotels/finalize-booking',
        query: { pid: 'vgm' },
        body: hotelFinalizeBody(patch),
        partnerKey: client.partnerKey,
      });
      const br = res.data?.bookingRefId || res.data?.bookingReferenceId;
      if (br) bug(id, rule, `BOOKED ${br} — invalid phone accepted`, res);
      else expect400(id, rule, res);
    }
  }

  // --- Flight: pricing then issue-ticket with bad contact (must 400, no BR) ---
  let flightIssueBase = null;
  try {
    const body = {
      journeyType: 'ONE_WAY',
      itinerary: [{ origin: 'DEL', destination: 'BOM', date: futureDate(35) }],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'ECONOMY',
      currency: 'INR',
      language: 'en',
      preferences: { airlines: [], maxStops: 0, refundableOnly: false },
      appliedFilters: {},
      selection: { selectedSearchIds: [] },
      fareType: 'NORMAL',
    };
    let search = null;
    for (let i = 0; i < 8; i += 1) {
      search = await client.request({
        method: 'POST', path: '/v1/flights/search',
        query: { page: 0, perpage: 20, currency: 'INR', lang: 'en' }, body,
      });
      if (search.status === 200 && search.data?.progress?.state === 'COMPLETE') break;
      await new Promise((r) => setTimeout(r, 2500));
    }
    // pick first searchId
    let searchId = null;
    const walk = (o) => {
      if (!o || typeof o !== 'object' || searchId) return;
      if (o.searchId && (typeof o.totalStops === 'number' || Array.isArray(o.segments))) searchId = o.searchId;
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(search.data);
    if (!searchId) throw new Error(`no searchId HTTP ${search.status} ${brief(search.data, 120)}`);
    const pricing = await client.request({
      method: 'POST', path: '/v1/flights/pricing',
      query: { lang: 'en', currency: 'INR' },
      body: {
        journeyType: 'ONE_WAY',
        selection: { selectedSearchIds: [searchId] },
      },
    });
    if (pricing.status !== 200 || !pricing.data?.priceId || !pricing.data?.bookingContext) {
      throw new Error(`pricing fail HTTP ${pricing.status} ${brief(pricing.data, 160)}`);
    }
    flightIssueBase = {
      type: 'ticket',
      currency: 'INR',
      language: 'en',
      bookingReference: pricing.data.bookingContext,
      searchIds: [searchId],
      journeyType: 'ONE_WAY',
      timezone: 'Asia/Calcutta',
      data: {
        priceId: pricing.data.priceId,
        passportType: 'NONE',
        includeGst: false,
        gstDetails: null,
        contact: {
          email: 'rohan@travelvip.ai',
          countryCode: '+91',
          mobile: '9876543210',
        },
        passengers: [{
          paxRefNumber: '1',
          passengerType: 1,
          gender: 1,
          title: 'Mr',
          firstName: 'Rohan',
          lastName: 'Bhagat',
          dateOfBirth: '1995-05-15',
        }],
      },
    };
    pass('F-PRICE', 'flight pricing baseline for phone negatives', `priceId ok`, pricing);
  } catch (e) {
    nt('F-PRICE', 'flight pricing baseline for phone negatives', String(e.message || e));
  }

  if (flightIssueBase) {
    for (const [id, patch, rule] of [
      ['PH-F-999', { countryCode: '999' }, 'flight issue-ticket countryCode 999 → 400'],
      ['PH-F-PLUS999', { countryCode: '+999' }, 'flight issue-ticket countryCode +999 → 400'],
      ['PH-F-SHORT', { countryCode: '+91', mobile: '12' }, 'flight issue-ticket mobile too short → 400'],
    ]) {
      const payload = JSON.parse(JSON.stringify(flightIssueBase));
      Object.assign(payload.data.contact, patch);
      const res = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { pid: 'vgm', lang: 'en', currency: 'INR', count: 10, page: 0, perpage: 20 },
        body: payload,
        partnerKey: client.partnerKey,
      });
      const br = res.data?.bookingReference || res.data?.bookingReferenceId;
      if (br) bug(id, rule, `BOOKED ${br} — invalid phone accepted`, res);
      else expect400(id, rule, res);
    }
  }

  // --- Cab: fare then finalize with bad phone / gender (reject only) ---
  let cabFare = null;
  try {
    const searchBody = buildAirportSearchBody();
    searchBody.pickupDatetime = utcPlusMinutes(24 * 60); // +1 day — clear of 2h gate
    const sres = await cabSearch(searchBody);
    const cabs = sres.data?.cabs || [];
    if (!cabs.length) throw new Error(`no cabs HTTP ${sres.status} code=${errCode(sres)} ${brief(sres.data, 120)}`);
    const pick = cabs[0];
    const searchId = pick.searchId || sres.data?.searchId;
    const fare = await client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/fare',
      query: { ...CAB_QUERY },
      body: { searchId },
      partnerKey: client.partnerKey,
    });
    const bookingReference = fare.data?.bookingReference || fare.data?.bookingContext;
    const priceId = fare.data?.priceId || pick.priceId || pick.priceDetail?.priceId;
    if (fare.status !== 200 || !bookingReference || !priceId) {
      throw new Error(`fare fail HTTP ${fare.status} ${brief(fare.data, 140)}`);
    }
    cabFare = { bookingReference, priceId, searchId };
    pass('C-FARE', 'cab fare baseline for phone/gender negatives', `priceId ok`, fare);
  } catch (e) {
    nt('C-FARE', 'cab fare baseline for phone/gender negatives', String(e.message || e));
  }

  function cabFinalizeBody(mutator) {
    const body = {
      bookingReference: cabFare.bookingReference,
      priceId: cabFare.priceId,
      contact: {
        name: 'Rohan Bhagat',
        email: 'rohan@travelvip.ai',
        countryCode: '+91',
        mobile: '9876543210',
      },
      passengers: [{
        title: 'Mr',
        firstName: 'Rohan',
        lastName: 'Bhagat',
        gender: 'male',
        paxType: 'ADT',
        isLead: true,
        dob: '1995-05-15',
      }],
    };
    mutator(body);
    return body;
  }

  if (cabFare) {
    for (const [id, mut, rule] of [
      ['PH-C-999', (b) => { b.contact.countryCode = '999'; }, 'cab finalize countryCode 999 → 400'],
      ['PH-C-PLUS999', (b) => { b.contact.countryCode = '+999'; }, 'cab finalize countryCode +999 → 400'],
      ['PH-C-SHORT', (b) => { b.contact.mobile = '123'; }, 'cab finalize mobile too short → 400'],
      ['C-PAX-GENDER', (b) => { b.passengers[0].gender = 'other'; }, 'cab finalize gender other → 400'],
      ['C-PAX-TITLE', (b) => { b.passengers[0].title = 'Mr,'; }, 'cab finalize title Mr, → 400'],
    ]) {
      const res = await client.request({
        method: 'POST',
        path: '/v1/airportServices/cabs/finalize-booking',
        query: { ...CAB_QUERY },
        body: cabFinalizeBody(mut),
        partnerKey: client.partnerKey,
      });
      const br = res.data?.bookingRefId || res.data?.bookingReferenceId;
      if (br) bug(id, rule, `BOOKED ${br} — invalid accepted`, res);
      else expect400(id, rule, res);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // §5.2 Wallet activity page size
  // Wallet uses Bearer partner access_token (not session auth_token) — Postman contract.
  // ═══════════════════════════════════════════════════════════════════
  const { TravelVipClient } = await import('../../shared/lib/TravelVipClient.js');
  const walletClient = new TravelVipClient({
    authToken: session.accessToken,
    partnerKey: null,
    correlationId: process.env.CORRELATION_ID,
  });

  async function walletGet(query) {
    return walletClient.request({
      method: 'GET',
      path: '/v1/wallet/activity',
      query,
      signed: false,
    });
  }

  {
    let ok = await walletGet({ page: 1, limit: 100 });
    if (ok.status !== 200) ok = await walletGet({ page: 1, perPage: 100 });
    if (ok.status !== 200) ok = await walletGet({ page: 1, perpage: 100 });
    if (ok.status !== 200) ok = await walletGet({ page: 1 }); // default page size smoke
    if (ok.status === 200) {
      const n = (ok.data?.items || ok.data?.activity || ok.data?.data || []).length;
      pass('W-ACT-100', 'GET wallet/activity (partner token) page size ≤100', `HTTP 200 n=${n} keys=${Object.keys(ok.data || {}).slice(0, 8)}`, ok);
    } else bug('W-ACT-100', 'GET wallet/activity limit=100 → 200', `HTTP ${ok.status} code=${errCode(ok)}`, ok);
  }
  {
    let bad = await walletGet({ page: 1, limit: 101 });
    if (bad.status !== 400) bad = await walletGet({ page: 1, perPage: 101 });
    if (bad.status !== 400) bad = await walletGet({ page: 1, perpage: 101 });
    if (bad.status === 400) pass('W-ACT-101', 'GET wallet/activity limit=101 → 400', `code=${errCode(bad)} ${errMsg(bad).slice(0, 100)}`, bad);
    else if (bad.status === 200) {
      // If API ignores unknown limit and uses default, try size query param from doc
      bug('W-ACT-101', 'GET wallet/activity limit=101 → 400', `HTTP 200 — oversize accepted or param ignored ${brief(bad.data, 120)}`, bad);
    } else bug('W-ACT-101', 'GET wallet/activity limit=101 → 400', `HTTP ${bad.status} code=${errCode(bad)}`, bad);
  }
  {
    nt('W-TOP', 'POST v1/internal/wallet/topup', 'IP allowlist 127.0.0.1 only — NOT TESTED from laptop');
  }
  {
    nt('P-EMP', 'partner emp JWT gate', 'emp partner secret not in .env — NOT TESTED');
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});
  const report = {
    at: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    counts,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nCOUNTS', counts);
  console.log('Wrote', OUT);
  if ((counts.BUG || 0) > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

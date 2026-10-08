/**
 * Retest cab validation rows after product replies (staging).
 *
 *   node scripts/probe-cab-product-fix-retest.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
  buildFinalizeBody,
  pickCab,
  futurePickupDatetime,
  CAB_QUERY,
} from '../src/helpers.js';

const BASE = (process.env.BASE_URL || 'https://api-staging.travelvip.ai').replace(/\/$/, '');
const OUT = 'reports/cab-product-fix-retest.json';
const SETTLE_MS = Number(process.env.CANCEL_SETTLE_MS || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

clearSession();
process.env.BASE_URL = BASE;
const { client } = await authenticate(true);
const cab = new CabService(client);

const rows = [];
const summary = { PASS: 0, BUG: 0, NOTE: 0, 'NOT TESTED': 0 };
const booked = [];

function add(row) {
  rows.push(row);
  summary[row.status] = (summary[row.status] || 0) + 1;
  console.log(row.status.padEnd(11), row.id, row.actual);
}

function ymdYearsAgo(years, month = 6, day = 15) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years, month - 1, day);
  return d.toISOString().slice(0, 10);
}

function ymdDaysAhead(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function uniqueLast() {
  return `Ret${Date.now().toString(36).replace(/[0-9]/g, 'x')}`;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function errOf(res) {
  const e = res?.data?.error;
  return {
    http: res.status,
    code: e?.code || res.data?.code || null,
    message: e?.message || res.data?.message || null,
    br: res.data?.bookingRefId || null,
    status: res.data?.status || null,
    cabs: Array.isArray(res.data?.cabs) ? res.data.cabs.length : null,
  };
}

function briefRes(res) {
  const e = errOf(res);
  return `HTTP ${e.http}${e.code ? ` ${e.code}` : ''}${e.message ? ` ${JSON.stringify(e.message).slice(0, 120)}` : ''}${e.br ? ` BR=${e.br}` : ''}${e.cabs != null ? ` cabs=${e.cabs}` : ''}`;
}

async function cancelBr(br, reason = 'product-fix retest cleanup') {
  if (!br) return;
  await sleep(SETTLE_MS);
  await client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: CAB_QUERY,
    partnerKey: client.partnerKey,
    body: { cancelledBy: 'USER', cancellationReason: reason },
  });
}

async function freshFare(searchBody) {
  const search = await cab.search(searchBody);
  const c0 = pickCab(search.data?.cabs || []);
  if (!c0?.searchId) return { search, fare: null };
  const fare = await cab.fare(c0.searchId);
  if (!fare.ok || !fare.data?.bookingReference) return { search, fare: null };
  return { search, fare };
}

function tagBody(body) {
  const b = clone(body);
  if (b.passengers?.[0]?.profile) b.passengers[0].profile.lastName = uniqueLast();
  return b;
}

async function finalizeMutate(mutate) {
  const { fare } = await freshFare(buildAirportSearchBody(futurePickupDatetime(12)));
  if (!fare?.data?.bookingReference || !fare.data?.priceId) return { noFare: true };
  const body = tagBody(buildFinalizeBody({
    bookingReference: fare.data.bookingReference,
    priceId: fare.data.priceId,
  }));
  mutate(body);
  const res = await cab.finalizeBooking(body);
  const br = res.data?.bookingRefId || null;
  if (res.status === 200 && br) booked.push(br);
  return { body, res, br, fare: fare.data };
}

function scoreReject(id, rule, product, res, extra = {}) {
  const e = errOf(res);
  const accepted = e.http === 200 && !!e.br;
  let status;
  let actual = briefRes(res);
  if (e.http >= 500) status = 'BUG';
  else if (accepted) status = 'BUG';
  else if (e.http >= 400 && e.http < 500) status = 'PASS';
  else status = 'BUG';
  add({
    id, rule, product, expect: 'REJECT 4xx', status, actual,
    http: e.http, code: e.code, message: e.message, bookingRefId: e.br, ...extra,
  });
}

function scoreAccept(id, rule, product, res, extra = {}) {
  const e = errOf(res);
  const accepted = e.http === 200;
  let status = accepted ? 'PASS' : 'BUG';
  if (e.http >= 500) status = 'BUG';
  add({
    id, rule, product, expect: 'ACCEPT 200', status, actual: briefRes(res),
    http: e.http, code: e.code, message: e.message, bookingRefId: e.br, ...extra,
  });
}

console.log('base', config.baseUrl, 'auth OK');

// ---------- 1 priceId ----------
console.log('\n=== 1 priceId ===');
{
  const omit = await finalizeMutate((b) => { delete b.priceId; });
  if (omit.noFare) add({ id: '1a', rule: 'omit priceId', product: 'not mandatory', status: 'NOT TESTED', actual: 'no fare' });
  else scoreAccept('1a', 'omit priceId still books', 'priceId is not mandatory', omit.res, { payload: { priceId: '(omitted)' } });

  const bad = await finalizeMutate((b) => { b.priceId = 'BADPRICE'; });
  if (bad.noFare) add({ id: '1b', rule: 'garbage priceId', product: 'not stated; fare lock', status: 'NOT TESTED', actual: 'no fare' });
  else {
    // Product only said omit is OK. Garbage that still books is still no fare lock.
    const e = errOf(bad.res);
    const accepted = e.http === 200 && !!e.br;
    add({
      id: '1b',
      rule: 'garbage priceId BADPRICE',
      product: 'not addressed (only said omit is OK)',
      expect: 'REJECT 4xx (fare lock)',
      status: accepted ? 'BUG' : (e.http >= 400 && e.http < 500 ? 'PASS' : 'BUG'),
      actual: briefRes(bad.res),
      http: e.http, code: e.code, message: e.message, bookingRefId: e.br,
      payload: { priceId: 'BADPRICE' },
    });
  }
}

// ---------- 2 DOB format / required ----------
console.log('\n=== 2 DOB format ===');
{
  const dobCases = [
    { id: '2a', rule: 'omit profile.dob', mutate: (b) => { delete b.passengers[0].profile.dob; } },
    { id: '2b', rule: 'dob empty', mutate: (b) => { b.passengers[0].profile.dob = ''; } },
    { id: '2c', rule: 'dob garbage', mutate: (b) => { b.passengers[0].profile.dob = 'not-a-date'; } },
    { id: '2d', rule: 'dob future', mutate: (b) => { b.passengers[0].profile.dob = ymdDaysAhead(30); } },
    { id: '2e', rule: 'dob DD-MM-YYYY', mutate: (b) => { b.passengers[0].profile.dob = '02-01-1990'; } },
    { id: '2f', rule: 'dob HTML', mutate: (b) => { b.passengers[0].profile.dob = '<script>1990-01-02</script>'; } },
  ];
  for (const c of dobCases) {
    const r = await finalizeMutate(c.mutate);
    if (r.noFare) add({ id: c.id, rule: c.rule, product: 'Added dob validation', status: 'NOT TESTED', actual: 'no fare' });
    else scoreReject(c.id, c.rule, 'Added validation for passengers[].profile.dob', r.res);
  }
}

// ---------- 3 age vs paxType ----------
console.log('\n=== 3 dob vs paxType ===');
{
  const ageCases = [
    { id: '3a', rule: 'ADT with ~7y DOB', mutate: (b) => { b.passengers[0].paxType = 'ADT'; b.passengers[0].profile.dob = ymdYearsAgo(7); } },
    { id: '3b', rule: 'CHD with ~25y DOB', mutate: (b) => { b.passengers[0].paxType = 'CHD'; b.passengers[0].profile.title = 'Master'; b.passengers[0].profile.dob = ymdYearsAgo(25); } },
    { id: '3c', rule: 'INF with ~8y DOB', mutate: (b) => { b.passengers[0].paxType = 'INF'; b.passengers[0].profile.title = 'Master'; b.passengers[0].profile.dob = ymdYearsAgo(8); } },
  ];
  for (const c of ageCases) {
    const r = await finalizeMutate(c.mutate);
    if (r.noFare) add({ id: c.id, rule: c.rule, product: 'Fixed age vs paxType', status: 'NOT TESTED', actual: 'no fare' });
    else scoreReject(c.id, c.rule, 'Fixed dob vs paxType', r.res);
  }
}

// ---------- 4 title / gender / nationality ----------
console.log('\n=== 4 title/gender/nationality ===');
{
  const rTitle = await finalizeMutate((b) => { b.passengers[0].profile.title = 'Mr,'; });
  if (rTitle.noFare) add({ id: '4a', rule: 'title Mr,', product: 'Fixed title validation', status: 'NOT TESTED', actual: 'no fare' });
  else scoreReject('4a', 'title "Mr,"', 'Fixed title validation', rTitle.res);

  const rGender = await finalizeMutate((b) => { b.passengers[0].profile.gender = 'other'; });
  if (rGender.noFare) add({ id: '4b', rule: 'gender other', product: 'Fixed gender validation', status: 'NOT TESTED', actual: 'no fare' });
  else scoreReject('4b', 'gender "other"', 'Fixed gender validation', rGender.res);

  const rNatOmit = await finalizeMutate((b) => { delete b.passengers[0].profile.nationality; });
  if (rNatOmit.noFare) add({ id: '4c', rule: 'omit nationality', product: 'not mandatory', status: 'NOT TESTED', actual: 'no fare' });
  else scoreAccept('4c', 'omit nationality still books', 'nationality is not mandatory', rNatOmit.res);

  const rNatInd = await finalizeMutate((b) => { b.passengers[0].profile.nationality = 'IND'; });
  if (rNatInd.noFare) add({ id: '4d', rule: 'nationality IND', product: 'not mandatory / no longer required', status: 'NOT TESTED', actual: 'no fare' });
  else {
    const e = errOf(rNatInd.res);
    add({
      id: '4d',
      rule: 'nationality "IND" (3-letter)',
      product: 'nationality no longer required — invalid value not specified',
      expect: 'ACCEPT or REJECT both OK vs product',
      status: e.http >= 500 ? 'BUG' : 'NOTE',
      actual: briefRes(rNatInd.res),
      http: e.http, code: e.code, message: e.message, bookingRefId: e.br,
    });
  }
}

// ---------- 5 isLead ----------
console.log('\n=== 5 isLead ===');
{
  const r = await finalizeMutate((b) => { b.passengers[0].isLead = false; });
  if (r.noFare) add({ id: '5', rule: 'isLead false', product: 'No change', status: 'NOT TESTED', actual: 'no fare' });
  else scoreAccept('5', 'single pax isLead:false still books', 'No change — will remain the same', r.res);
}

// ---------- 6 countryCode ----------
console.log('\n=== 6 countryCode ===');
{
  const r = await finalizeMutate((b) => { b.contact.countryCode = '999'; });
  if (r.noFare) add({ id: '6', rule: 'countryCode 999', product: 'Added countryCode validation', status: 'NOT TESTED', actual: 'no fare' });
  else scoreReject('6', 'contact.countryCode "999"', 'Added validation + country_calling_code table', r.res);
}

// ---------- 7 otherDetails ----------
console.log('\n=== 7 otherDetails ===');
{
  const r = await finalizeMutate((b) => { b.otherDetails = '<script>alert(1)</script>'; });
  if (r.noFare) add({ id: '7', rule: 'otherDetails HTML', product: 'No validation needed', status: 'NOT TESTED', actual: 'no fare' });
  else scoreAccept('7', 'otherDetails HTML accepted', 'Client accepts all values — no validation', r.res);
}

// ---------- 8 RENTAL pickup vs drop ----------
console.log('\n=== 8 RENTAL pickup vs drop ===');
{
  const body = buildRentalSearchBody(futurePickupDatetime(12));
  body.drop = {
    name: 'Viman Nagar, Pune',
    city: 'Pune',
    latitude: 18.5679,
    longitude: 73.9143,
  };
  const res = await cab.search(body);
  const e = errOf(res);
  const hasCabs = (e.cabs || 0) > 0;
  add({
    id: '8',
    rule: 'RENTAL pickup ≠ drop',
    product: 'No change — P2P booked as Rental',
    expect: 'ACCEPT 200 (by design)',
    status: e.http >= 500 ? 'BUG' : (e.http === 200 ? 'PASS' : 'BUG'),
    actual: `${briefRes(res)} inventory=${hasCabs}`,
    http: e.http, code: e.code, message: e.message, cabs: e.cabs,
  });
}

// ---------- 9 airportCode garbage ----------
console.log('\n=== 9 airportCode ===');
{
  const body = buildAirportSearchBody(futurePickupDatetime(12));
  body.airportCode = 'ZZZ';
  const res = await cab.search(body);
  const e = errOf(res);
  const bodyCode = e.code;
  add({
    id: '9',
    rule: 'airportCode ZZZ',
    product: 'Cannot be implemented',
    expect: 'HTTP 200 + NOT_FOUND in body (product will not 400)',
    status: e.http >= 500 ? 'BUG' : (e.http === 200 ? 'PASS' : 'NOTE'),
    actual: briefRes(res),
    http: e.http, code: bodyCode, message: e.message,
  });
}

// ---------- 10 distance / duration ----------
console.log('\n=== 10 distanceKm / durationMin ===');
{
  const omitKm = clone(buildAirportSearchBody(futurePickupDatetime(12)));
  delete omitKm.distanceKm;
  const r1 = await cab.search(omitKm);
  scoreReject('10a', 'omit distanceKm', 'Fixed — missing/null → 400', r1);

  const omitMin = clone(buildAirportSearchBody(futurePickupDatetime(12)));
  delete omitMin.durationMin;
  const r2 = await cab.search(omitMin);
  scoreReject('10b', 'omit durationMin', 'Fixed — missing/null → 400', r2);

  const nullKm = clone(buildAirportSearchBody(futurePickupDatetime(12)));
  nullKm.distanceKm = null;
  const r3 = await cab.search(nullKm);
  scoreReject('10c', 'distanceKm null', 'Fixed — missing/null → 400', r3);
}

// ---------- 11 pickup/drop name/city special chars ----------
console.log('\n=== 11 location text ===');
{
  const cases = [
    { id: '11a', rule: 'pickup.name trailing comma', mutate: (b) => { b.pickup.name = 'Vasant Kunj, Delhi,'; } },
    { id: '11b', rule: 'pickup.name HTML', mutate: (b) => { b.pickup.name = '<script>x</script>'; } },
    { id: '11c', rule: 'pickup.city punctuation', mutate: (b) => { b.pickup.city = '!@#$'; } },
  ];
  for (const c of cases) {
    const body = buildAirportSearchBody(futurePickupDatetime(12));
    c.mutate(body);
    const res = await cab.search(body);
    const e = errOf(res);
    add({
      id: c.id,
      rule: c.rule,
      product: 'Cannot be implemented',
      expect: 'ACCEPT 200 (product will not 400)',
      status: e.http >= 500 ? 'BUG' : (e.http === 200 ? 'PASS' : 'NOTE'),
      actual: briefRes(res),
      http: e.http, code: e.code, message: e.message, cabs: e.cabs,
    });
  }
}

// ---------- 12 locations query ----------
console.log('\n=== 12 locations query ===');
{
  for (const c of [
    { id: '12a', rule: 'query trailing comma', q: 'Delhi,' },
    { id: '12b', rule: 'query HTML', q: '<script>' },
  ]) {
    const res = await client.request({
      method: 'GET',
      path: '/v1/airportServices/cabs/locations',
      query: { ...CAB_QUERY, query: c.q },
      correlation: true,
    });
    const e = errOf(res);
    add({
      id: c.id,
      rule: c.rule,
      product: 'Cannot be implemented',
      expect: 'ACCEPT 200 (product will not 400)',
      status: e.http >= 500 ? 'BUG' : (e.http === 200 ? 'PASS' : 'NOTE'),
      actual: briefRes(res),
      http: e.http, code: e.code, message: e.message,
    });
  }
}

// ---------- 13 places autocomplete ----------
console.log('\n=== 13 places autocomplete ===');
{
  for (const c of [
    { id: '13a', rule: 'searchText trailing comma', q: 'Pune,' },
    { id: '13b', rule: 'searchText HTML', q: '<script>' },
  ]) {
    const res = await client.request({
      method: 'GET',
      path: '/v1/airportServices/cabs/places/autocomplete',
      query: { ...CAB_QUERY, searchText: c.q },
      correlation: true,
    });
    const e = errOf(res);
    add({
      id: c.id,
      rule: c.rule,
      product: 'Cannot be implemented',
      expect: 'ACCEPT 200 (product will not 400)',
      status: e.http >= 500 ? 'BUG' : (e.http === 200 ? 'PASS' : 'NOTE'),
      actual: briefRes(res),
      http: e.http, code: e.code, message: e.message,
    });
  }
}

// ---------- 14 cancel HTML reason ----------
console.log('\n=== 14 cancel HTML reason ===');
{
  const bookedOk = await finalizeMutate(() => {});
  if (bookedOk.noFare || !bookedOk.br) {
    add({ id: '14', rule: 'cancellationReason HTML', product: '(not mentioned)', status: 'NOT TESTED', actual: bookedOk.noFare ? 'no fare' : briefRes(bookedOk.res) });
  } else {
    await sleep(SETTLE_MS);
    const res = await client.request({
      method: 'POST',
      path: `/v1/airportServices/cabs/bookings/${bookedOk.br}/cancel`,
      query: CAB_QUERY,
      partnerKey: client.partnerKey,
      body: { cancelledBy: 'USER', cancellationReason: '<script>x</script>' },
    });
    const e = errOf(res);
    const accepted = e.http === 200;
    add({
      id: '14',
      rule: 'cancellationReason HTML',
      product: '(no reply — original QA still expects 400)',
      expect: 'REJECT 4xx',
      status: e.http >= 500 ? 'BUG' : (accepted ? 'BUG' : (e.http >= 400 ? 'PASS' : 'BUG')),
      actual: briefRes(res),
      http: e.http, code: e.code, message: e.message, bookingRefId: bookedOk.br,
    });
    if (!accepted) await cancelBr(bookedOk.br, 'cleanup after HTML cancel rejected');
  }
}

// ---------- 15 OUTSTATION / RENTAL airportCode on status ----------
console.log('\n=== 15 non-airport airportCode ===');
{
  async function bookType(id, searchBody, productPassIfFilled) {
    const { fare } = await freshFare(searchBody);
    if (!fare?.data?.bookingReference || !fare.data?.priceId) {
      add({ id, rule: `${id} status airportCode`, product: 'Expected — vendor needs airport code', status: 'NOT TESTED', actual: 'no fare' });
      return;
    }
    const body = tagBody(buildFinalizeBody({
      bookingReference: fare.data.bookingReference,
      priceId: fare.data.priceId,
    }));
    const fin = await cab.finalizeBooking(body);
    const br = fin.data?.bookingRefId;
    if (!(fin.status === 200 && br)) {
      add({ id, rule: `${id} status airportCode`, product: 'Expected — vendor needs airport code', status: 'NOT TESTED', actual: `finalize ${briefRes(fin)}` });
      return;
    }
    booked.push(br);
    await sleep(3000);
    const st = await cab.getBookingStatus(br);
    const ac = st.data?.details?.airportCode;
    const filled = ac != null && String(ac).trim() !== '';
    add({
      id,
      rule: `${id} details.airportCode`,
      product: 'Expected — populated at booking; vendor requires it',
      expect: 'filled (by design)',
      status: filled ? 'PASS' : 'NOTE',
      actual: `HTTP ${st.status} airportCode=${JSON.stringify(ac)} BR=${br}`,
      http: st.status,
      bookingRefId: br,
      airportCode: ac,
    });
  }
  await bookType('15a', buildOutstationSearchBody(futurePickupDatetime(13)));
  await bookType('15b', buildRentalSearchBody(futurePickupDatetime(14)));
}

console.log('\n=== cleanup booked BRs ===', booked.length);
for (const br of [...new Set(booked)]) {
  try { await cancelBr(br); } catch { /* ignore */ }
}

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: config.baseUrl,
  summary,
  bugs: rows.filter((r) => r.status === 'BUG'),
  notes: rows.filter((r) => r.status === 'NOTE'),
  rows,
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', summary);
console.log('Wrote', OUT);
process.exit(rows.some((r) => r.status === 'BUG') ? 1 : 0);

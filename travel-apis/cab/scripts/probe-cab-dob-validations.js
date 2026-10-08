/**
 * Cab finalize DOB / birthdate validation matrix (staging).
 * Positive + negative formats, ages vs paxType (ADT / CHD / INF).
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-dob-validations.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
  futurePickupDatetime,
  CAB_QUERY,
} from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

const BASE = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = 'reports/cab-dob-validations.json';
const SETTLE_MS = Number(process.env.CANCEL_SETTLE_MS || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ymdYearsAgo(years, month = 6, day = 15) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years, month - 1, day);
  return d.toISOString().slice(0, 10);
}

function ymdMonthsAgo(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function ymdDaysAhead(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

clearSession();
process.env.BASE_URL = BASE;
const { client } = await authenticate(true);
const cab = new CabService(client);

const rows = [];
const summary = { PASS: 0, BUG: 0, NOTE: 0, 'NOT TESTED': 0 };

function add(row) {
  rows.push(row);
  summary[row.status] = (summary[row.status] || 0) + 1;
  const tag = row.status === 'BUG' ? 'BUG ' : row.status === 'PASS' ? 'PASS' : row.status;
  console.log(tag, row.id, row.actual, row.message || '');
}

async function freshFare() {
  const search = await cab.search(buildAirportSearchBody(futurePickupDatetime(12)));
  const c0 = pickCab(search.data?.cabs || []);
  if (!c0?.searchId) return null;
  const fare = await cab.fare(c0.searchId);
  if (!fare.ok || !fare.data?.bookingReference || !fare.data?.priceId) return null;
  return { bookingReference: fare.data.bookingReference, priceId: fare.data.priceId };
}

function buildBody(fare, { paxType = 'ADT', dob, omitDob = false, title } = {}) {
  const body = buildFinalizeBody(fare);
  body.passengers[0].paxType = paxType;
  body.passengers[0].profile.title =
    title || (paxType === 'ADT' ? 'Mr' : paxType === 'CHD' ? 'Master' : 'Master');
  if (omitDob) {
    delete body.passengers[0].profile.dob;
  } else if (dob !== undefined) {
    body.passengers[0].profile.dob = dob;
  }
  // unique last name tag (letters only — API rejects digits in names)
  const tag = Date.now().toString(36).replace(/[0-9]/g, 'x');
  body.passengers[0].profile.lastName = `Dob${tag}`;
  return body;
}

async function cancelIfBooked(res) {
  const br = res.data?.bookingRefId;
  if (!br || !(res.ok || res.status === 200)) return;
  await sleep(SETTLE_MS);
  await client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: CAB_QUERY,
    partnerKey: client.partnerKey,
    body: { cancelledBy: 'USER', cancellationReason: 'DOB matrix cleanup' },
  });
}

/**
 * expect: 'ACCEPT' | 'REJECT'
 * REJECT = HTTP 4xx with error (never 500, never 200 book)
 */
async function runCase({ id, rule, expect, paxType, dob, omitDob, title }) {
  const fare = await freshFare();
  if (!fare) {
    add({ id, rule, expect, status: 'NOT TESTED', actual: 'no fare/inventory', dob, paxType });
    return;
  }
  const body = buildBody(fare, { paxType, dob, omitDob, title });
  const res = await cab.finalizeBooking(body);
  const http = res.status;
  const code = res.data?.error?.code || null;
  const message = res.data?.error?.message || null;
  const br = res.data?.bookingRefId || null;
  const accepted = http === 200 && !!br;

  let status;
  let actual;
  if (http >= 500) {
    status = 'BUG';
    actual = `HTTP ${http} (never 500)`;
  } else if (expect === 'ACCEPT') {
    if (accepted) {
      status = 'PASS';
      actual = `BR=${br} status=${res.data?.status}`;
    } else {
      status = 'BUG';
      actual = `HTTP ${http} ${code || ''}`.trim();
    }
  } else {
    // REJECT
    if (accepted) {
      status = 'BUG';
      actual = `accepted BR=${br}`;
    } else if (http >= 400 && http < 500) {
      status = 'PASS';
      actual = `HTTP ${http} ${code || ''}`.trim();
    } else {
      status = 'BUG';
      actual = `HTTP ${http} code=${code || 'none'} (want 4xx)`;
    }
  }

  add({
    id,
    rule,
    expect,
    paxType,
    dob: omitDob ? '(omitted)' : dob,
    status,
    actual,
    http,
    code,
    message,
    bookingRefId: br,
  });

  if (accepted) await cancelIfBooked(res);
}

const ADT_OK = config.cab.passengerDob || '1990-01-02';
const CHD_OK = ymdYearsAgo(8); // ~8y
const INF_OK = ymdMonthsAgo(6); // ~6m
const CHD_EDGE_2 = ymdYearsAgo(2); // just child
const CHD_EDGE_11 = ymdYearsAgo(11);
const ADT_EDGE_12 = ymdYearsAgo(12);
const INF_EDGE_1 = ymdYearsAgo(1); // 1y — often still INF or CHD depending on product
const UNDER_2_AS_ADT = ymdYearsAgo(1);
const CHILD_AS_ADT = ymdYearsAgo(7);
const ADULT_AS_CHD = ymdYearsAgo(25);
const ADULT_AS_INF = ymdYearsAgo(30);
const INFANT_AS_CHD = ymdMonthsAgo(6);

console.log('DOB fixtures', { ADT_OK, CHD_OK, INF_OK, CHD_EDGE_2, CHD_EDGE_11, ADT_EDGE_12 });

const cases = [
  // --- Positive baselines ---
  { id: 'DOB.POS.ADT', rule: 'ADT valid YYYY-MM-DD adult DOB', expect: 'ACCEPT', paxType: 'ADT', dob: ADT_OK },
  { id: 'DOB.POS.CHD', rule: 'CHD valid ~8y DOB', expect: 'ACCEPT', paxType: 'CHD', dob: CHD_OK },
  { id: 'DOB.POS.INF', rule: 'INF valid ~6m DOB', expect: 'ACCEPT', paxType: 'INF', dob: INF_OK },
  { id: 'DOB.POS.ADT.12y', rule: 'ADT DOB ~12y (adult boundary)', expect: 'ACCEPT', paxType: 'ADT', dob: ADT_EDGE_12 },
  { id: 'DOB.POS.CHD.2y', rule: 'CHD DOB ~2y (child lower boundary)', expect: 'ACCEPT', paxType: 'CHD', dob: CHD_EDGE_2 },
  { id: 'DOB.POS.CHD.11y', rule: 'CHD DOB ~11y (child upper boundary)', expect: 'ACCEPT', paxType: 'CHD', dob: CHD_EDGE_11 },

  // --- Required / empty ---
  { id: 'DOB.NEG.omit', rule: 'omit profile.dob', expect: 'REJECT', paxType: 'ADT', omitDob: true },
  { id: 'DOB.NEG.empty', rule: 'dob empty string', expect: 'REJECT', paxType: 'ADT', dob: '' },
  { id: 'DOB.NEG.null', rule: 'dob null', expect: 'REJECT', paxType: 'ADT', dob: null },
  { id: 'DOB.NEG.space', rule: 'dob whitespace', expect: 'REJECT', paxType: 'ADT', dob: ' ' },

  // --- Format ---
  { id: 'DOB.NEG.fmt.ddmmyyyy', rule: 'dob DD-MM-YYYY', expect: 'REJECT', paxType: 'ADT', dob: '02-01-1990' },
  { id: 'DOB.NEG.fmt.slash', rule: 'dob DD/MM/YYYY', expect: 'REJECT', paxType: 'ADT', dob: '02/01/1990' },
  { id: 'DOB.NEG.fmt.usSlash', rule: 'dob MM/DD/YYYY', expect: 'REJECT', paxType: 'ADT', dob: '01/02/1990' },
  { id: 'DOB.NEG.fmt.ymdSlash', rule: 'dob YYYY/MM/DD', expect: 'REJECT', paxType: 'ADT', dob: '1990/01/02' },
  { id: 'DOB.NEG.fmt.compact', rule: 'dob YYYYMMDD', expect: 'REJECT', paxType: 'ADT', dob: '19900102' },
  { id: 'DOB.NEG.fmt.datetime', rule: 'dob with time', expect: 'REJECT', paxType: 'ADT', dob: '1990-01-02T00:00:00Z' },
  { id: 'DOB.NEG.fmt.invalidDay', rule: 'dob 1990-02-30', expect: 'REJECT', paxType: 'ADT', dob: '1990-02-30' },
  { id: 'DOB.NEG.fmt.garbage', rule: 'dob not a date', expect: 'REJECT', paxType: 'ADT', dob: 'not-a-date' },

  // --- Special chars / injection ---
  { id: 'DOB.NEG.comma', rule: 'dob trailing comma', expect: 'REJECT', paxType: 'ADT', dob: '1990-01-02,' },
  { id: 'DOB.NEG.html', rule: 'dob HTML', expect: 'REJECT', paxType: 'ADT', dob: '<script>1990-01-02</script>' },
  { id: 'DOB.NEG.punct', rule: 'dob punctuation only', expect: 'REJECT', paxType: 'ADT', dob: '!@#$' },

  // --- Logical dates ---
  { id: 'DOB.NEG.future', rule: 'dob in the future', expect: 'REJECT', paxType: 'ADT', dob: ymdDaysAhead(30) },
  { id: 'DOB.NEG.farPast', rule: 'dob year 1800 (unrealistic)', expect: 'REJECT', paxType: 'ADT', dob: '1800-01-01' },

  // --- Age vs paxType mismatch (flight-like bands: INF <2, CHD 2–11, ADT 12+) ---
  { id: 'DOB.NEG.ADT.childAge', rule: 'ADT with ~7y DOB', expect: 'REJECT', paxType: 'ADT', dob: CHILD_AS_ADT },
  { id: 'DOB.NEG.ADT.infantAge', rule: 'ADT with ~1y DOB', expect: 'REJECT', paxType: 'ADT', dob: UNDER_2_AS_ADT },
  { id: 'DOB.NEG.CHD.adultAge', rule: 'CHD with ~25y DOB', expect: 'REJECT', paxType: 'CHD', dob: ADULT_AS_CHD },
  { id: 'DOB.NEG.CHD.infantAge', rule: 'CHD with ~6m DOB', expect: 'REJECT', paxType: 'CHD', dob: INFANT_AS_CHD },
  { id: 'DOB.NEG.INF.adultAge', rule: 'INF with ~30y DOB', expect: 'REJECT', paxType: 'INF', dob: ADULT_AS_INF },
  { id: 'DOB.NEG.INF.childAge', rule: 'INF with ~8y DOB', expect: 'REJECT', paxType: 'INF', dob: CHD_OK },
];

for (const c of cases) {
  await runCase(c);
}

const bugs = rows.filter((r) => r.status === 'BUG');
const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  note:
    'Age bands assumed flight-like (INF <2, CHD 2–11, ADT 12+) unless API documents otherwise. Cab error contract does not spell DOB age bands.',
  fixtures: { ADT_OK, CHD_OK, INF_OK, CHD_EDGE_2, CHD_EDGE_11, ADT_EDGE_12 },
  summary,
  bugs: bugs.map((b) => ({
    id: b.id,
    rule: b.rule,
    expect: b.expect,
    paxType: b.paxType,
    dob: b.dob,
    actual: b.actual,
    http: b.http,
    code: b.code,
    message: b.message,
  })),
  rows,
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', summary);
console.log('Wrote', OUT);
process.exit(bugs.length ? 1 : 0);

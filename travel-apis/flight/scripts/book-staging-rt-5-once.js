/**
 * One-shot pack: 5 RT books on api-staging (single + multipax).
 * NO date loop. NO Inprogress retry. Fail once → record and move to next slot.
 *
 *   node scripts/book-staging-rt-5-once.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildRoundTripSearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { pollRoundTripSearch } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';
import { config } from '../../../shared/config/env.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

const OUT = path.join('reports', `staging-rt-5-once-${Date.now()}.json`);

const SLOTS = [
  { id: 'RT-1ADT', origin: 'DEL', destination: 'BOM', adults: 1, children: 0, infants: 0, days: 48, returnOffset: 5, prefer: ['AI', 'SG', 'IX'], intl: false },
  { id: 'RT-2ADT', origin: 'DEL', destination: 'BOM', adults: 2, children: 0, infants: 0, days: 50, returnOffset: 6, prefer: ['AI', 'SG', 'IX'], intl: false },
  { id: 'RT-1A1C', origin: 'BOM', destination: 'BLR', adults: 1, children: 1, infants: 0, days: 52, returnOffset: 5, prefer: ['AI', 'SG', 'IX'], intl: false },
  { id: 'RT-2A1C', origin: 'DEL', destination: 'HYD', adults: 2, children: 1, infants: 0, days: 54, returnOffset: 7, prefer: ['AI', 'SG', 'IX'], intl: false },
  { id: 'RT-1ADT-INTL', origin: 'DEL', destination: 'DXB', adults: 1, children: 0, infants: 0, days: 48, returnOffset: 7, prefer: ['EK', 'QR', 'AI', 'IX'], intl: true },
];

function lettersTag() {
  return `x${Date.now().toString(36).replace(/[0-9]/g, 'z').slice(-4)}`;
}

function mkPassport(seed) {
  return {
    number: `P${String(seed).replace(/\D/g, '').slice(-7).padStart(7, '1')}`,
    expiry: '2031-08-01',
    issuedDate: '2020-08-01',
    issuedCountryCode: 'IN',
  };
}

function buildPax({ adults, children, infants, withPassport }) {
  const t = lettersTag();
  const seed = Date.now();
  const list = [];
  const adultsPool = [
    { title: 'Mr', firstName: 'Rohan', lastName: `Bhagat${t}`, gender: 'Male', dob: '1988-05-12' },
    { title: 'Ms', firstName: 'Priya', lastName: `Malhotra${t}`, gender: 'Female', dob: '1990-03-15' },
    { title: 'Mr', firstName: 'Amit', lastName: `Sharma${t}`, gender: 'Male', dob: '1985-08-20' },
  ];
  const childPool = [
    { title: 'Miss', firstName: 'Aarohi', lastName: `Khanna${t}`, gender: 'Female', dob: '2017-09-08' },
    { title: 'Mstr', firstName: 'Kabir', lastName: `Sethi${t}`, gender: 'Male', dob: '2017-09-08' },
  ];
  for (let i = 0; i < adults; i += 1) {
    const p = adultsPool[i % adultsPool.length];
    list.push({
      paxId: `PAX${list.length + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: { ...p, nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: withPassport ? mkPassport(seed + i * 17) : { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    });
  }
  for (let i = 0; i < children; i += 1) {
    const p = childPool[i % childPool.length];
    list.push({
      paxId: `PAX${list.length + 1}`,
      type: 'child',
      isLead: false,
      profile: { ...p, nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: withPassport ? mkPassport(seed + 100 + i * 17) : { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
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
        firstName: 'Vihaan',
        lastName: `Patil${t}`,
        gender: 'Male',
        dob: new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: withPassport ? mkPassport(seed + 200 + i * 17) : { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    });
  }
  return list;
}

function brief(data, n = 320) {
  try {
    return JSON.stringify(data).slice(0, n);
  } catch {
    return String(data);
  }
}

async function pollStatusOnce(flight, br) {
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log(`    status ${i + 1}: ${last}`);
    if (/confirm|fail|cancel|inprogress|in.?progress/i.test(last) && !/pending/i.test(last)) {
      return last;
    }
    if (isTerminalBookingStatus(last) && !/pending/i.test(last)) return last;
    await sleep(3000);
  }
  return last;
}

async function bookOne(flight, client, slot) {
  const row = {
    id: slot.id,
    route: `${slot.origin}-${slot.destination}-${slot.origin}`,
    pax: `${slot.adults}A/${slot.children}C/${slot.infants}I`,
    days: slot.days,
    prefer: slot.prefer,
  };
  console.log(`\n=== ${slot.id} RT ${row.route} ${row.pax} d+${slot.days} ===`);

  const body = buildRoundTripSearchBody(slot.days, slot.days + slot.returnOffset, {
    origin: slot.origin,
    destination: slot.destination,
    fareType: 'NORMAL',
    maxStops: null,
  });
  body.travellers = {
    adults: slot.adults,
    children: slot.children,
    infants: slot.infants,
  };
  if (slot.prefer?.length) {
    body.preferences = {
      airlines: slot.prefer,
      maxStops: null,
      refundableOnly: false,
    };
  }

  const { pairs } = await pollRoundTripSearch(flight, body, {
    maxStops: null,
    airlines: slot.prefer?.length ? slot.prefer : [],
  });
  if (!pairs?.length) {
    row.verdict = 'NOT TESTED';
    row.error = 'no RT pairs';
    console.log('  FAIL: no pairs (stop — no date loop)');
    return row;
  }

  const pair = pairs[0];
  row.pair = `${pair.onward?.label} + ${pair.ret?.label}`;
  console.log('  pair', row.pair);

  const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    row.verdict = 'BUG';
    row.error = 'pricing failed';
    row.pricing = brief(pricing.data);
    console.log('  FAIL: pricing', brief(pricing.data));
    return row;
  }
  row.priceId = pricing.data.priceId;
  row.totalAmount = pricing.data.totalAmount ?? pricing.data.pricing?.totalAmount;
  console.log('  priced', row.totalAmount, 'priceId', row.priceId);

  const withPassport = Boolean(slot.intl) || String(pricing.data.passportType || '').toUpperCase() !== 'NONE';
  const passengers = buildPax({
    adults: slot.adults,
    children: slot.children,
    infants: slot.infants,
    withPassport,
  });

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: pair.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  payload.data.passengers = passengers;
  payload.data.passportType = withPassport
    ? (pricing.data.passportType || 'REGULAR')
    : (pricing.data.passportType || 'NONE');

  if (pricing.data?.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = {
      gstNumber: '27AABCT1429B1Z1',
      gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
      gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
      gstEmailID: 'accounts@travelvip.ai',
      gstMobileNumber: '9921862715',
    };
  } else {
    payload.data.includeGst = false;
    payload.data.addGstInfo = false;
    payload.data.gstDetails = null;
  }

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  row.issueHttp = issue.status;
  row.br = br || null;
  if (!br) {
    row.verdict = 'BUG';
    row.error = 'issue-ticket no BR';
    row.issueSnippet = brief(issue.data);
    console.log('  FAIL: issue', brief(issue.data));
    return row;
  }

  console.log('  BR', br, '— poll once (no Inprogress retry)');
  const status = await pollStatusOnce(flight, br);
  row.status = status;

  if (/confirm/i.test(status)) {
    row.verdict = 'PASS';
    try {
      const detail = await flight.getBookingDetail(br);
      const brsp = detail.data?.bookingResponse || {};
      row.pnr = brsp.itinerary?.[0]?.pnr || null;
      row.detailTotal = brsp.salesSummary?.totalAmount ?? null;
    } catch (_) {
      /* ignore */
    }
    console.log('  === BOOKED', br, status);
  } else {
    row.verdict = /inprogress/i.test(status) ? 'NOT TESTED' : 'BUG';
    row.error = `status ${status}`;
    console.log('  STOP', status, '(no retry)');
  }
  return row;
}

async function main() {
  clearSession();
  console.log('BASE', process.env.BASE_URL);
  console.log('RT pack: 5 one-shot books (single + multipax). No date loop. No Inprogress retry.\n');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;

  const rows = [];
  for (const slot of SLOTS) {
    try {
      rows.push(await bookOne(flight, client, slot));
    } catch (e) {
      rows.push({
        id: slot.id,
        verdict: 'BUG',
        error: String(e?.message || e),
      });
      console.log('  CRASH', e?.message || e);
    }
  }

  const summary = {
    PASS: rows.filter((r) => r.verdict === 'PASS').length,
    BUG: rows.filter((r) => r.verdict === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.verdict === 'NOT TESTED').length,
  };

  const report = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    noLoop: true,
    noInprogressRetry: true,
    summary,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(summary));
  console.log('\n| # | Slot | Route / pax | BR | Status | Verdict |');
  console.log('|---|---|---|---|---|---|');
  rows.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.id} | ${r.route || '-'} ${r.pax || ''} | ${r.br || '-'} | ${r.status || r.error || '-'} | ${r.verdict} |`,
    );
  });
  console.log('\nReport:', OUT);
  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('CRASH', e);
  process.exit(2);
});

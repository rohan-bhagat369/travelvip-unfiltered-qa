/**
 * One-shot staging RT international book: 2 ADT + 2 CHD.
 * NO date loop, NO Inprogress retry. On fail → Mattermost vendor-alerts-dev.
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
import {
  fetchRecentAlertPosts,
  mattermostConfigured,
  waitForVendorAlert,
} from './lib/mattermostVendorAlerts.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

const ORIGIN = process.env.FLIGHT_ORIGIN || 'DEL';
const DEST = process.env.FLIGHT_DEST || 'DXB';
const ONWARD_DAY = Number(process.env.FLIGHT_DAYS || 45);
const RETURN_OFFSET = Number(process.env.FLIGHT_RETURN_DAYS || 7);
const EXCLUDE_AIRLINES = String(process.env.EXCLUDE_AIRLINES || '6E')
  .split(',')
  .map((a) => a.trim().toUpperCase())
  .filter(Boolean);
const PREFER_AIRLINES = String(process.env.PREFER_AIRLINES || 'EK,QR,AI,SG,IX')
  .split(',')
  .map((a) => a.trim().toUpperCase())
  .filter((a) => a && !EXCLUDE_AIRLINES.includes(a));
const OUT = path.join('reports', `staging-rt-intl-2a2c-noindigo-${Date.now()}.json`);

function pairHasAirline(pair, codes) {
  const labels = `${pair?.onward?.label || ''} ${pair?.ret?.label || ''}`.toUpperCase();
  return codes.some((c) => new RegExp(`\\b${c}\\b`).test(labels));
}

/** Gender/title/name aligned passengers (avoids Ms+Arjun / Mstr+Diya style fails). */
function buildAlignedPassengers(tag) {
  const t = tag || `x${Date.now().toString(36).replace(/[0-9]/g, 'z').slice(-4)}`;
  const seed = Date.now();
  const mkPass = (i, number) => ({
    number,
    expiry: '2031-08-01',
    issuedDate: '2020-08-01',
    issuedCountryCode: 'IN',
  });
  return [
    {
      paxId: 'PAX1', type: 'adult', isLead: true,
      profile: { title: 'Mr', firstName: 'Rohan', lastName: `Bhagat${t}`, gender: 'Male', dob: '1988-05-12', nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: mkPass(0, `P${String(seed).slice(-7)}`),
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false,
      profile: { title: 'Ms', firstName: 'Priya', lastName: `Malhotra${t}`, gender: 'Female', dob: '1990-03-15', nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: mkPass(1, `P${String(seed + 17).slice(-7)}`),
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX3', type: 'child', isLead: false,
      profile: { title: 'Miss', firstName: 'Aarohi', lastName: `Khanna${t}`, gender: 'Female', dob: '2017-09-08', nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: mkPass(2, `P${String(seed + 34).slice(-7)}`),
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX4', type: 'child', isLead: false,
      profile: { title: 'Mstr', firstName: 'Kabir', lastName: `Sethi${t}`, gender: 'Male', dob: '2017-09-08', nationality: 'IN' },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: mkPass(3, `P${String(seed + 51).slice(-7)}`),
      ssr: { baggage: [], meals: [], seats: [] },
    },
  ];
}

function brief(data, n = 400) {
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
    console.log(`  status ${i + 1}: ${last}`);
    if (/confirm|fail|cancel|inprogress|in.?progress/i.test(last) && !/pending/i.test(last)) {
      return last;
    }
    if (isTerminalBookingStatus(last) && !/pending/i.test(last)) return last;
    await sleep(3000);
  }
  return last;
}

async function checkMattermost(br, sinceMs) {
  if (!mattermostConfigured()) {
    return { skipped: true, reason: 'Mattermost not configured' };
  }
  console.log('\n--- Mattermost vendor-alerts-dev ---');
  try {
    if (br) {
      const hit = await waitForVendorAlert({
        bookingReference: br,
        sinceMs: sinceMs || Date.now() - 10 * 60 * 1000,
        timeoutMs: 20000,
        intervalMs: 4000,
      });
      console.log(JSON.stringify(hit, null, 2));
      return hit;
    }
    const posts = await fetchRecentAlertPosts({
      perPage: 20,
      sinceMs: sinceMs || Date.now() - 10 * 60 * 1000,
    });
    const sliced = (posts || []).slice(0, 8).map((p) => ({
      create_at: p.create_at,
      message: String(p.message || '').slice(0, 500),
    }));
    console.log(JSON.stringify(sliced, null, 2));
    return { ok: true, posts: sliced };
  } catch (e) {
    console.error('Mattermost check failed:', e.message || e);
    return { ok: false, error: String(e.message || e) };
  }
}

async function main() {
  const started = Date.now();
  clearSession();
  console.log('BASE', process.env.BASE_URL);
  console.log(`ONE-SHOT RT ${ORIGIN}↔${DEST} 2ADT+2CHD  onward d+${ONWARD_DAY} return +${RETURN_OFFSET}`);
  console.log(`Exclude airlines: ${EXCLUDE_AIRLINES.join(',') || '(none)'} (no IndiGo)`);
  console.log(`Prefer airlines: ${PREFER_AIRLINES.join(',') || '(any)'}`);
  console.log('No date loop. No Inprogress retry. Fail → Mattermost.');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;

  const report = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    route: `${ORIGIN}-${DEST}-${ORIGIN}`,
    pax: '2ADT+2CHD',
    noLoop: true,
    noRetry: true,
  };

  const body = buildRoundTripSearchBody(ONWARD_DAY, ONWARD_DAY + RETURN_OFFSET, {
    origin: ORIGIN,
    destination: DEST,
    fareType: 'NORMAL',
  });
  body.travellers = { adults: 2, children: 2, infants: 0 };
  if (PREFER_AIRLINES.length) {
    body.preferences = {
      airlines: PREFER_AIRLINES,
      maxStops: null,
      refundableOnly: false,
    };
  }

  console.log('\n1) Search RT...');
  const { pairs: allPairs } = await pollRoundTripSearch(flight, body, {
    maxStops: null,
    airlines: PREFER_AIRLINES.length ? PREFER_AIRLINES : [],
  });
  const pairs = (allPairs || []).filter((p) => !pairHasAirline(p, EXCLUDE_AIRLINES));
  console.log(`  pairs total=${allPairs?.length || 0} after exclude ${EXCLUDE_AIRLINES.join(',')}=${pairs.length}`);
  if (!pairs?.length) {
    report.error = `no RT inventory excluding ${EXCLUDE_AIRLINES.join(',')}`;
    report.sampleExcluded = (allPairs || []).slice(0, 3).map((p) => `${p.onward?.label} + ${p.ret?.label}`);
    console.error('FAIL: no non-IndiGo RT pairs');
    report.mattermost = await checkMattermost(null, started);
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('Report:', OUT);
    process.exit(1);
  }

  const pair = pairs[0];
  console.log('  first non-6E pair:', pair.onward?.label, '+', pair.ret?.label);
  report.pair = {
    onward: pair.onward?.label,
    return: pair.ret?.label,
    searchIds: pair.searchIds,
  };

  console.log('\n2) Pricing (once)...');
  const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    report.error = 'pricing failed';
    report.pricing = brief(pricing.data);
    console.error('FAIL: pricing', brief(pricing.data));
    report.mattermost = await checkMattermost(null, started);
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('Report:', OUT);
    process.exit(1);
  }
  report.priceId = pricing.data.priceId;
  report.totalAmount = pricing.data.totalAmount ?? pricing.data.pricing?.totalAmount;
  console.log('  priceId', report.priceId, 'total', report.totalAmount);

  console.log('\n3) Issue-ticket v2 (once)...');
  const passengers = buildAlignedPassengers();
  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: pair.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  payload.data.passengers = passengers;
  payload.data.passportType = pricing.data.passportType || 'REGULAR';
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
  report.issueHttp = issue.status;
  report.issueOk = Boolean(issue.ok);
  report.br = br || null;
  report.issueSnippet = brief(issue.data);

  if (!br) {
    console.error('FAIL: issue-ticket', brief(issue.data));
    report.error = 'issue-ticket no BR';
    report.mattermost = await checkMattermost(null, started);
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('Report:', OUT);
    process.exit(1);
  }

  console.log('  BR', br);
  console.log('\n4) Poll status (stop on Confirmed / Inprogress / Failed / Cancelled — no retry)...');
  const status = await pollStatusOnce(flight, br);
  report.status = status;

  if (/confirm/i.test(status)) {
    const detail = await flight.getBookingDetail(br);
    const brsp = detail.data?.bookingResponse || {};
    report.detail = {
      pnr: brsp.itinerary?.[0]?.pnr,
      totalAmount: brsp.salesSummary?.totalAmount,
      passengers: (brsp.passengers || []).map(
        (p) => `${p.firstName || p.profile?.firstName} ${p.lastName || p.profile?.lastName}`,
      ),
    };
    console.log('\n=== BOOKED ===');
    console.log(JSON.stringify({ br, status, ...report.detail, route: report.route, pax: report.pax }, null, 2));
  } else {
    console.error(`\nFAIL / STOP: status=${status} (no retry). Checking Mattermost...`);
    report.error = `booking status ${status}`;
    report.mattermost = await checkMattermost(br, started);
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nReport:', OUT);
  process.exit(/confirm/i.test(status) ? 0 : 1);
}

main().catch(async (e) => {
  console.error('CRASH:', e?.message || e);
  try {
    const mm = await checkMattermost(null, Date.now() - 10 * 60 * 1000);
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(
      OUT,
      JSON.stringify({ error: String(e?.message || e), mattermost: mm }, null, 2),
    );
  } catch (_) {
    /* ignore */
  }
  process.exit(2);
});

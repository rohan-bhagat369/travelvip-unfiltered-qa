/**
 * Regression probe:
 * 1) Book OW 1ADT + 1CHD on canary.
 * 2) Submit cancellation request for CHILD first (cancellationPaxList: ["PAX2"]).
 * 3) Then submit cancellation request for ADULT (cancellationPaxList: ["PAX1"]).
 *
 * Goal: confirm both cancellation requests can be submitted independently.
 *
 * WARNING: subset/pax-level cancels may still move real wallet money depending on canary config.
 * Keep this as a focused probe.
 *
 * Run:
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-adult-child-independent-cancel-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';
import { buildPassengers } from '../src/passengerBuilder.js';

const OUT = path.join('reports', 'adult-child-independent-cancel-canary.json');

function brief(d, n = 600) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}

function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}

function cancelStatus(r) {
  return (
    r?.data?.cancellationRequest?.status
    || r?.data?.status
    || r?.data?.data?.cancellationRequest?.status
    || null
  );
}

async function waitTerminal(flight, br, maxAttempts = 30) {
  let last;
  for (let i = 0; i < maxAttempts; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || last.data || '');
    if (isTerminalBookingStatus(st)) return { status: last.data?.status || st, detail: last };
    await sleep(4000);
  }
  return { status: last?.data?.status, detail: last, timedOut: true };
}

function extractPnrFromDetail(detailData) {
  const itinerary = detailData?.data?.bookingResponse?.itinerary || detailData?.data?.itinerary || detailData?.itinerary || [];
  if (Array.isArray(itinerary)) {
    for (const leg of itinerary) {
      if (leg?.pnr) return leg.pnr;
    }
  }
  return null;
}

function extractPaxScopeFromDetail(detailData) {
  const br = detailData?.data?.bookingResponse || detailData?.bookingResponse || detailData?.data || {};
  const passengers = br.passengers || [];
  return passengers.map((p, i) => ({
    paxId: p.paxId || `PAX${i + 1}`,
    type: p.type || p.passengerType || null,
    name: `${p.firstName || p.profile?.firstName || ''} ${p.lastName || p.profile?.lastName || ''}`.trim(),
  }));
}

async function cancelApi(client, bookingId, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${bookingId}/cancel`,
    query: FLIGHT_QUERY,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function book1adt1chd(flight, client, { origin = 'DEL', destination = 'BOM', days = 48 } = {}) {
  const searchBody = buildOneWaySearchBody(days, {
    origin,
    destination,
    fareType: 'NORMAL',
    maxStops: 0,
  });
  searchBody.travellers = { adults: 1, children: 1, infants: 0 };

  const search = await flight.searchUntilComplete(searchBody);
  const searchId = search.searchId || search.searchIds?.[0] || null;
  if (!searchId) throw new Error('no searchId');

  const pricing = await flight.getPricing([searchId], 'ONE_WAY');
  if (!pricing?.ok && pricing?.status !== 200) throw new Error(`pricing failed: ${brief(pricing?.data || pricing)}`);

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
  });

  // Override passengers with exact 1ADT+1CHD pax list.
  payload.data.passengers = buildPassengers({
    adults: 1,
    children: 1,
    infants: 0,
    uniqueNames: true,
  });

  const issueRaw = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const br =
    issueRaw.data?.bookingReference
    || issueRaw.data?.bookingReferenceId
    || issueRaw.data?.bookingRefId;
  if (!br) throw new Error(`issue failed: ${brief(issueRaw?.data || issueRaw)}`);

  const st = await waitTerminal(flight, br);
  const detail = await flight.getBookingDetail(br);
  const pnr = extractPnrFromDetail(detail.data || detail);
  const passengers = extractPaxScopeFromDetail(detail);

  if (String(st.status).toLowerCase() !== 'confirmed') {
    throw new Error(`booking not Confirmed: status=${st.status}`);
  }
  if (!pnr) throw new Error('missing pnr in booking detail');

  return { br, pnr, status: st.status, passengers };
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const origin = process.env.ORIGIN || 'DEL';
  const destination = process.env.DEST || 'BOM';
  const daysList = String(process.env.DAYS || '48,51,54,57,60')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter(Boolean);

  let booked = null;
  let lastErr = null;
  for (const days of daysList) {
    try {
      console.log(`Booking attempt days=${days} ${origin}->${destination}`);
      booked = await book1adt1chd(flight, client, { origin, destination, days });
      break;
    } catch (e) {
      lastErr = e;
      console.log('  booking attempt failed:', e.message);
    }
  }
  if (!booked) throw lastErr || new Error('No booking succeeded');

  // Pax mapping expectation: buildPassengers orders adults then children.
  // paxIds are PAX1 (adult), PAX2 (child).
  const childPax = ['PAX2'];
  const adultPax = ['PAX1'];

  const childReq = {
    action: 'CANCEL',
    pnr: booked.pnr,
    cancellationPaxList: childPax,
    cancellationReason: 'QA: child cancel first',
    remarks: 'child-first sequence',
  };
  const childRes = await cancelApi(client, booked.br, childReq);

  await sleep(3000);

  const adultReq = {
    action: 'CANCEL',
    pnr: booked.pnr,
    cancellationPaxList: adultPax,
    cancellationReason: 'QA: adult cancel after child request',
    remarks: 'adult-after-child sequence',
  };
  const adultRes = await cancelApi(client, booked.br, adultReq);

  const afterStatus = await flight.getBookingStatus(booked.br);
  const afterDetail = await flight.getBookingDetail(booked.br);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partnerId: config.partnerId,
    tierId: config.tierId,
    booking: booked,
    paxAssumptions: {
      childPax,
      adultPax,
      orderingRule: 'passengers built as adults then children (PAX1=adult, PAX2=child)',
    },
    steps: {
      childCancel: {
        request: childReq,
        response: childRes?.data,
        http: childRes?.status,
        errCode: errCode(childRes),
        status: cancelStatus(childRes),
      },
      adultCancel: {
        request: adultReq,
        response: adultRes?.data,
        http: adultRes?.status,
        errCode: errCode(adultRes),
        status: cancelStatus(adultRes),
      },
    },
    after: {
      bookingStatus: afterStatus?.data?.status || afterStatus?.data,
      bookingStatusRaw: afterStatus?.data || null,
      bookingDetailSnippet: brief(afterDetail?.data, 1200),
    },
    pass:
      adultRes?.status != null
      && adultRes.status >= 200
      && adultRes.status < 300
      && String(cancelStatus(adultRes) || '').toLowerCase().includes('request'),
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('=== RESULT ===');
  console.log('Child cancel:', childRes?.status, errCode(childRes), cancelStatus(childRes));
  console.log('Adult cancel:', adultRes?.status, errCode(adultRes), cancelStatus(adultRes));
  console.log('After status:', report.after.bookingStatus);
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});


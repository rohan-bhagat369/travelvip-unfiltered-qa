/**
 * Book one OW CORPORATE fare on staging (leave Confirmed; no cancel).
 *   node scripts/book-corporate-one-staging.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-corporate-one-staging.json';
const VALID_GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  const origin = process.env.ORIGIN || 'DEL';
  const destination = process.env.DEST || 'BOM';
  const daysList = (process.env.DAYS_LIST || '35,42,49,56,63,70,77')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter(Boolean);

  console.log('Base', config.baseUrl, 'partner', config.partnerId);
  console.log(`Book OW CORPORATE ${origin}→${destination} days=${daysList.join(',')}`);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  let booked = null;
  const attempts = [];

  for (const days of daysList) {
    console.log(`\n=== CORPORATE search +${days}d ===`);
    const body = buildOneWaySearchBody(days, {
      origin, destination, fareType: 'CORPORATE', maxStops: 0,
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };

    let search;
    try {
      search = await flight.searchUntilComplete(body);
    } catch (e) {
      console.log('search fail', e.message);
      attempts.push({ days, step: 'search', error: e.message });
      continue;
    }
    if (!search?.searchId) {
      console.log('no searchId', brief(search?.data, 200));
      attempts.push({ days, step: 'search', error: 'no searchId' });
      continue;
    }
    console.log('searchId', search.searchId);

    const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
    const addGst = pricing.data?.addGstInfo === true || pricing.data?.pricing?.addGstInfo === true;
    console.log(
      'pricing', pricing.status,
      'priceId', pricing.data?.priceId,
      'total', pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
      'addGstInfo', addGst,
    );
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
      attempts.push({ days, step: 'pricing', error: brief(pricing.data, 300) });
      continue;
    }

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds: [search.searchId],
      journeyType: 'ONE_WAY',
    });
    if (addGst) {
      payload.data.includeGst = true;
      payload.data.gstDetails = { ...VALID_GST };
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
    console.log('issue', issue.status, br || brief(issue.data, 400));
    if (!br) {
      attempts.push({ days, step: 'issue', error: brief(issue.data, 400) });
      continue;
    }

    let status;
    // Short poll — if Inprogress, leave and try next date with different names
    for (let i = 0; i < 5; i += 1) {
      const st = await flight.getBookingStatus(br);
      status = String(st.data?.status || '');
      console.log('status', i + 1, status);
      if (isTerminalBookingStatus(status)) break;
      if (/inprogress/i.test(status) && i >= 2) break;
      await sleep(3000);
    }

    const detail = await flight.getBookingDetail(br);
    status = detail.data?.status || status;
    const itinerary = detail.data?.bookingResponse?.itinerary || [];
    const pnr = itinerary.find((x) => x.pnr)?.pnr || null;
    const airline = itinerary?.[0]?.segments?.[0]?.airlineCode
      || itinerary?.[0]?.segments?.[0]?.airline?.code
      || null;

    booked = {
      fareType: 'CORPORATE',
      br,
      pnr,
      status,
      route: `${origin}-${destination}`,
      days,
      departDate: body.itinerary?.[0]?.date,
      priceId: pricing.data.priceId,
      totalAmount: pricing.data?.pricing?.totalAmount ?? pricing.data?.totalAmount,
      addGstInfo: addGst,
      airline,
      itinerary: itinerary.map((l) => ({
        direction: l.direction,
        pnr: l.pnr,
        stops: l.totalStops,
        segs: (l.segments || []).length,
      })),
    };
    attempts.push({ days, step: 'booked', br, status, pnr });
    if (/confirm/i.test(String(status))) break;
    if (/inprogress/i.test(String(status))) {
      console.log('Inprogress — leave BR, try next date (rotate passenger names on next scripts)');
      booked = null;
      continue;
    }
    booked = null;
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partner: config.partnerId,
    attempts,
    booking: booked,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(booked || { error: 'no booking', attempts }, null, 2));
  console.log('Wrote', OUT);
  if (!booked || !/confirm/i.test(String(booked.status || ''))) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

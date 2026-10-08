/**
 * Book CORPORATE RT 2ADT on canary → full PENALTY+CANCEL both PNRs.
 *   FLIGHT_ISSUE_PID=vgm node scripts/book-corporate-rt-2adt-cancel-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  buildPassengerProfile,
  analyzeFlightOptions,
  isTerminalBookingStatus,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/book-corporate-rt-2adt-cancel-canary.json';
const Q = { ...FLIGHT_QUERY };
const GST = {
  gstNumber: '27AABCT1429B1Z1',
  gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
  gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
  gstEmailID: 'accounts@travelvip.ai',
  gstMobileNumber: '9921862715',
};

function brief(d, n = 1000) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function env(r) {
  return r?.data?.data || r?.data || {};
}
function cr(r) {
  return env(r).cancellationRequest || {};
}

function passengers(tag) {
  const pool = [
    { title: 'Mr', firstName: 'Vikram', lastName: 'Shah', gender: 'Male', dob: '1987-03-14' },
    { title: 'Mrs', firstName: 'Neha', lastName: 'Shah', gender: 'Female', dob: '1991-11-22' },
  ];
  return pool.map((p, i) => {
    const prof = buildPassengerProfile({ ...p, lastName: `${p.lastName}${tag}` });
    return {
      paxId: `PAX${i + 1}`,
      type: 'adult',
      isLead: i === 0,
      profile: {
        title: prof.title, firstName: prof.firstName, lastName: prof.lastName,
        gender: prof.gender, dob: prof.dob, nationality: 'IN',
      },
      city: { cityCode: 'Pune', cityName: 'Pune' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    };
  });
}

async function cancelCall(client, br, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${br}/cancel`,
    query: Q,
    body: { retryCount: 2, ...body },
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function waitConfirm(flight, br, max = 12) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (/confirm/i.test(last)) return last;
    if (/inprogress/i.test(last) && i >= 3) return last;
    if (isTerminalBookingStatus(last) && !/pending|progress/i.test(last)) return last;
    await sleep(3000);
  }
  return last;
}

function pick(analysis) {
  return analysis.nonStop[0] || analysis.connecting[0] || null;
}

async function book(flight, client) {
  const routes = [
    { o: 'DEL', d: 'BOM', od: 45, rd: 52 },
    { o: 'BOM', d: 'BLR', od: 40, rd: 47 },
    { o: 'DEL', d: 'HYD', od: 50, rd: 57 },
    { o: 'BLR', d: 'DEL', od: 42, rd: 49 },
  ];

  for (const r of routes) {
    console.log(`\nBOOK CORPORATE RT 2ADT ${r.o}<->${r.d} +${r.od}/+${r.rd}`);
    const body = buildRoundTripSearchBody(r.od, r.rd, {
      origin: r.o, destination: r.d, fareType: 'CORPORATE', maxStops: 0,
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences = { airlines: [], maxStops: 0, refundableOnly: false };

    let onwardOpt = null;
    for (let i = 0; i < 12; i += 1) {
      const s = await flight.search(body);
      const onward = analyzeFlightOptions(s.data, 'ONWARD');
      onwardOpt = pick(onward);
      console.log(`  onward ${i + 1}`, s.data?.progress?.state, 'n', onward.total);
      if (onwardOpt?.searchId && (isSearchProgressComplete(s.data) || i >= 4)) break;
      if (isSearchProgressComplete(s.data) && !onwardOpt) break;
      await sleep(s.data?.progress?.pollAfterMs || 2800);
    }
    if (!onwardOpt?.searchId) continue;

    const refined = { ...body, selection: { selectedSearchIds: [onwardOpt.searchId] } };
    let returnOpt = null;
    for (let i = 0; i < 12; i += 1) {
      const s = await flight.search(refined);
      const ret = analyzeFlightOptions(s.data, 'RETURN');
      returnOpt = pick(ret);
      console.log(`  return ${i + 1}`, s.data?.progress?.state, 'n', ret.total);
      if (returnOpt?.searchId && (isSearchProgressComplete(s.data) || i >= 3)) break;
      if (isSearchProgressComplete(s.data) && !returnOpt) break;
      await sleep(s.data?.progress?.pollAfterMs || 2800);
    }
    if (!returnOpt?.searchId) continue;

    const searchIds = [onwardOpt.searchId, returnOpt.searchId];
    const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
    if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
      console.log('  pricing fail', brief(pricing.data, 200));
      continue;
    }
    console.log('  price', pricing.data.pricing?.totalAmount, 'gst', pricing.data.addGstInfo);

    const tag = String(Date.now()).slice(-4);
    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: 'ROUND_TRIP',
    });
    payload.data.passengers = passengers(tag);
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };

    const issue = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
    console.log('  issue', issue.status, br || brief(issue.data, 250));
    if (!br) {
      if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') return { error: 'INSUFFICIENT_BALANCE' };
      continue;
    }

    const status = await waitConfirm(flight, br);
    if (!/confirm/i.test(String(status))) {
      console.log('  skip —', status);
      continue;
    }

    const detail = await flight.getBookingDetail(br);
    const itins = detail.data?.bookingResponse?.itinerary || [];
    const onward = itins.find((l) => /onward/i.test(l.direction)) || itins[0];
    const ret = itins.find((l) => /return/i.test(l.direction)) || itins[1];

    return {
      br,
      status,
      fareType: 'CORPORATE',
      journeyType: 'ROUND_TRIP',
      adults: 2,
      route: `${r.o}-${r.d}`,
      dates: { onward: body.itinerary[0].date, return: body.itinerary[1].date },
      totalAmount: detail.data?.bookingResponse?.salesSummary?.totalAmount
        ?? pricing.data.pricing?.totalAmount,
      onwardPnr: onward?.pnr,
      returnPnr: ret?.pnr,
      online: {
        onward: onward?.onlineCancellation,
        return: ret?.onlineCancellation,
      },
    };
  }
  return null;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);
  console.log('Goal: CORPORATE RT 2ADT → PENALTY+CANCEL');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const booked = await book(flight, client);
  if (booked?.error) {
    fs.writeFileSync(OUT, JSON.stringify({ error: booked }, null, 2));
    throw new Error(booked.error);
  }
  if (!booked?.br) {
    fs.writeFileSync(OUT, JSON.stringify({ error: 'NO_BOOKING' }, null, 2));
    throw new Error('No CORPORATE RT booking');
  }

  console.log('\nBOOKED', JSON.stringify(booked, null, 2));

  const pnrs = [...new Set([booked.onwardPnr, booked.returnPnr].filter(Boolean))];
  const cancelFlow = [];

  for (const pnr of pnrs) {
    console.log(`\n=== PENALTY ${booked.br} pnr=${pnr}`);
    const pen = await cancelCall(client, booked.br, {
      action: 'PENALTY',
      pnr,
      cancellationReason: 'CORPORATE RT 2ADT full cancel',
    });
    console.log('PENALTY', pen.status, brief(pen.data, 700));

    await sleep(1200);
    console.log(`=== CANCEL ${booked.br} pnr=${pnr}`);
    const can = await cancelCall(client, booked.br, {
      action: 'CANCEL',
      pnr,
      cancellationReason: 'CORPORATE RT 2ADT full cancel',
    });
    console.log('CANCEL', can.status, brief(can.data, 700));

    cancelFlow.push({
      pnr,
      penalty: { http: pen.status, body: pen.data, cr: cr(pen) },
      cancel: { http: can.status, body: can.data, cr: cr(can) },
    });
  }

  await sleep(2500);
  const afterSt = await flight.getBookingStatus(booked.br);
  const afterDet = await flight.getBookingDetail(booked.br);

  const table = [
    {
      rule: '1 Book CORPORATE RT 2ADT Confirmed',
      how: `${booked.route} ${booked.br}`,
      status: /confirm/i.test(String(booked.status)) ? 'PASS' : 'BUG',
    },
    ...cancelFlow.flatMap((f, i) => ([
      {
        rule: `${i + 2}a PENALTY pnr ${f.pnr}`,
        how: `action=PENALTY → ${f.penalty.cr?.status || f.penalty.http}`,
        status: /penalty fetched/i.test(String(f.penalty.cr?.status || '')) ? 'PASS' : 'BUG',
      },
      {
        rule: `${i + 2}b CANCEL pnr ${f.pnr}`,
        how: `action=CANCEL → ${f.cancel.cr?.status || f.cancel.http}`,
        status: /cancel|requested/i.test(String(f.cancel.cr?.status || ''))
          && !/failed/i.test(String(f.cancel.cr?.status || ''))
          ? 'PASS' : 'BUG',
      },
    ])),
    {
      rule: `${cancelFlow.length + 2} Booking status after cancel`,
      how: String(afterSt.data?.status || afterDet.data?.status || ''),
      status: /cancel/i.test(String(afterSt.data?.status || afterDet.data?.status || ''))
        ? 'PASS' : 'BUG',
    },
  ];

  const score = {
    PASS: table.filter((t) => t.status === 'PASS').length,
    BUG: table.filter((t) => t.status === 'BUG').length,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    booked,
    cancelFlow,
    after: {
      status: afterSt.data?.status,
      detailStatus: afterDet.data?.status,
    },
    table,
    score,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SCORE ===', score);
  console.table(table);
  console.log('Report', OUT);
  if (score.BUG > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

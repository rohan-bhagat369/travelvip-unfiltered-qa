/**
 * Book cheapest BOM-BKK ROUND_TRIP connecting (2 adults).
 * Tries several connecting pairs via pricing and issues the lowest total.
 *
 * Run: node scripts/book-rt-bom-bkk-cheapest-2adt.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildIssueTicketPayload,
  buildRoundTripSearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-rt-bom-bkk-cheapest-2adt-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 900) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function pricingTotal(data) {
  const p = data?.pricing || data?.price || data || {};
  const n = Number(
    p.totalAmount ?? p.grandTotal ?? p.payableAmount ?? p.totalPayable
    ?? p.netFare ?? data?.totalAmount ?? data?.amount ?? NaN,
  );
  return Number.isFinite(n) ? n : null;
}

function optionPrice(opt) {
  const p = opt?.pricing || opt?.price || opt?.fare || {};
  const n = Number(
    p.totalAmount ?? p.totalFare ?? p.finalPrice ?? p.amount
    ?? opt?.totalAmount ?? opt?.totalFare ?? opt?.amount ?? NaN,
  );
  return Number.isFinite(n) ? n : Infinity;
}

function dirOptions(data, direction) {
  const block = (data?.results || []).find((r) => String(r.direction).toUpperCase() === direction);
  return block?.options || [];
}

function isConnecting(opt) {
  return (opt.totalStops ?? 0) > 0 || (opt.segments?.length ?? 0) > 1;
}

function meta(opt, direction) {
  if (!opt) return null;
  return {
    direction,
    searchId: opt.searchId,
    totalStops: opt.totalStops ?? 0,
    segmentCount: opt.segments?.length ?? 0,
    connecting: isConnecting(opt),
    searchPrice: optionPrice(opt),
    flights: (opt.segments || []).map((s) => ({
      flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
      route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
      dep: s.departure?.time,
      arr: s.arrival?.time,
    })),
  };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: BOM-BKK RT | 2ADT | cheapest connecting');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const dateWindows = [[21, 28], [28, 35], [18, 25]];
  let booked = null;
  const attempts = [];

  for (const [onwardDays, returnDays] of dateWindows) {
    const body = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin: 'BOM',
      destination: 'BKK',
      maxStops: null,
      fareType: 'NORMAL',
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

    console.log(`\n=== Search BOM-BKK days ${onwardDays}/${returnDays} ===`);
    let searchRes;
    try {
      searchRes = await flight.searchRoundTripUntilComplete(body);
    } catch (e) {
      console.log('search fail', e.message);
      attempts.push({ onwardDays, returnDays, error: e.message });
      continue;
    }

    let data = searchRes.response?.data;
    let onwardList = dirOptions(data, 'ONWARD').filter(isConnecting)
      .sort((a, b) => optionPrice(a) - optionPrice(b));
    let returnList = dirOptions(data, 'RETURN').filter(isConnecting)
      .sort((a, b) => optionPrice(a) - optionPrice(b));

    console.log('Connecting onward', onwardList.length, 'return', returnList.length);

    // If no return connecting yet, refine with cheapest onward
    if (onwardList.length && !returnList.length) {
      const oid = onwardList[0].searchId;
      try {
        const retRes = await flight.pollReturnSearch(body, {
          ...body,
          selection: { selectedSearchIds: [oid] },
        });
        data = retRes.data;
        returnList = dirOptions(data, 'RETURN').filter(isConnecting)
          .sort((a, b) => optionPrice(a) - optionPrice(b));
        // keep onward from original or re-read
        const o2 = dirOptions(data, 'ONWARD').filter(isConnecting);
        if (o2.length) onwardList = o2.sort((a, b) => optionPrice(a) - optionPrice(b));
        console.log('After refine return connecting', returnList.length);
      } catch (e) {
        console.log('refine fail', e.message);
      }
    }

    if (!onwardList.length || !returnList.length) {
      attempts.push({ note: 'no connecting both sides', onward: onwardList.length, return: returnList.length });
      continue;
    }

    // Price top cheap candidates; pick lowest pricing total
    const candidates = [];
    const oTop = onwardList.slice(0, 4);
    const rTop = returnList.slice(0, 4);
    for (const o of oTop) {
      for (const r of rTop) {
        if (!o.searchId || !r.searchId || o.searchId === r.searchId) continue;
        candidates.push({ o, r });
      }
    }

    console.log('Pricing', candidates.length, 'candidate pairs...');
    let best = null;
    for (const cand of candidates) {
      const pricing = await flight.getPricing([cand.o.searchId, cand.r.searchId], 'ROUND_TRIP');
      if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) {
        console.log('pricing skip', brief(pricing.data, 120));
        continue;
      }
      const total = pricingTotal(pricing.data);
      console.log('pair total', total, cand.o.searchId.slice(-8), cand.r.searchId.slice(-8));
      if (!best || (total != null && (best.total == null || total < best.total))) {
        best = {
          total,
          pricing: pricing.data,
          o: cand.o,
          r: cand.r,
          oMeta: meta(cand.o, 'ONWARD'),
          rMeta: meta(cand.r, 'RETURN'),
        };
      }
    }

    if (!best) {
      attempts.push({ note: 'no priced pair' });
      continue;
    }

    console.log('Cheapest priced total:', best.total);
    console.log('Onward', best.oMeta);
    console.log('Return', best.rMeta);

    const payload = buildIssueTicketPayload({
      bookingContext: best.pricing.bookingContext,
      priceId: best.pricing.priceId,
      searchIds: [best.o.searchId, best.r.searchId],
      journeyType: 'ROUND_TRIP',
    });
    payload.data.passportType = best.pricing.passportType || 'REGULAR';
    payload.data.passengers = [
      {
        paxId: 'PAX1',
        type: 'adult',
        isLead: true,
        profile: {
          title: 'Mr',
          firstName: config.flight.passengerFirstName || 'Rohan',
          lastName: config.flight.passengerLastName || 'Bhagat',
          gender: 'Male',
          dob: config.flight.passengerDob || '2001-05-29',
          nationality: 'IN',
        },
        city: { cityCode: 'Mumbai', cityName: 'Mumbai' },
        passport: {
          number: 'Z7654321',
          expiry: '2030-06-01',
          issuedDate: '2019-06-01',
          issuedCountryCode: 'IN',
        },
        ssr: { baggage: [], meals: [], seats: [] },
      },
      {
        paxId: 'PAX2',
        type: 'adult',
        isLead: false,
        profile: {
          title: 'Mr',
          firstName: 'Amit',
          lastName: 'Sharma',
          gender: 'Male',
          dob: '1995-08-15',
          nationality: 'IN',
        },
        city: { cityCode: 'Mumbai', cityName: 'Mumbai' },
        passport: {
          number: 'Z8765432',
          expiry: '2030-06-01',
          issuedDate: '2019-06-01',
          issuedCountryCode: 'IN',
        },
        ssr: { baggage: [], meals: [], seats: [] },
      },
    ];

    console.log('Issuing cheapest ticket...');
    let issue = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    console.log('Issue v2', issue.status, brief(issue.data, 300));
    if (!ok(issue) || !issue.data?.bookingReference) {
      issue = await client.request({
        method: 'POST',
        path: '/v1/flights/booking/issue-ticket',
        query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      console.log('Issue v1', issue.status, brief(issue.data, 300));
    }

    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
    if (!br) {
      attempts.push({
        error: 'issue failed',
        total: best.total,
        snippet: brief(issue.data, 400),
      });
      if (/INSUFFICIENT_BALANCE/i.test(brief(issue.data))) {
        console.log('Insufficient balance:', issue.data?.error?.details);
        break;
      }
      continue;
    }

    let status = issue.data?.status;
    for (let i = 0; i < 40; i += 1) {
      const st = await flight.getBookingStatus(br);
      status = st.data?.status;
      console.log('Status', i + 1, status);
      if (ok(st) && isTerminalBookingStatus(status)) break;
      await sleep(5000);
    }

    booked = {
      route: 'BOM-BKK-BOM',
      onwardDays,
      returnDays,
      pricedTotal: best.total,
      bothConnecting: true,
      onward: best.oMeta,
      return: best.rMeta,
      searchIds: [best.o.searchId, best.r.searchId],
      bookingReference: br,
      status,
      issueHttp: issue.status,
    };

    if (/confirm/i.test(String(status))) break;
    if (/fail/i.test(String(status))) {
      attempts.push({ ...booked, note: 'failed' });
      booked = null;
      continue;
    }
    break;
  }

  const summary = {
    baseUrl: config.baseUrl,
    goal: 'BOM-BKK RT 2ADT cheapest connecting',
    booked,
    attempts,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    bookingReference: booked?.bookingReference,
    status: booked?.status,
    route: booked?.route,
    pricedTotal: booked?.pricedTotal,
    bothConnecting: booked?.bothConnecting,
    onwardFlights: booked?.onward?.flights,
    returnFlights: booked?.return?.flights,
    report: OUT,
  }, null, 2));

  if (!booked?.bookingReference || !/confirm/i.test(String(booked.status))) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});

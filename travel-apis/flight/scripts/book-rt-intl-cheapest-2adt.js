/**
 * Find + book cheapest international RT connecting (2 adults).
 * Tries short-haul routes first; prices pairs; issues lowest total.
 *
 * Run: node scripts/book-rt-intl-cheapest-2adt.js
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

const OUT = path.join('reports', 'book-rt-intl-cheapest-2adt-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function pricingTotal(data) {
  const keys = [
    data?.totalAmount, data?.amount, data?.grandTotal, data?.payableAmount,
    data?.pricing?.totalAmount, data?.price?.totalAmount, data?.fare?.totalAmount,
    data?.breakdown?.totalAmount, data?.totalFare,
  ];
  for (const k of keys) {
    const n = Number(k);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const s = JSON.stringify(data || {});
  const m = s.match(/"totalAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : null;
}
function isConnecting(opt) {
  return (opt.totalStops ?? 0) > 0 || (opt.segments?.length ?? 0) > 1;
}
function dirOptions(data, direction) {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === direction)?.options) || [];
}
function flightMeta(opt, direction) {
  if (!opt) return null;
  return {
    direction,
    searchId: opt.searchId,
    connecting: isConnecting(opt),
    totalStops: opt.totalStops ?? 0,
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
  console.log('Goal: book cheapest intl RT connecting | 2ADT');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  // Short-haul / usually cheaper first
  const routes = [
    { origin: 'DEL', destination: 'KTM' },
    { origin: 'BOM', destination: 'KTM' },
    { origin: 'DEL', destination: 'CMB' },
    { origin: 'BOM', destination: 'CMB' },
    { origin: 'CCU', destination: 'DAC' },
    { origin: 'DEL', destination: 'DAC' },
    { origin: 'MAA', destination: 'CMB' },
    { origin: 'DEL', destination: 'MLE' },
    { origin: 'BOM', destination: 'MLE' },
    { origin: 'DEL', destination: 'KUL' },
    { origin: 'BOM', destination: 'BKK' },
    { origin: 'DEL', destination: 'BKK' },
  ];

  const candidates = [];
  const errors = [];

  for (const route of routes) {
    for (const [onwardDays, returnDays] of [[21, 28]]) {
      const body = buildRoundTripSearchBody(onwardDays, returnDays, {
        origin: route.origin,
        destination: route.destination,
        maxStops: null,
        fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

      const label = `${route.origin}-${route.destination}`;
      console.log(`\n=== Search ${label} ===`);
      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('search fail', e.message);
        errors.push({ route: label, error: e.message });
        continue;
      }

      let data = searchRes.response?.data;
      let onward = dirOptions(data, 'ONWARD').filter(isConnecting);
      let ret = dirOptions(data, 'RETURN').filter(isConnecting);

      if (onward.length && !ret.length) {
        try {
          const retRes = await flight.pollReturnSearch(body, {
            ...body,
            selection: { selectedSearchIds: [onward[0].searchId] },
          });
          data = retRes.data;
          ret = dirOptions(data, 'RETURN').filter(isConnecting);
          const o2 = dirOptions(data, 'ONWARD').filter(isConnecting);
          if (o2.length) onward = o2;
        } catch (e) {
          console.log('refine fail', e.message);
        }
      }

      console.log('conn', onward.length, ret.length);
      if (!onward.length || !ret.length) {
        errors.push({ route: label, note: 'no connecting' });
        continue;
      }

      // Price first 2x2 pairs only (speed)
      for (const o of onward.slice(0, 2)) {
        for (const r of ret.slice(0, 2)) {
          if (o.searchId === r.searchId) continue;
          try {
            const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
            if (!ok(pricing) || !pricing.data?.priceId || !pricing.data?.bookingContext) continue;
            const total = pricingTotal(pricing.data);
            console.log(`  ${label} total`, total);
            if (total == null) continue;
            candidates.push({
              route: `${label}-${route.origin}`,
              origin: route.origin,
              destination: route.destination,
              onwardDays,
              returnDays,
              total,
              pricing: pricing.data,
              o,
              r,
              oMeta: flightMeta(o, 'ONWARD'),
              rMeta: flightMeta(r, 'RETURN'),
            });
          } catch (e) {
            console.log('price err', e.message);
          }
        }
      }
    }
  }

  candidates.sort((a, b) => a.total - b.total);
  console.log('\n=== TOP CHEAP ===');
  candidates.slice(0, 5).forEach((c, i) => {
    console.log(`${i + 1}. ${c.route} INR ${c.total}`);
  });

  if (!candidates.length) {
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ booked: null, errors, candidates: [] }, null, 2));
    console.log('No priced connecting candidates');
    process.exitCode = 1;
    return;
  }

  // Try book cheapest first; on wallet fail try next cheaper
  let booked = null;
  const issueAttempts = [];

  for (const best of candidates.slice(0, 6)) {
    console.log(`\nIssuing ${best.route} @ INR ${best.total}...`);
    const payload = buildIssueTicketPayload({
      bookingContext: best.pricing.bookingContext,
      priceId: best.pricing.priceId,
      searchIds: [best.o.searchId, best.r.searchId],
      journeyType: 'ROUND_TRIP',
    });
    payload.data.passportType = best.pricing.passportType || 'REGULAR';
    payload.data.passengers = [
      {
        paxId: 'PAX1', type: 'adult', isLead: true,
        profile: {
          title: 'Mr',
          firstName: config.flight.passengerFirstName || 'Rohan',
          lastName: config.flight.passengerLastName || 'Bhagat',
          gender: 'Male',
          dob: config.flight.passengerDob || '2001-05-29',
          nationality: 'IN',
        },
        city: { cityCode: 'Delhi', cityName: 'Delhi' },
        passport: { number: 'Z7654321', expiry: '2030-06-01', issuedDate: '2019-06-01', issuedCountryCode: 'IN' },
        ssr: { baggage: [], meals: [], seats: [] },
      },
      {
        paxId: 'PAX2', type: 'adult', isLead: false,
        profile: {
          title: 'Mr', firstName: 'Amit', lastName: 'Sharma',
          gender: 'Male', dob: '1995-08-15', nationality: 'IN',
        },
        city: { cityCode: 'Delhi', cityName: 'Delhi' },
        passport: { number: 'Z8765432', expiry: '2030-06-01', issuedDate: '2019-06-01', issuedCountryCode: 'IN' },
        ssr: { baggage: [], meals: [], seats: [] },
      },
    ];

    let issue = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    console.log('Issue', issue.status, brief(issue.data, 280));

    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
    if (!br) {
      issueAttempts.push({ route: best.route, total: best.total, snippet: brief(issue.data, 350) });
      if (/INSUFFICIENT_BALANCE/i.test(brief(issue.data))) {
        console.log('Wallet short, try next…', issue.data?.error?.details);
        continue;
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
      route: best.route,
      pricedTotal: best.total,
      bothConnecting: true,
      onward: best.oMeta,
      return: best.rMeta,
      searchIds: [best.o.searchId, best.r.searchId],
      bookingReference: br,
      status,
    };

    if (/confirm/i.test(String(status))) break;
    if (/fail/i.test(String(status))) {
      issueAttempts.push({ ...booked, note: 'failed' });
      booked = null;
      continue;
    }
    break;
  }

  const summary = {
    baseUrl: config.baseUrl,
    goal: 'book cheapest intl RT connecting 2ADT',
    ranked: candidates.slice(0, 10).map((c) => ({ route: c.route, total: c.total })),
    booked,
    issueAttempts,
    errors: errors.slice(-20),
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    bookingReference: booked?.bookingReference,
    status: booked?.status,
    route: booked?.route,
    pricedTotal: booked?.pricedTotal,
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

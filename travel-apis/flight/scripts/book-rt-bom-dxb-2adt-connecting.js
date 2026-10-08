/**
 * Book BOM-DXB ROUND_TRIP connecting, 2 adults (international + passport).
 * Run: node scripts/book-rt-bom-dxb-2adt-connecting.js
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

const OUT = path.join('reports', 'book-rt-bom-dxb-2adt-connecting-staging.json');

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
  const m = JSON.stringify(data || {}).match(/"totalAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
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
  console.log('Goal: BOM-DXB RT | 2ADT | connecting | any price');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const attempts = [];
  let booked = null;

  for (const [onwardDays, returnDays] of [[21, 28], [28, 35], [18, 25]]) {
    const body = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin: 'BOM',
      destination: 'DXB',
      maxStops: null,
      fareType: 'NORMAL',
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

    console.log(`\n=== Search BOM-DXB days ${onwardDays}/${returnDays} ===`);
    let searchRes;
    try {
      searchRes = await flight.searchRoundTripUntilComplete(body);
    } catch (e) {
      console.log('search fail', e.message);
      attempts.push({ onwardDays, returnDays, error: e.message });
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
        console.log('After refine return conn', ret.length);
      } catch (e) {
        console.log('refine fail', e.message);
      }
    }

    console.log('Connecting onward', onward.length, 'return', ret.length);
    if (!onward.length || !ret.length) {
      attempts.push({ note: 'no connecting pair', onward: onward.length, return: ret.length });
      continue;
    }

    // Price first connecting pair that prices successfully
    const candidates = [];
    for (const o of onward.slice(0, 3)) {
      for (const r of ret.slice(0, 3)) {
        if (o.searchId === r.searchId) continue;
        try {
          const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
          if (!ok(pricing) || !pricing.data?.priceId || !pricing.data?.bookingContext) continue;
          const total = pricingTotal(pricing.data);
          console.log('priced', total);
          candidates.push({
            total: total ?? 0,
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

    candidates.sort((a, b) => a.total - b.total);
    if (!candidates.length) {
      attempts.push({ onwardDays, returnDays, note: 'no connecting priced' });
      continue;
    }

    console.log('Selected pair total:', candidates[0].total, `(${candidates.length} candidates)`);

    for (const best of candidates.slice(0, 3)) {
      console.log(`Issuing BOM-DXB @ INR ${best.total}...`);
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
          city: { cityCode: 'Mumbai', cityName: 'Mumbai' },
          passport: { number: 'Z7654321', expiry: '2030-06-01', issuedDate: '2019-06-01', issuedCountryCode: 'IN' },
          ssr: { baggage: [], meals: [], seats: [] },
        },
        {
          paxId: 'PAX2', type: 'adult', isLead: false,
          profile: {
            title: 'Mr', firstName: 'Amit', lastName: 'Sharma',
            gender: 'Male', dob: '1995-08-15', nationality: 'IN',
          },
          city: { cityCode: 'Mumbai', cityName: 'Mumbai' },
          passport: { number: 'Z8765432', expiry: '2030-06-01', issuedDate: '2019-06-01', issuedCountryCode: 'IN' },
          ssr: { baggage: [], meals: [], seats: [] },
        },
      ];

      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      console.log('Issue', issue.status, brief(issue.data, 300));

      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        attempts.push({ total: best.total, error: 'issue failed', snippet: brief(issue.data) });
        if (/INSUFFICIENT_BALANCE/i.test(brief(issue.data))) {
          console.log('Wallet:', issue.data?.error?.details);
          break;
        }
        continue;
      }

      let status = issue.data?.status;
      for (let i = 0; i < 48; i += 1) {
        const st = await flight.getBookingStatus(br);
        status = st.data?.status;
        console.log('Status', i + 1, status);
        if (ok(st) && isTerminalBookingStatus(status)) break;
        // if stuck in progress long, still keep polling
        await sleep(5000);
      }

      booked = {
        route: 'BOM-DXB-BOM',
        onwardDays,
        returnDays,
        pricedTotal: best.total,
        bothConnecting: Boolean(best.oMeta?.connecting) && Boolean(best.rMeta?.connecting),
        onward: best.oMeta,
        return: best.rMeta,
        searchIds: [best.o.searchId, best.r.searchId],
        bookingReference: br,
        status,
      };

      if (/confirm/i.test(String(status))) break;
      if (/fail/i.test(String(status))) {
        attempts.push({ ...booked, note: 'failed' });
        booked = null;
        continue;
      }
      // pending / in progress — report but try next date window only if failed
      if (/progress|pending/i.test(String(status))) {
        console.log('Still in progress after poll — keeping BR');
        break;
      }
      break;
    }

    if (booked && (/confirm/i.test(String(booked.status)) || booked.bookingReference)) break;
  }

  const summary = {
    baseUrl: config.baseUrl,
    goal: 'BOM-DXB RT connecting 2ADT',
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

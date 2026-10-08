/**
 * Book international ROUND_TRIP, 2 adults, connecting on both legs
 * (or at least one connecting leg). Includes passport for intl.
 *
 * Run: node scripts/book-rt-intl-2adt-connecting.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  analyzeFlightOptions,
  buildIssueTicketPayload,
  buildRoundTripSearchBody,
  buildRoundTripSearchIds,
  extractOnwardSearchIds,
  extractReturnSearchId,
  extractSearchIds,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-rt-intl-bom-bkk-2adt-connecting-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 900) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function optionPrice(opt) {
  const p = opt?.pricing || opt?.price || opt?.fare || {};
  return Number(
    p.totalAmount ?? p.totalFare ?? p.finalPrice ?? p.amount
    ?? opt?.totalAmount ?? opt?.totalFare ?? opt?.amount ?? Infinity,
  );
}

function connectingOptions(searchData, direction) {
  const block = searchData?.results?.find((r) => String(r.direction).toUpperCase() === direction)
    || searchData?.results?.[0];
  const options = (block?.options || [])
    .filter((opt) => (opt.totalStops ?? 0) > 0 || (opt.segments?.length ?? 0) > 1)
    .map((opt) => ({
      searchId: opt.searchId,
      totalStops: opt.totalStops ?? 0,
      segmentCount: opt.segments?.length ?? 0,
      price: optionPrice(opt),
      connecting: true,
    }))
    .sort((a, b) => a.price - b.price);
  return options;
}

function optionMeta(searchData, searchId) {
  for (const block of searchData?.results || []) {
    for (const opt of block?.options || []) {
      if (opt.searchId === searchId) {
        const stops = opt.totalStops ?? 0;
        const segCount = opt.segments?.length ?? 0;
        return {
          direction: block.direction,
          searchId,
          totalStops: stops,
          segmentCount: segCount,
          connecting: stops > 0 || segCount > 1,
          flights: (opt.segments || []).map((s) => ({
            flight: `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim(),
            route: `${s.departure?.airportCode}→${s.arrival?.airportCode}`,
            dep: s.departure?.time,
            arr: s.arrival?.time,
          })),
        };
      }
    }
  }
  return null;
}

function passportFor(paxIndex) {
  return {
    number: paxIndex === 1 ? 'Z7654321' : 'Z8765432',
    expiry: '2030-06-01',
    issuedDate: '2019-06-01',
    issuedCountryCode: 'IN',
  };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: RT international | 2 Adults | connecting on both legs (or ≥1)');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  // BOM-BKK only (user request)
  const routes = [
    { origin: 'BOM', destination: 'BKK' },
  ];

  let booked = null;
  const attempts = [];

  for (const route of routes) {
    for (const [onwardDays, returnDays] of [[21, 28], [28, 35], [35, 45]]) {
      const body = buildRoundTripSearchBody(onwardDays, returnDays, {
        origin: route.origin,
        destination: route.destination,
        maxStops: null,
        fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

      console.log(`\n=== Search ${route.origin}-${route.destination} RT days ${onwardDays}/${returnDays} ===`);
      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('RT search failed', e.message);
        attempts.push({ route, onwardDays, returnDays, error: e.message });
        continue;
      }

      const data = searchRes.response?.data;
      const onwardConn = connectingOptions(data, 'ONWARD');
      let returnConn = connectingOptions(data, 'RETURN');

      console.log('Onward connecting', onwardConn.length, 'Return connecting', returnConn.length);

      let onwardId = onwardConn[0]?.searchId || null;
      let returnId = returnConn[0]?.searchId || null;

      if (onwardId && !returnId) {
        const refined = {
          ...body,
          selection: { selectedSearchIds: [onwardId] },
        };
        try {
          const retRes = await flight.pollReturnSearch(body, refined);
          returnConn = connectingOptions(retRes.data, 'RETURN');
          const anyReturn = extractReturnSearchId(retRes.data)
            || extractSearchIds(retRes.data, 20).find((id) => id !== onwardId);
          returnId = returnConn[0]?.searchId || anyReturn || null;
          console.log('After refine: return connecting', returnConn.length, 'returnId', returnId);
          searchRes.response = retRes;
        } catch (e) {
          console.log('return refine fail', e.message);
        }
      }

      if (!onwardId) {
        const anyOnward = extractOnwardSearchIds(data, 8);
        for (const oid of anyOnward) {
          const refined = { ...body, selection: { selectedSearchIds: [oid] } };
          try {
            const retRes = await flight.pollReturnSearch(body, refined);
            const rc = connectingOptions(retRes.data, 'RETURN');
            if (rc.length) {
              onwardId = oid;
              returnId = rc[0].searchId;
              searchRes.response = retRes;
              console.log('Found connecting return with non-stop onward', oid, returnId);
              break;
            }
          } catch {
            /* try next */
          }
        }
      }

      if (!onwardId || !returnId) {
        const pair = buildRoundTripSearchIds(searchRes.response?.data);
        if (pair.length >= 2) {
          const oMeta = optionMeta(searchRes.response.data, pair[0]);
          const rMeta = optionMeta(searchRes.response.data, pair[1]);
          if (oMeta?.connecting || rMeta?.connecting) {
            onwardId = pair[0];
            returnId = pair[1];
          }
        }
      }

      if (!onwardId || !returnId || onwardId === returnId) {
        attempts.push({
          route, onwardDays, returnDays,
          note: 'No suitable connecting pair',
          onwardConn: onwardConn.length,
          returnConn: returnConn.length,
        });
        continue;
      }

      const finalData = searchRes.response.data;
      const oMeta = optionMeta(finalData, onwardId) || onwardConn.find((c) => c.searchId === onwardId);
      let rMeta = optionMeta(finalData, returnId);
      if (!rMeta) {
        const rc = connectingOptions(finalData, 'RETURN');
        rMeta = rc.find((c) => c.searchId === returnId) || { searchId: returnId, connecting: true };
      }

      const bothConnecting = Boolean(oMeta?.connecting) && Boolean(rMeta?.connecting);
      const oneConnecting = Boolean(oMeta?.connecting) || Boolean(rMeta?.connecting);
      if (!oneConnecting) {
        attempts.push({ route, note: 'pair not connecting', oMeta, rMeta });
        continue;
      }

      console.log('Selected pair', { onwardId, returnId, bothConnecting, oMeta, rMeta });

      const pricing = await flight.getPricing([onwardId, returnId], 'ROUND_TRIP');
      console.log('Pricing HTTP', pricing.status, ok(pricing), 'passportType', pricing.data?.passportType);
      if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) {
        console.log('pricing fail', brief(pricing.data, 300));
        attempts.push({ route, error: 'pricing failed', snippet: brief(pricing.data, 300) });
        continue;
      }

      const passportType = pricing.data.passportType || 'REGULAR';
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [onwardId, returnId],
        journeyType: 'ROUND_TRIP',
      });
      payload.data.passportType = passportType;
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
          city: { cityCode: 'Delhi', cityName: 'Delhi' },
          passport: passportFor(1),
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
          city: { cityCode: 'Delhi', cityName: 'Delhi' },
          passport: passportFor(2),
          ssr: { baggage: [], meals: [], seats: [] },
        },
      ];

      console.log('Issuing RT ticket...');
      let issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      console.log('Issue v2', issue.status, brief(issue.data, 250));
      if (!ok(issue) || !issue.data?.bookingReference) {
        issue = await client.request({
          method: 'POST',
          path: '/v1/flights/booking/issue-ticket',
          query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
          body: payload,
          correlation: true,
          partnerKey: client.partnerKey,
        });
        console.log('Issue v1', issue.status, brief(issue.data, 250));
      }

      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        const snip = brief(issue.data, 400);
        attempts.push({ route, error: 'issue failed', snippet: snip });
        if (/INSUFFICIENT_BALANCE|wallet|balance|insufficient/i.test(snip)) {
          console.log('Wallet short for this fare — try next cheaper route. Details:',
            issue.data?.error?.details || snip.slice(0, 200));
          // keep going; cheaper routes may succeed
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

      const detail = await flight.getBookingDetail(br);
      booked = {
        route: `${route.origin}-${route.destination}-${route.origin}`,
        onwardDays,
        returnDays,
        bothConnecting,
        oneConnecting,
        onward: oMeta,
        return: rMeta,
        searchIds: [onwardId, returnId],
        bookingReference: br,
        status,
        issueHttp: issue.status,
        detailSnippet: brief(detail.data, 1200),
      };

      if (/confirm/i.test(String(status))) break;
      if (/fail/i.test(String(status))) {
        attempts.push({ ...booked, note: 'terminal failed' });
        booked = null;
        continue;
      }
      break;
    }
    if (booked && /confirm/i.test(String(booked.status))) break;
  }

  const summary = {
    baseUrl: config.baseUrl,
    goal: 'RT international 2ADT connecting both or one leg',
    booked,
    attempts: attempts.slice(-15),
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({
    bookingReference: booked?.bookingReference,
    status: booked?.status,
    route: booked?.route,
    bothConnecting: booked?.bothConnecting,
    onwardFlights: booked?.onward?.flights || booked?.onward,
    returnFlights: booked?.return?.flights || booked?.return,
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

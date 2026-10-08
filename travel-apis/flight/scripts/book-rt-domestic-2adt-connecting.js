/**
 * Book domestic ROUND_TRIP, 2 adults, with connecting flight on both legs
 * (or at least one connecting leg).
 *
 * Run: node scripts/book-rt-domestic-2adt-connecting.js
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
  isSearchProgressComplete,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-rt-domestic-2adt-connecting-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 900) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function connectingOptions(searchData, direction) {
  return analyzeFlightOptions(searchData, direction).connecting || [];
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

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Goal: RT domestic | 2 Adults | connecting on both legs (or ≥1)');

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  const routes = [
    { origin: 'DEL', destination: 'GOI' },
    { origin: 'BOM', destination: 'CCU' },
    { origin: 'DEL', destination: 'IXC' },
    { origin: 'BOM', destination: 'GAU' },
    { origin: 'DEL', destination: 'TRV' },
    { origin: 'BLR', destination: 'PAT' },
    { origin: 'DEL', destination: 'IXB' },
    { origin: 'BOM', destination: 'IXR' },
  ];

  let booked = null;
  const attempts = [];

  for (const route of routes) {
    for (const [onwardDays, returnDays] of [[14, 21], [21, 28], [18, 25]]) {
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

      // Prefer both connecting; else one connecting
      let onwardId = onwardConn[0]?.searchId || null;
      let returnId = returnConn[0]?.searchId || null;

      // If we have onward connecting but no return yet, refine with connecting onward
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
          // attach for meta
          searchRes.response = retRes;
        } catch (e) {
          console.log('return refine fail', e.message);
        }
      }

      // If no onward connecting, try any onward + connecting return
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

      // Last resort: any RT pair if we somehow have connecting on initial pair from buildRoundTripSearchIds
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
      // re-analyze return from final data
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
      console.log('Pricing HTTP', pricing.status, ok(pricing));
      if (!ok(pricing) || !pricing.data?.bookingContext || !pricing.data?.priceId) {
        console.log('pricing fail', brief(pricing.data, 300));
        attempts.push({ route, error: 'pricing failed', snippet: brief(pricing.data, 300) });
        continue;
      }

      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [onwardId, returnId],
        journeyType: 'ROUND_TRIP',
      });
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
          passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
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
          passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
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
        attempts.push({ route, error: 'issue failed', snippet: brief(issue.data, 400) });
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

      if (/confirm/i.test(String(status)) || /pending|progress/i.test(String(status))) {
        // prefer confirmed; accept if we got a BR
        if (/confirm/i.test(String(status))) break;
        // keep trying other routes if failed
        if (/fail/i.test(String(status))) {
          attempts.push({ ...booked, note: 'terminal failed' });
          booked = null;
          continue;
        }
        break;
      }
      if (/fail/i.test(String(status))) {
        attempts.push({ ...booked, note: 'failed' });
        booked = null;
      } else {
        break;
      }
    }
    if (booked && /confirm/i.test(String(booked.status))) break;
  }

  const summary = {
    baseUrl: config.baseUrl,
    goal: 'RT domestic 2ADT connecting both or one leg',
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

/**
 * Book ROUND_TRIP with connecting (1+ stop) on at least one leg — prefer both.
 * 1 adult, NORMAL fare.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-rt-connecting-1adt.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  analyzeFlightOptions,
  buildIssueTicketPayload,
  buildRoundTripSearchBody,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-rt-connecting-1adt-canary.json');
const Q = { ...FLIGHT_QUERY };

function brief(d, n = 350) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
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
          })),
        };
      }
    }
  }
  return null;
}

function extractPnrs(detail) {
  return (detail?.bookingResponse?.itinerary || [])
    .map((leg) => ({ direction: leg.direction, pnr: leg.pnr, stops: leg.totalStops ?? leg.segments?.length - 1 }))
    .filter((x) => x.pnr);
}

async function waitStatus(flight, br, max = 12) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    const st = await flight.getBookingStatus(br);
    last = String(st.data?.status || '');
    console.log('  status', i + 1, last);
    if (isTerminalBookingStatus(last)) return last;
    if (/inprogress|pending/i.test(last) && i >= 4) return last;
    await sleep(3000);
  }
  return last;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base:', config.baseUrl);
  console.log('Goal: RT connecting 1ADT');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const routes = [
    { o: 'DEL', d: 'GOI' },
    { o: 'BOM', d: 'CCU' },
    { o: 'DEL', d: 'IXC' },
    { o: 'BLR', d: 'PAT' },
    { o: 'BOM', d: 'GAU' },
    { o: 'DEL', d: 'TRV' },
    { o: 'DEL', d: 'IXB' },
    { o: 'BOM', d: 'IXR' },
  ];
  const windows = [[20, 27], [25, 32], [30, 37]];

  let booked = null;
  const attempts = [];

  for (const route of routes) {
    if (booked) break;
    for (const [od, rd] of windows) {
      if (booked) break;
      console.log(`\n=== ${route.o}-${route.d} RT d+${od}/${rd} ===`);
      const body = buildRoundTripSearchBody(od, rd, {
        origin: route.o,
        destination: route.d,
        maxStops: null,
        fareType: 'NORMAL',
      });
      body.travellers = { adults: 1, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };

      let searchRes;
      try {
        searchRes = await flight.searchRoundTripUntilComplete(body);
      } catch (e) {
        console.log('search fail', e.message);
        attempts.push({ route, od, rd, error: e.message });
        continue;
      }

      const data = searchRes.response?.data;
      const onwardConn = analyzeFlightOptions(data, 'ONWARD').connecting || [];
      const returnConn = analyzeFlightOptions(data, 'RETURN').connecting || [];
      console.log('connecting onward', onwardConn.length, 'return', returnConn.length);

      let onwardId = onwardConn[0]?.searchId || null;
      let returnId = returnConn[0]?.searchId || null;

      // Need at least one connecting leg
      if (!onwardId && !returnId) {
        console.log('no connecting options');
        attempts.push({ route, od, rd, skip: 'no connecting' });
        continue;
      }

      // Fill missing leg with any option from that direction
      if (!onwardId) {
        onwardId = analyzeFlightOptions(data, 'ONWARD').nonStop[0]?.searchId
          || data?.results?.find((r) => r.direction === 'ONWARD')?.options?.[0]?.searchId;
      }
      if (!returnId) {
        // refine return after selecting connecting onward
        if (onwardId) {
          const refined = {
            ...body,
            selection: { selectedSearchIds: [onwardId] },
          };
          try {
            const ref = await flight.searchRoundTripUntilComplete(refined);
            const rdConn = analyzeFlightOptions(ref.response?.data, 'RETURN').connecting || [];
            const rdAny = analyzeFlightOptions(ref.response?.data, 'RETURN');
            returnId = rdConn[0]?.searchId
              || rdAny.nonStop[0]?.searchId
              || rdAny.connecting[0]?.searchId;
            if (returnId) Object.assign(data?.results ? data : {}, ref.response?.data || {});
          } catch (e) {
            console.log('refine fail', e.message);
          }
        }
        if (!returnId) {
          returnId = analyzeFlightOptions(data, 'RETURN').nonStop[0]?.searchId
            || data?.results?.find((r) => r.direction === 'RETURN')?.options?.[0]?.searchId;
        }
      }

      if (!onwardId || !returnId) {
        console.log('missing pair', { onwardId: !!onwardId, returnId: !!returnId });
        continue;
      }

      const metaO = optionMeta(data, onwardId) || { searchId: onwardId, connecting: true };
      const metaR = optionMeta(data, returnId) || { searchId: returnId };
      console.log('pick onward', metaO.connecting ? 'CONN' : 'DIRECT', metaO.flights);
      console.log('pick return', metaR.connecting ? 'CONN' : 'DIRECT', metaR.flights);

      if (!metaO.connecting && !metaR.connecting) {
        console.log('pair not connecting — skip');
        continue;
      }

      const pricing = await flight.getPricing([onwardId, returnId], 'ROUND_TRIP');
      if (!pricing.data?.priceId) {
        console.log('pricing fail', brief(pricing.data));
        attempts.push({ route, od, rd, stage: 'pricing', err: brief(pricing.data) });
        continue;
      }
      console.log('price', pricing.data?.pricing?.totalAmount, 'addGst', pricing.data?.addGstInfo);

      const tag = String(Date.now()).slice(-4);
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [onwardId, returnId],
        journeyType: 'ROUND_TRIP',
        passengerProfile: {
          title: 'Mr',
          firstName: 'Aarav',
          lastName: `Kapoor${tag}`,
          gender: 'Male',
          dob: '1990-08-15',
        },
      });

      // Corporate/GST fares may require gstDetails; NORMAL usually not
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
      }

      const issue = await client.request({
        method: 'POST',
        path: '/api/v2/flights/booking/issue-ticket',
        query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
        body: payload,
        correlation: true,
        partnerKey: client.partnerKey,
      });
      const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
      if (!br) {
        console.log('issue fail', brief(issue.data));
        attempts.push({ route, od, rd, stage: 'issue', err: brief(issue.data) });
        if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') break;
        continue;
      }

      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const detailStatus = detail.data?.status || status;
      const legs = extractPnrs(detail.data);

      booked = {
        br,
        status: detailStatus,
        route: `${route.o}-${route.d}`,
        days: { od, rd },
        total: pricing.data?.pricing?.totalAmount,
        onward: metaO,
        return: metaR,
        legs,
        connectingOnward: Boolean(metaO.connecting),
        connectingReturn: Boolean(metaR.connecting),
      };
      console.log('BOOKED', br, detailStatus, legs);
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    booked,
    attempts,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (!booked) {
    console.error('No RT connecting booking created');
    process.exit(1);
  }
  console.log('\nRESULT', booked.br, booked.status);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

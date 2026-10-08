/**
 * Retry DEL-DXB RT SpiceJet booking with seat/meal/baggage.
 * Uses later travel dates + different pax name if prior issue-ticket 500s.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-flight-del-dxb-rt-addons-retry.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildRoundTripSearchBody,
  buildPassengerProfile,
  canSelectSeats,
} from '../src/helpers.js';
import { config } from '../../../shared/config/env.js';

const FLIGHT_QUERY = { lang: 'en', currency: 'INR' };

function money(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function brOf(d) {
  return d?.bookingReference || d?.bookingReferenceId || d?.data?.bookingReference || null;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function parseWeightKg(t) {
  const m = String(t || '').match(/(\d+)\s*KG/i);
  return m ? Number(m[1]) : null;
}
function futurePassportExpiry() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return d.toISOString().slice(0, 10);
}

function pickMeals(ssr, max = 2) {
  const segs = ssr?.meal?.segments || [];
  const picked = [];
  const seen = new Set();
  for (const seg of segs) {
    let best = null;
    for (const m of seg.Meals || seg.meals || []) {
      const amt = money(m.pricing?.totalAmount ?? m.totalAmount ?? m.amount);
      if (amt == null || amt <= 0 || !(m.priceReference || m.pricing?.priceReference)) continue;
      const cand = {
        mealId: m.ssrId || m.mealId,
        ssrId: m.ssrId,
        code: m.code,
        title: m.title || m.description,
        description: m.description || m.title || m.code,
        segmentId: m.segmentId || seg.segmentId || 'SEG_1',
        direction: String(m.direction || seg.direction || 'ONWARD').toUpperCase(),
        paxType: m.paxType || 'ADT',
        priceReference: m.priceReference || m.pricing?.priceReference,
        amount: amt,
        origin: m.origin || seg.origin || 'DEL',
        destination: m.destination || seg.destination || 'DXB',
      };
      if (!best || amt < best.amount) best = cand;
    }
    if (best && !seen.has(best.direction)) {
      seen.add(best.direction);
      picked.push(best);
    }
    if (picked.length >= max) break;
  }
  return picked;
}

function pickBags(ssr, max = 2) {
  const segs = ssr?.baggage?.segments || ssr?.baggage?.Segments || [];
  const picked = [];
  const seen = new Set();
  for (const seg of segs) {
    let best = null;
    for (const b of seg.Baggage || seg.baggage || seg.Options || []) {
      const amt = money(b.pricing?.totalAmount ?? b.totalAmount ?? b.amount);
      if (amt == null || amt <= 0 || !(b.priceReference || b.pricing?.priceReference)) continue;
      const cand = {
        baggageId: b.ssrId || b.baggageId,
        ssrId: b.ssrId,
        code: b.code,
        title: b.title || b.description,
        description: b.description || b.title || b.code,
        segmentId: b.segmentId || seg.segmentId || 'SEG_1',
        direction: String(b.direction || seg.direction || 'ONWARD').toUpperCase(),
        paxType: b.paxType || 'ADT',
        priceReference: b.priceReference || b.pricing?.priceReference,
        amount: amt,
        weight: b.weight || parseWeightKg(b.title) || 5,
        origin: b.origin || seg.origin || 'DEL',
        destination: b.destination || seg.destination || 'DXB',
      };
      if (!best || amt < best.amount) best = cand;
    }
    if (best && !seen.has(best.direction)) {
      seen.add(best.direction);
      picked.push(best);
    }
    if (picked.length >= max) break;
  }
  return picked;
}

function pickSeats(seatRes) {
  const segs = (seatRes?.data?.data || seatRes?.data || {}).segments || [];
  const picked = [];
  const used = new Set();
  for (const seg of segs) {
    let best = null;
    for (const s of seg.seatMap || []) {
      if (!/open/i.test(String(s.seatAvailability || ''))) continue;
      const amt = money(s.amount ?? s.price ?? s.priceDetail?.finalPrice);
      const seatName = String(s.seatName || s.seatNumber || s.code || '');
      if (amt == null || amt <= 0 || !seatName || used.has(seatName)) continue;
      const cand = {
        ...s,
        amount: amt,
        seatName,
        segmentId: s.segmentId || seg.segmentId || 'SEG_1',
        origin: s.origin || seg.origin,
        destination: s.destination || seg.destination,
        direction: String(s.direction || seg.direction || 'ONWARD').toUpperCase(),
      };
      if (!best || amt < best.amount) best = cand;
    }
    if (best) {
      used.add(best.seatName);
      picked.push(best);
    }
  }
  return picked;
}

function mealSsr(m) {
  return {
    mealId: String(m.mealId || m.ssrId),
    ssrId: String(m.ssrId || m.mealId),
    code: m.code,
    title: m.title,
    description: m.description || m.title,
    segmentId: m.segmentId,
    direction: m.direction,
    paxType: 'ADT',
    quantity: 1,
    priceReference: m.priceReference,
    amount: m.amount,
    origin: m.origin,
    destination: m.destination,
  };
}
function bagSsr(b) {
  return {
    baggageId: String(b.baggageId || b.ssrId),
    ssrId: String(b.ssrId || b.baggageId),
    code: b.code,
    title: b.title,
    description: b.description || b.title,
    segmentId: b.segmentId,
    direction: b.direction,
    paxType: 'ADT',
    quantity: 1,
    priceReference: b.priceReference,
    amount: b.amount,
    weight: b.weight || 5,
    origin: b.origin,
    destination: b.destination,
  };
}
function seatSsr(s) {
  return {
    segmentId: s.segmentId,
    seatName: s.seatName,
    seatNumber: s.seatName,
    seatId: s.seatId || s.seatKey,
    seatAvailability: s.seatAvailability || 'Open',
    code: s.seatName,
    amount: s.amount,
    price: s.amount,
    row: s.row ?? s.xaxis,
    column: s.column ?? s.yaxis,
    priceReference: s.priceDetail?.priceReference || s.priceReference,
    itinRef: s.itinRef,
    seatGroup: s.seatGroup,
    seatKey: s.seatKey || s.seatId,
    seatRef: s.seatRef,
    seatType: s.seatType,
    direction: s.direction,
    paxType: 'ADT',
    description: `Seat ${s.seatName}`,
    origin: s.origin,
    destination: s.destination,
  };
}

async function issueTicket(client, session, body) {
  return client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
    body,
    correlation: true,
    partnerKey: session.accessToken,
  });
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const dateWindows = [
    [50, 57],
    [55, 62],
    [65, 72],
  ];

  let lastErr = null;

  for (const [onwardDays, returnDays] of dateWindows) {
    const body = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin: 'DEL',
      destination: 'DXB',
      fareType: 'NORMAL',
    });
    body.travellers = { adults: 1, children: 0, infants: 0 };
    body.preferences.airlines = ['SG'];
    console.log('\nSearching', body.itinerary);

    let search;
    try {
      search = await flight.searchRoundTripUntilComplete(body);
    } catch (e) {
      lastErr = e.message;
      console.log('search fail', lastErr);
      continue;
    }

    const data = search.response?.data;
    const onward = (data?.results || [])
      .find((r) => r.direction === 'ONWARD')
      ?.options?.filter((o) => o.segments?.[0]?.airline?.code === 'SG') || [];
    const ret = (data?.results || [])
      .find((r) => r.direction === 'RETURN')
      ?.options?.filter((o) => o.segments?.[0]?.airline?.code === 'SG') || [];

    console.log(
      'SG onward',
      onward.slice(0, 3).map((o) => o.segments?.[0]?.flightNumber),
      'return',
      ret.slice(0, 3).map((o) => o.segments?.[0]?.flightNumber),
    );
    if (!onward.length || !ret.length) {
      lastErr = 'no SG options';
      continue;
    }

    const pairs = [[onward[0].searchId, ret[0].searchId]];
    if (onward[1] && ret[0]) pairs.push([onward[1].searchId, ret[0].searchId]);
    if (onward[0] && ret[1]) pairs.push([onward[0].searchId, ret[1].searchId]);

    for (const ids of pairs) {
      console.log('pricing', ids);
      const p = await flight.getPricing(ids, 'ROUND_TRIP');
      if (!p.ok) {
        lastErr = JSON.stringify(p.data).slice(0, 400);
        console.log('pricing fail', lastErr);
        continue;
      }

      const ssr = await flight.getSsr(p.data.priceId);
      const meals = pickMeals(ssr.data, 2);
      const bags = pickBags(ssr.data, 2);
      let seats = [];
      if (canSelectSeats(p.data)) {
        const sm = await flight.getSeatMap(p.data.bookingContext, [
          {
            paxRefNumber: '1',
            passengerType: 1,
            gender: 'Male',
            title: 'Mr',
            firstName: 'Aarav',
            lastName: 'Mehta',
          },
        ]);
        if (sm.ok) seats = pickSeats(sm);
      }

      console.log('addons', {
        meals: meals.map((m) => m.amount),
        bags: bags.map((b) => b.amount),
        seats: seats.map((s) => `${s.seatName}:${s.amount}`),
        fare: p.data?.pricing?.totalAmount,
      });
      if (!meals.length || !bags.length) {
        lastErr = 'no meal/bag';
        continue;
      }

      const profile = buildPassengerProfile({
        title: 'Mr',
        firstName: 'Aarav',
        lastName: 'Mehta',
        gender: 'Male',
        dob: '1992-03-18',
      });

      const makeBody = (withSeats) => ({
        type: 'ticket',
        currency: 'INR',
        language: 'en',
        bookingReference: p.data.bookingContext,
        searchIds: ids,
        journeyType: 'ROUND_TRIP',
        timezone: 'Asia/Calcutta',
        data: {
          priceId: p.data.priceId,
          passportType: p.data.passportType || 'REGULAR',
          includeGst: false,
          gstDetails: null,
          contact: {
            email: config.flight.contactEmail || 'rohan@travelvip.ai',
            mobile: config.flight.contactMobile || '9876543210',
            countryCode: config.flight.contactCountryCode || '+91',
          },
          passengers: [
            {
              paxId: 'PAX1',
              type: 'adult',
              isLead: true,
              profile: {
                title: profile.title,
                firstName: profile.firstName,
                lastName: profile.lastName,
                gender: profile.gender,
                dob: profile.dob,
                nationality: 'IN',
              },
              city: { cityCode: 'DEL', cityName: 'New Delhi' },
              passport: {
                number: 'Z7654321',
                expiry: futurePassportExpiry(),
                issuedDate: '2019-06-01',
                issuedCountryCode: 'IN',
              },
              ssr: {
                baggage: bags.map(bagSsr),
                meals: meals.map(mealSsr),
                seats: withSeats ? seats.map(seatSsr) : [],
              },
            },
          ],
        },
      });

      let issue = await issueTicket(session.client, session, makeBody(true));
      let br = brOf(issue.data);
      console.log('issue', issue.status, 'BR', br, issue.data?.message || issue.data?.error?.message || '');

      if ((!issue.ok || !br) && seats.length) {
        lastErr = JSON.stringify(issue.data).slice(0, 500);
        console.log('retry without seats...');
        issue = await issueTicket(session.client, session, makeBody(false));
        br = brOf(issue.data);
        console.log('issue(no-seat)', issue.status, 'BR', br, issue.data?.message || issue.data?.error?.message || '');
      }

      if (!issue.ok || !br) {
        lastErr = JSON.stringify(issue.data).slice(0, 800);
        console.log('issue fail', lastErr);
        // wallet?
        if (issue.data?.available != null || /wallet|balance|insufficient/i.test(lastErr)) {
          console.log('wallet available=', issue.data?.available, 'required=', issue.data?.required);
        }
        continue;
      }

      let status = issue.data?.status;
      for (let i = 0; i < 36; i += 1) {
        const st = await flight.getBookingStatus(br);
        status = st.data?.status || status;
        console.log(`poll ${i + 1}:`, status);
        if (/confirm|fail|cancel/i.test(String(status))) break;
        await sleep(5000);
      }

      const detail = await flight.getBookingDetail(br);
      const sales = detail.data?.bookingResponse?.salesSummary || {};
      const out = {
        ranAt: new Date().toISOString(),
        br,
        status: detail.data?.status || status,
        sales: {
          totalAmount: sales.totalAmount,
          mealPrice: sales.mealPrice,
          baggagePrice: sales.baggagePrice,
          seatPrice: sales.seatPrice,
        },
        itinerary: (detail.data?.bookingResponse?.itinerary || []).map((j) => ({
          direction: j.direction,
          pnr: j.pnr,
          flight: j.segments?.[0]?.flightNumber,
          from: j.segments?.[0]?.departure?.airportCode,
          to: j.segments?.[j.segments.length - 1]?.arrival?.airportCode,
        })),
        selected: {
          meals: meals.map((m) => ({ title: m.title, amount: m.amount, direction: m.direction })),
          bags: bags.map((b) => ({ title: b.title, amount: b.amount, direction: b.direction })),
          seats: seats.map((s) => ({ seatName: s.seatName, amount: s.amount, direction: s.direction })),
          fareTotal: p.data?.pricing?.totalAmount,
        },
      };

      fs.mkdirSync('reports/flight', { recursive: true });
      const reportPath = path.join('reports/flight', 'del-dxb-rt-addons-retry.json');
      fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
      fs.writeFileSync(path.join('reports/flight', `${br}-detail.json`), JSON.stringify(detail.data, null, 2));

      console.log('\n=== DONE ===');
      console.log(JSON.stringify(out, null, 2));
      return;
    }
  }

  throw new Error(lastErr || 'all booking attempts failed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

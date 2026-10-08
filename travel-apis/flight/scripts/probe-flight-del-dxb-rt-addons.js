/**
 * Book DEL-DXB ROUND_TRIP, 1 Adult, with seat + meal + baggage on staging.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-flight-del-dxb-rt-addons.js
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

function brOf(data) {
  return data?.bookingReference || data?.bookingReferenceId || data?.data?.bookingReference || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseWeightKg(text) {
  const m = String(text || '').match(/(\d+)\s*KG/i);
  return m ? Number(m[1]) : null;
}

function pickMeals(ssr, max = 2) {
  const segs = ssr?.meal?.segments || [];
  const picked = [];
  const seenDir = new Set();
  for (const seg of segs) {
    let paidBest = null;
    for (const m of seg.Meals || seg.meals || []) {
      const amt = money(m.pricing?.totalAmount ?? m.totalAmount ?? m.amount);
      if (amt == null || amt <= 0) continue;
      if (!(m.priceReference || m.pricing?.priceReference)) continue;
      const cand = {
        mealId: m.ssrId || m.mealId,
        ssrId: m.ssrId,
        code: m.code,
        title: m.title || m.description,
        description: m.description || m.title || m.code,
        segmentId: m.segmentId || seg.segmentId || 'SEG_1',
        direction: String(m.direction || seg.direction || 'ONWARD').toUpperCase(),
        paxType: m.paxType || 'ADT',
        priceReference: m.priceReference || m.pricing?.priceReference || null,
        amount: amt,
        origin: m.origin || seg.Origin || seg.origin || 'DEL',
        destination: m.destination || seg.Destination || seg.destination || 'DXB',
      };
      if (!paidBest || amt < paidBest.amount) paidBest = cand;
    }
    if (paidBest && !seenDir.has(paidBest.direction)) {
      seenDir.add(paidBest.direction);
      picked.push(paidBest);
    }
    if (picked.length >= max) break;
  }
  // fallback: any single cheapest paid meal
  if (!picked.length) {
    for (const seg of segs) {
      for (const m of seg.Meals || seg.meals || []) {
        const amt = money(m.pricing?.totalAmount ?? m.totalAmount ?? m.amount);
        if (amt == null || amt <= 0) continue;
        if (!(m.priceReference || m.pricing?.priceReference)) continue;
        picked.push({
          mealId: m.ssrId || m.mealId,
          ssrId: m.ssrId,
          code: m.code,
          title: m.title || m.description,
          description: m.description || m.title || m.code,
          segmentId: m.segmentId || seg.segmentId || 'SEG_1',
          direction: String(m.direction || 'ONWARD').toUpperCase(),
          paxType: m.paxType || 'ADT',
          priceReference: m.priceReference || m.pricing?.priceReference || null,
          amount: amt,
          origin: m.origin || seg.Origin || seg.origin || 'DEL',
          destination: m.destination || seg.Destination || seg.destination || 'DXB',
        });
        return picked.slice(0, 1);
      }
    }
  }
  return picked;
}

function pickBags(ssr, max = 2) {
  const segs = ssr?.baggage?.segments || ssr?.baggage?.Segments || [];
  const picked = [];
  const seenDir = new Set();
  for (const seg of segs) {
    let best = null;
    for (const b of seg.Baggage || seg.baggage || seg.Options || []) {
      const amt = money(b.pricing?.totalAmount ?? b.totalAmount ?? b.amount);
      if (amt == null || amt <= 0) continue;
      if (!(b.priceReference || b.pricing?.priceReference)) continue;
      const cand = {
        baggageId: b.ssrId || b.baggageId,
        ssrId: b.ssrId,
        code: b.code,
        title: b.title || b.description,
        description: b.description || b.title || b.code,
        segmentId: b.segmentId || seg.segmentId || 'SEG_1',
        direction: String(b.direction || seg.direction || 'ONWARD').toUpperCase(),
        paxType: b.paxType || 'ADT',
        priceReference: b.priceReference || b.pricing?.priceReference || null,
        amount: amt,
        weight: b.weight || parseWeightKg(b.title) || parseWeightKg(b.code) || parseWeightKg(b.description) || 5,
        origin: b.origin || seg.Origin || seg.origin || 'DEL',
        destination: b.destination || seg.Destination || seg.destination || 'DXB',
      };
      if (!best || amt < best.amount) best = cand;
    }
    if (best && !seenDir.has(best.direction)) {
      seenDir.add(best.direction);
      picked.push(best);
    }
    if (picked.length >= max) break;
  }
  return picked;
}

function pickSeatsPerSegment(seatRes, max = 4) {
  const data = seatRes?.data?.data || seatRes?.data || {};
  const segs = data.segments || [];
  const picked = [];
  const used = new Set();
  for (const seg of segs) {
    let paidBest = null;
    for (const s of seg.seatMap || []) {
      if (!/open/i.test(String(s.seatAvailability || ''))) continue;
      const amt = money(s.amount ?? s.price ?? s.priceDetail?.finalPrice);
      if (amt == null || amt <= 0) continue;
      const seatName = String(s.seatName || s.seatNumber || s.code || '');
      if (!seatName || used.has(seatName)) continue;
      const cand = {
        ...s,
        amount: amt,
        seatName,
        segmentId: s.segmentId || seg.segmentId || 'SEG_1',
        origin: s.origin || seg.origin,
        destination: s.destination || seg.destination,
        direction: String(s.direction || seg.direction || 'ONWARD').toUpperCase(),
      };
      if (!paidBest || amt < paidBest.amount) paidBest = cand;
    }
    if (paidBest) {
      used.add(paidBest.seatName);
      picked.push(paidBest);
    }
    if (picked.length >= max) break;
  }
  return picked;
}

function buildMealSsr(m) {
  return {
    mealId: String(m.mealId || m.ssrId),
    ssrId: String(m.ssrId || m.mealId),
    code: m.code,
    title: m.title,
    description: m.description || m.title,
    segmentId: m.segmentId,
    direction: m.direction || 'ONWARD',
    paxType: m.paxType || 'ADT',
    quantity: 1,
    priceReference: m.priceReference,
    amount: m.amount,
    origin: m.origin || 'DEL',
    destination: m.destination || 'DXB',
  };
}

function buildBagSsr(b) {
  return {
    baggageId: String(b.baggageId || b.ssrId),
    ssrId: String(b.ssrId || b.baggageId),
    code: b.code,
    title: b.title,
    description: b.description || b.title,
    segmentId: b.segmentId,
    direction: b.direction || 'ONWARD',
    paxType: b.paxType || 'ADT',
    quantity: 1,
    priceReference: b.priceReference,
    amount: b.amount,
    weight: b.weight || 5,
    origin: b.origin || 'DEL',
    destination: b.destination || 'DXB',
  };
}

function buildSeatSsr(s) {
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
    direction: s.direction || 'ONWARD',
    paxType: 'ADT',
    description: `Seat ${s.seatName}`,
    origin: s.origin,
    destination: s.destination,
  };
}

function futurePassportExpiry() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const client = session.client;

  const out = {
    ranAt: new Date().toISOString(),
    env: config.baseUrl,
    route: 'DEL-DXB ROUND_TRIP',
    travellers: { adults: 1, children: 0, infants: 0 },
    steps: {},
    selected: {},
    error: null,
  };

  const ALLOWED_AIRLINES = new Set(['SG', 'IX', 'I5']); // SpiceJet / Air India Express

  function airlineCodeOf(opt) {
    return String(opt?.segments?.[0]?.airline?.code || opt?.airline?.code || '').toUpperCase();
  }

  function summarizeOpt(opt) {
    const seg = opt?.segments?.[0];
    const last = opt?.segments?.[opt.segments.length - 1];
    return {
      searchId: opt.searchId,
      airline: airlineCodeOf(opt),
      flight: seg?.flightNumber,
      route: `${seg?.departure?.airportCode}->${last?.arrival?.airportCode}`,
      stops: opt.totalStops,
    };
  }

  function isAllowedAirline(opt) {
    return ALLOWED_AIRLINES.has(airlineCodeOf(opt));
  }

  let search = null;
  let searchBody = null;
  let allowedOnward = [];
  let allowedReturn = [];

  // Try a few date windows until SG/IX options appear
  const dateWindows = [
    [28, 35],
    [35, 42],
    [42, 49],
    [50, 57],
    [60, 67],
  ];

  for (const [onwardDays, returnDays] of dateWindows) {
    searchBody = buildRoundTripSearchBody(onwardDays, returnDays, {
      origin: 'DEL',
      destination: 'DXB',
      fareType: 'NORMAL',
      maxStops: null,
    });
    searchBody.travellers = { adults: 1, children: 0, infants: 0 };
    searchBody.preferences.airlines = ['SG', 'IX'];

    console.log('Searching DEL-DXB RT (SG/IX)...', JSON.stringify(searchBody.itinerary));
    try {
      search = await flight.searchRoundTripUntilComplete(searchBody);
    } catch (e) {
      console.log('search fail for window', onwardDays, returnDays, e.message);
      continue;
    }

    const searchData = search.response?.data;
    const onwardOpts = (searchData?.results || [])
      .find((r) => String(r.direction).toUpperCase() === 'ONWARD')
      ?.options || [];
    const returnOpts = (searchData?.results || [])
      .find((r) => String(r.direction).toUpperCase() === 'RETURN')
      ?.options || [];

    allowedOnward = onwardOpts.filter(isAllowedAirline);
    allowedReturn = returnOpts.filter(isAllowedAirline);

    console.log('onward SG/IX', allowedOnward.map(summarizeOpt));
    console.log('return SG/IX', allowedReturn.map(summarizeOpt));

    if (allowedOnward.length && allowedReturn.length) break;

    // Also accept mixed list if filter empty but search returned SG/IX under other keys
    const allOnward = onwardOpts.map(summarizeOpt);
    const allReturn = returnOpts.map(summarizeOpt);
    console.log('all onward sample', allOnward.slice(0, 5));
    console.log('all return sample', allReturn.slice(0, 5));
  }

  if (!allowedOnward.length || !allowedReturn.length) {
    throw new Error('No SpiceJet / Air India Express options found for DEL-DXB RT');
  }

  const searchIds = [allowedOnward[0].searchId, allowedReturn[0].searchId];
  out.steps.search = {
    searchIds,
    itinerary: searchBody.itinerary,
    airlines: ['SG', 'IX'],
    onward: allowedOnward.map(summarizeOpt),
    return: allowedReturn.map(summarizeOpt),
  };
  console.log('chosen searchIds', searchIds);

  let pricing = null;
  let pricedIds = null;
  let meals = [];
  let bags = [];
  let seats = [];
  let seatRes = null;
  let lastErr = null;

  // Build SG/IX RT pairs (onward x return), prefer same airline
  const candidates = [];
  for (const o of allowedOnward.slice(0, 5)) {
    const sameAirlineReturns = allowedReturn.filter((r) => airlineCodeOf(r) === airlineCodeOf(o));
    const returns = (sameAirlineReturns.length ? sameAirlineReturns : allowedReturn).slice(0, 3);
    for (const r of returns) {
      candidates.push([o.searchId, r.searchId]);
    }
  }

  for (const ids of candidates) {
    try {
      console.log('pricing', ids);
      const p = await flight.getPricing(ids, 'ROUND_TRIP');
      if (!p.ok) {
        lastErr = `pricing fail ${JSON.stringify(p.data).slice(0, 250)}`;
        console.log(lastErr);
        continue;
      }
      const s = await flight.getSsr(p.data.priceId);
      if (!s.ok) {
        lastErr = `ssr fail HTTP ${s.status}`;
        continue;
      }
      const m = pickMeals(s.data, 2);
      const b = pickBags(s.data, 2);
      if (!m.length || !b.length) {
        lastErr = `no paid meal/bag (meals=${m.length}, bags=${b.length})`;
        console.log(lastErr, 'priceId', p.data.priceId);
        continue;
      }

      let seatList = [];
      let seatHttp = null;
      if (canSelectSeats(p.data)) {
        seatHttp = await flight.getSeatMap(p.data.bookingContext, [
          {
            paxRefNumber: '1',
            passengerType: 1,
            gender: 'Male',
            title: 'Mr',
            firstName: 'Rohan',
            lastName: 'Bhagat',
          },
        ]);
        if (seatHttp.ok) seatList = pickSeatsPerSegment(seatHttp, 4);
        else lastErr = `seatmap HTTP ${seatHttp.status}`;
      }

      pricing = p;
      pricedIds = ids;
      meals = m;
      bags = b;
      seats = seatList;
      seatRes = seatHttp;
      // Prefer option that has at least one seat; otherwise take meal+bag
      if (m.length && b.length && seatList.length) break;
    } catch (e) {
      lastErr = e.message || String(e);
      console.log('candidate err', lastErr);
    }
  }

  if (!pricing || !meals.length || !bags.length) {
    throw new Error(lastErr || 'No priced option with meal+baggage');
  }

  const fareTotal = money(
    pricing.data?.pricing?.totalAmount
    ?? pricing.data?.totalAmount
    ?? pricing.data?.fareSummary?.totalAmount,
  );
  const mealSum = meals.reduce((a, x) => a + (x.amount || 0), 0);
  const bagSum = bags.reduce((a, x) => a + (x.amount || 0), 0);
  const seatSum = seats.reduce((a, x) => a + (x.amount || 0), 0);

  out.steps.pricing = {
    priceId: pricing.data.priceId,
    bookingContext: pricing.data.bookingContext,
    supportsSeats: canSelectSeats(pricing.data),
    fareTotal,
  };
  out.steps.seatmap = {
    http: seatRes?.status ?? null,
    ok: seatRes?.ok ?? false,
    seats: seats.map((s) => ({ seatName: s.seatName, amount: s.amount, segmentId: s.segmentId, direction: s.direction })),
  };
  out.selected = {
    meals: meals.map((m) => ({ title: m.title, amount: m.amount, direction: m.direction, code: m.code })),
    bags: bags.map((b) => ({ title: b.title, amount: b.amount, direction: b.direction, weight: b.weight })),
    seats: seats.map((s) => ({ seatName: s.seatName, amount: s.amount, direction: s.direction, segmentId: s.segmentId })),
    mealSum,
    bagSum,
    seatSum,
    fareTotal,
    expectedTotal: fareTotal != null ? money(fareTotal + mealSum + bagSum + seatSum) : null,
  };
  console.log('selected', JSON.stringify(out.selected, null, 2));

  if (!seats.length) {
    console.warn('WARNING: no paid open seats found; booking with meal+baggage only');
  }

  const profile = buildPassengerProfile({
    title: 'Mr',
    firstName: 'Rohan',
    lastName: 'Bhagat',
    gender: 'Male',
    dob: '1995-05-15',
  });

  const issueBody = {
    type: 'ticket',
    currency: 'INR',
    language: 'en',
    bookingReference: pricing.data.bookingContext,
    searchIds: pricedIds || searchIds,
    journeyType: 'ROUND_TRIP',
    timezone: 'Asia/Calcutta',
    data: {
      priceId: pricing.data.priceId,
      passportType: pricing.data?.passportType || 'REGULAR',
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
            number: 'Z5123456',
            expiry: futurePassportExpiry(),
            issuedDate: '2020-01-15',
            issuedCountryCode: 'IN',
          },
          ssr: {
            baggage: bags.map(buildBagSsr),
            meals: meals.map(buildMealSsr),
            seats: seats.map(buildSeatSsr),
          },
        },
      ],
    },
  };

  issueBody.searchIds = pricedIds || searchIds;

  out.issuePayloadSummary = {
    journeyType: 'ROUND_TRIP',
    priceId: issueBody.data.priceId,
    searchIds: issueBody.searchIds,
    passportType: 'REGULAR',
    mealCount: meals.length,
    bagCount: bags.length,
    seatCount: seats.length,
  };

  const issue = await client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
    body: issueBody,
    correlation: true,
    partnerKey: session.accessToken,
  });

  const br = brOf(issue.data);
  out.steps.issueTicket = {
    http: issue.status,
    ok: issue.ok,
    br,
    status: issue.data?.status,
    message: issue.data?.message || issue.data?.error?.message || issue.data?.error,
    available: issue.data?.available,
    required: issue.data?.required,
  };
  console.log('issue', issue.status, out.steps.issueTicket.message, 'BR=', br);

  if (!issue.ok || !br) {
    out.error = `issue-ticket failed: ${JSON.stringify(out.steps.issueTicket)}`;
    fs.mkdirSync('reports/flight', { recursive: true });
    fs.writeFileSync(
      path.join('reports/flight', 'del-dxb-rt-addons.json'),
      JSON.stringify(out, null, 2),
    );
    fs.writeFileSync(
      path.join('reports/flight', 'del-dxb-rt-addons-issue-payload.json'),
      JSON.stringify(issueBody, null, 2),
    );
    console.error(out.error);
    process.exit(1);
  }

  let status = issue.data?.status;
  for (let i = 0; i < 36; i += 1) {
    const st = await flight.getBookingStatus(br);
    status = st.data?.status || status;
    console.log(`  poll ${i + 1}:`, status);
    if (/confirm|fail|cancel/i.test(String(status))) break;
    await sleep(5000);
  }
  out.steps.status = { status };

  const detail = await flight.getBookingDetail(br);
  const sales = detail.data?.bookingResponse?.salesSummary || {};
  out.steps.detail = {
    http: detail.status,
    status: detail.data?.status,
    salesSummary: {
      totalAmount: money(sales.totalAmount),
      mealPrice: money(sales.mealPrice),
      baggagePrice: money(sales.baggagePrice),
      seatPrice: money(sales.seatPrice),
      currency: sales.currency || 'INR',
    },
    itinerary: (detail.data?.bookingResponse?.itinerary || []).map((j) => ({
      direction: j.direction,
      pnr: j.pnr,
      flight: j.segments?.[0]?.flightNumber,
      from: j.segments?.[0]?.departure?.airportCode,
      to: j.segments?.[j.segments.length - 1]?.arrival?.airportCode,
    })),
  };

  fs.mkdirSync('reports/flight', { recursive: true });
  const reportPath = path.join('reports/flight', 'del-dxb-rt-addons.json');
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));
  fs.writeFileSync(
    path.join('reports/flight', `${br}-issue-payload.json`),
    JSON.stringify(issueBody, null, 2),
  );
  fs.writeFileSync(
    path.join('reports/flight', `${br}-detail.json`),
    JSON.stringify(detail.data, null, 2),
  );

  console.log('\n=== DONE ===');
  console.log('BR:', br);
  console.log('Status:', status, '/', detail.data?.status);
  console.log('Sales:', JSON.stringify(out.steps.detail.salesSummary));
  console.log('Itinerary:', JSON.stringify(out.steps.detail.itinerary));
  console.log('Report:', reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

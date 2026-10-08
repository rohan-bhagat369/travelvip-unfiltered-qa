/**
 * Staging P0 fixtures for TravelVIP_Flight_DB_TestCases.xlsx
 *
 *   BASE_URL=https://api-staging.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-flight-db-pack-staging-p0.js
 *
 * Leaves Inprogress alone. Writes reports/flight-db-pack-staging-p0.json
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/flight-db-pack-staging-p0.json';
const Q = { ...FLIGHT_QUERY };

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 400) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d).slice(0, n);
  }
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractPnrs(detailData) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /pnr/i.test(k) && !/^BR/i.test(v) && v.length <= 24) {
        for (const p of String(v).split('|').map((x) => x.trim()).filter(Boolean)) {
          if (!seen.has(p)) {
            seen.add(p);
            found.push(p);
          }
        }
      }
      walk(v, depth + 1);
    }
  };
  walk(detailData);
  return found;
}

function adultProfiles(n) {
  const base = [
    ['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'],
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
    ['Neha', 'Patil', 'Mrs', 'Female', '1994-03-12'],
  ];
  return base.slice(0, n).map(([firstName, lastName, title, gender, dob], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    profile: { title, firstName, lastName, gender, dob, nationality: 'IN' },
    city: { cityCode: 'Pune', cityName: 'Pune' },
    passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
    ssr: { baggage: [], meals: [], seats: [] },
  }));
}

async function waitStatus(flight, br) {
  let last;
  for (let i = 0; i < 14; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    if (/inprogress/i.test(st) && i >= 2) {
      console.log('  leave Inprogress');
      return st;
    }
    await sleep(3000);
  }
  return last?.data?.status;
}

function routeOd(pricingData) {
  const legs = pricingData?.itinerary || [];
  return legs.map((leg) => {
    const seg = leg.segments?.[0];
    return {
      direction: String(leg.direction || 'ONWARD').toUpperCase(),
      origin: seg?.departure?.airportCode || seg?.origin,
      destination: seg?.arrival?.airportCode || seg?.destination,
      segmentId: seg?.segmentId || 'SEG_1',
    };
  });
}

async function applySubsetSsr(flight, pricing, passengers) {
  const legs = routeOd(pricing.data);
  const onward = legs[0] || { direction: 'ONWARD', origin: 'DEL', destination: 'BOM', segmentId: 'SEG_1' };
  const applied = { meals: 0, bags: 0, seats: 0 };

  try {
    const ssr = await flight.getSsr(pricing.data.priceId);
    const meals = [];
    for (const seg of ssr.data?.meal?.segments || []) {
      for (const m of seg.Meals || seg.meals || []) {
        const pref = m.priceReference || m.pricing?.priceReference;
        if (!pref) continue;
        meals.push({
          ssrId: String(m.ssrId || m.mealId || ''),
          mealId: String(m.ssrId || m.mealId || ''),
          direction: 'ONWARD',
          segmentId: m.segmentId || seg.segmentId || onward.segmentId,
          paxType: 'ADT',
          code: m.code,
          title: m.title || m.description || 'Meal',
          description: m.description || m.title || 'Meal',
          priceReference: pref,
        });
      }
    }
    const bags = [];
    for (const seg of ssr.data?.baggage?.segments || []) {
      const o = seg.Origin || seg.origin || onward.origin;
      const d = seg.Destination || seg.destination || onward.destination;
      for (const b of seg.Baggage || seg.baggage || []) {
        const pref = b.priceReference || b.pricing?.priceReference;
        if (!pref || !o || !d) continue;
        bags.push({
          ssrId: String(b.ssrId || b.baggageId || ''),
          baggageId: String(b.ssrId || b.baggageId || ''),
          direction: 'ONWARD',
          segmentId: b.segmentId || seg.segmentId || onward.segmentId,
          paxType: 'ADT',
          code: b.code,
          title: b.title || b.description || 'Bag',
          description: b.description || b.title || 'Bag',
          priceReference: pref,
          weight: Number(b.weight || 5),
          origin: o,
          destination: d,
        });
      }
    }
    // B07: pax1 meal, pax2 bag
    if (meals[0] && passengers[0]) {
      passengers[0].ssr.meals = [meals[0]];
      applied.meals = 1;
    }
    if (bags[0] && passengers[1]) {
      passengers[1].ssr.baggage = [bags[0]];
      applied.bags = 1;
    }
  } catch (e) {
    console.log('  ssr fail', e.message);
  }

  try {
    const smPassengers = passengers.map((p, i) => ({
      paxRefNumber: String(i + 1),
      passengerType: 1,
      gender: p.profile.gender,
      title: p.profile.title,
      firstName: p.profile.firstName,
      lastName: p.profile.lastName,
    }));
    const sm = await flight.getSeatMap(pricing.data.bookingContext, smPassengers);
    const segs = (sm.data?.data || sm.data || {}).segments || [];
    const seg = segs[0];
    if (seg && passengers[0]) {
      for (const s of seg.seatMap || []) {
        if (!/open/i.test(String(s.seatAvailability || ''))) continue;
        const pref = s.priceReference || s.priceDetail?.priceReference;
        const seatName = s.seatName || s.seatNumber;
        const seatId = s.seatId || s.seatKey;
        if (!pref || !seatName || !seatId) continue;
        passengers[0].ssr.seats = [{
          origin: s.origin || onward.origin,
          destination: s.destination || onward.destination,
          segmentId: s.segmentId || seg.segmentId || onward.segmentId,
          seatAvailability: s.seatAvailability || 'Open',
          seatName,
          seatPosition: s.seatPosition || '',
          seatKey: String(s.seatKey || seatId),
          seatId: String(seatId),
          direction: 'ONWARD',
          priceReference: pref,
        }];
        applied.seats = 1;
        break;
      }
    }
  } catch (e) {
    console.log('  seatmap fail', e.message);
  }

  return applied;
}

async function issue(client, payload) {
  return client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

async function bookOw(flight, client, {
  scenarioId, label, adults, days, origin, destination, maxStops = 0, withSubsetSsr = false, contactOverride = null,
}) {
  console.log(`\n=== ${scenarioId} ${label}: OW ${origin}->${destination} stops<=${maxStops} adults=${adults} ===`);
  const body = buildOneWaySearchBody(days, {
    origin, destination, fareType: 'NORMAL', maxStops,
  });
  body.travellers = { adults, children: 0, infants: 0 };

  const search = await flight.searchUntilComplete(body);
  const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
  if (!ok(pricing) || !pricing.data?.priceId) {
    throw new Error(`pricing: ${brief(pricing.data)}`);
  }

  const passengers = adultProfiles(adults);
  let addons = { meals: 0, bags: 0, seats: 0 };
  if (withSubsetSsr) {
    addons = await applySubsetSsr(flight, pricing, passengers);
    console.log('  subset SSR', addons);
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
    journeyType: 'ONE_WAY',
  });
  payload.data.passengers = passengers;
  if (contactOverride) {
    payload.data.contact = { ...payload.data.contact, ...contactOverride };
  }

  let iss = await issue(client, payload);
  let br = iss.data?.bookingReference || iss.data?.bookingReferenceId;
  if (!br && withSubsetSsr) {
    console.log('  SSR issue failed, retry plain', brief(iss.data, 180));
    payload.data.passengers = adultProfiles(adults);
    addons = { ...addons, fallbackPlain: true, issueError: brief(iss.data, 200) };
    iss = await issue(client, payload);
    br = iss.data?.bookingReference || iss.data?.bookingReferenceId;
  }
  if (!br) throw new Error(`issue: ${brief(iss.data)}`);

  const status = await waitStatus(flight, br);
  const detail = await flight.getBookingDetail(br);
  const detailStatus = detail.data?.status || status;
  const pnrs = extractPnrs(detail.data);
  const segs = (detail.data?.bookingResponse?.itinerary || []).flatMap((leg) => leg.segments || []);

  return {
    scenarioId,
    label,
    journeyType: 'ONE_WAY',
    route: `${origin}-${destination}`,
    adults,
    br,
    status: detailStatus,
    pnrs,
    pnr: pnrs[0] || null,
    usable: Boolean(pnrs[0]) && !/fail|cancel/i.test(String(detailStatus)),
    segmentCount: segs.length,
    addons,
    contact: payload.data.contact,
    checks: suggestedChecks(scenarioId),
  };
}

async function bookRt(flight, client, {
  scenarioId, label, adults, onwardDays, returnDays, origin, destination,
}) {
  console.log(`\n=== ${scenarioId} ${label}: RT ${origin}<->${destination} ===`);
  const body = buildRoundTripSearchBody(onwardDays, returnDays, {
    origin, destination, fareType: 'NORMAL', maxStops: 0,
  });
  body.travellers = { adults, children: 0, infants: 0 };

  const search = await flight.searchRoundTripUntilComplete(body);
  if (!search.searchIds || search.searchIds.length < 2) throw new Error('no RT searchIds');
  const pricing = await flight.getPricing(search.searchIds, 'ROUND_TRIP');
  if (!ok(pricing) || !pricing.data?.priceId) throw new Error(`RT pricing: ${brief(pricing.data)}`);

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: search.searchIds,
    journeyType: 'ROUND_TRIP',
  });
  payload.data.passengers = adultProfiles(adults);

  const iss = await issue(client, payload);
  const br = iss.data?.bookingReference || iss.data?.bookingReferenceId;
  if (!br) throw new Error(`RT issue: ${brief(iss.data)}`);

  const status = await waitStatus(flight, br);
  const detail = await flight.getBookingDetail(br);
  const detailStatus = detail.data?.status || status;
  const pnrs = extractPnrs(detail.data);

  return {
    scenarioId,
    label,
    journeyType: 'ROUND_TRIP',
    route: `${origin}-${destination}-${origin}`,
    adults,
    br,
    status: detailStatus,
    pnrs,
    pnr: pnrs[0] || null,
    usable: Boolean(pnrs[0]) && !/fail|cancel/i.test(String(detailStatus)),
    checks: suggestedChecks(scenarioId),
  };
}

function suggestedChecks(scenarioId) {
  const map = {
    B01: ['V001', 'V002', 'V003', 'V004', 'V005', 'V006', 'V007', 'V008', 'G01', 'G03', 'G04', 'G06', 'G08', 'G09', 'G10'],
    B02: ['V009', 'V010', 'V011', 'V012', 'G08'],
    B03: ['V013', 'V014', 'V015', 'P01→V043-V044', 'P03→V049-V050', 'G08'],
    B04: ['V016', 'V017', 'G04', 'G08'],
    B07: ['V028', 'V029', 'V030', 'V031(lounge N-A?)', 'V032'],
    B08: ['V033', 'V034', 'V035', 'G10'],
  };
  return map[scenarioId] || [];
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl, 'partner', config.partnerId, 'pid', process.env.FLIGHT_ISSUE_PID);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const fixtures = {};
  const errors = {};

  const jobs = [
    { id: 'B01', run: () => bookOw(flight, client, {
      scenarioId: 'B01', label: 'OW 1ADT direct', adults: 1, days: 55,
      origin: 'DEL', destination: 'BOM', maxStops: 0,
    }) },
    { id: 'B02', run: () => bookOw(flight, client, {
      scenarioId: 'B02', label: 'OW 1ADT connecting', adults: 1, days: 58,
      origin: 'DEL', destination: 'GOI', maxStops: 1,
    }) },
    { id: 'B03', run: () => bookOw(flight, client, {
      scenarioId: 'B03', label: 'OW 3ADT', adults: 3, days: 60,
      origin: 'BLR', destination: 'DEL', maxStops: 0,
    }) },
    { id: 'B04', run: () => bookRt(flight, client, {
      scenarioId: 'B04', label: 'RT 1ADT', adults: 1,
      onwardDays: 62, returnDays: 69, origin: 'BOM', destination: 'HYD',
    }) },
    { id: 'B07', run: () => bookOw(flight, client, {
      scenarioId: 'B07', label: 'OW 3ADT subset SSR', adults: 3, days: 64,
      origin: 'HYD', destination: 'DEL', maxStops: 0, withSubsetSsr: true,
    }) },
    { id: 'B08', run: () => bookOw(flight, client, {
      scenarioId: 'B08', label: 'notify non-passenger contact', adults: 1, days: 66,
      origin: 'MAA', destination: 'BOM', maxStops: 0,
      contactOverride: {
        email: 'cardholder.qa@example.com',
        mobile: '9000011122',
        countryCode: '+91',
      },
    }) },
  ];

  for (const job of jobs) {
    try {
      const f = await job.run();
      fixtures[job.id] = f;
      console.log('  ->', f.scenarioId, f.br, f.status, f.pnr || f.pnrs);
    } catch (e) {
      console.log('FAIL', job.id, e.message);
      errors[job.id] = e.message;
      fixtures[job.id] = { scenarioId: job.id, error: e.message, usable: false };
    }
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    note: 'DB pack P0 fixtures. Run schema gate + V-checks in phpMyAdmin. Leave Inprogress alone.',
    schemaGateSql: [
      'DESC booking_passenger;',
      'DESC flight_journey;',
      'DESC flight_journey_passenger;',
      'DESC booking_item;',
      'DESC payment_transaction;',
      'SHOW COLUMNS FROM booking LIKE \'notify%\';',
      'SHOW COLUMNS FROM booking_item LIKE \'notify%\';',
      'SHOW COLUMNS FROM booking_item LIKE \'vendor_price%\';',
    ],
    fixtures,
    errors,
    usable: Object.values(fixtures).filter((f) => f.usable).map((f) => ({
      scenarioId: f.scenarioId, br: f.br, pnr: f.pnr, status: f.status, checks: f.checks,
    })),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nUSABLE', report.usable);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

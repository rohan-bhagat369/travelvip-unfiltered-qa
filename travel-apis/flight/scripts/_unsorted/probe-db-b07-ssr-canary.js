/**
 * B07 on canary: 3ADT OW + subset SSR (meal/bag/seat), unique names, fail-fast.
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-db-b07-ssr-canary.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
  isSearchProgressComplete,
  extractFirstSearchId,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = 'reports/db-b07-ssr-canary.json';
const Q = { ...FLIGHT_QUERY };
const ROUTES = [
  { o: 'DEL', d: 'BOM', days: 48 },
  { o: 'BLR', d: 'HYD', days: 55 },
  { o: 'MAA', d: 'BOM', days: 58 },
];

const NAME_SETS = [
  [['Dev', 'Malhotra'], ['Riya', 'Banerjee'], ['Kunal', 'Saxena']],
  [['Harsh', 'Trivedi'], ['Ananya', 'Menon'], ['Yash', 'Chawla']],
  [['Nikhil', 'Bhat'], ['Diya', 'Reddy'], ['Omar', 'Qureshi']],
];

function brief(d, n = 280) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function letterTag() {
  let n = Date.now() % 456976;
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function passengers3(setIndex) {
  const names = NAME_SETS[setIndex % NAME_SETS.length];
  const tag = letterTag();
  const city = { cityCode: 'Pune', cityName: 'Pune' };
  const passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
  const female = new Set(['Riya', 'Ananya', 'Diya']);
  return names.map(([first, last], i) => ({
    paxId: `PAX${i + 1}`,
    type: 'adult',
    isLead: i === 0,
    city,
    passport,
    ssr: { baggage: [], meals: [], seats: [] },
    profile: {
      title: female.has(first) ? 'Mrs' : 'Mr',
      firstName: first,
      lastName: `${last} ${tag}`,
      gender: female.has(first) ? 'Female' : 'Male',
      dob: ['1990-01-15', '1992-06-20', '1988-11-03'][i],
      nationality: 'IN',
    },
  }));
}

async function searchOnce(flight, body) {
  let last;
  for (let i = 0; i < 8; i += 1) {
    last = await flight.search(body);
    const sid = extractFirstSearchId(last.data);
    console.log('  search', i + 1, last.data?.progress?.state, 'sid?', Boolean(sid));
    if (sid) return sid;
    if (isSearchProgressComplete(last.data)) break;
    await sleep(2000);
  }
  return null;
}

async function waitConfirm(flight, br) {
  for (let i = 0; i < 10; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  status', i + 1, s);
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress/i.test(s) && i >= 2) return s;
    await sleep(2500);
  }
  return null;
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
  const applied = { meals: 0, bags: 0, seats: 0, lounge: 0 };

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
    if (seg && passengers[2]) {
      for (const s of seg.seatMap || []) {
        if (!/open/i.test(String(s.seatAvailability || ''))) continue;
        const pref = s.priceReference || s.priceDetail?.priceReference;
        const seatName = s.seatName || s.seatNumber;
        const seatId = s.seatId || s.seatKey;
        if (!pref || !seatName || !seatId) continue;
        passengers[2].ssr.seats = [{
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

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  let fixture = null;

  for (let i = 0; i < ROUTES.length; i += 1) {
    const r = ROUTES[i];
    const paxList = passengers3(i);
    console.log(
      `TRY ${r.o}->${r.d} names=${paxList.map((p) => `${p.profile.firstName} ${p.profile.lastName}`).join(' | ')}`,
    );
    try {
      const body = buildOneWaySearchBody(r.days, {
        origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults: 3, children: 0, infants: 0 };
      const searchId = await searchOnce(flight, body);
      if (!searchId) {
        console.log('  no searchId — next');
        continue;
      }
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  pricing fail', brief(pricing.data));
        continue;
      }
      const applied = await applySubsetSsr(flight, pricing, paxList);
      console.log('  SSR applied', applied);

      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
      });
      payload.data.passengers = paxList;

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
        console.log('  issue fail', brief(issue.data));
        continue;
      }
      const status = await waitConfirm(flight, br);
      const detail = await flight.getBookingDetail(br);
      const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr;
      const pax = (detail.data?.bookingResponse?.passengers || []).map((p) => ({
        paxId: p.paxId,
        name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
        meals: (p.ssr?.meals || p.ssr?.meal || []).length,
        bags: (p.ssr?.baggage || []).length,
        seats: (p.ssr?.seats || p.ssr?.seat || []).length,
      }));
      console.log('  ->', br, status || detail.data?.status, pnr, pax);
      if (pnr && /confirm/i.test(String(status || detail.data?.status)) && pnr !== 'FVRVRV') {
        fixture = {
          br,
          pnr,
          status: detail.data?.status || status,
          route: `${r.o}-${r.d}`,
          applied,
          pax,
          names: paxList.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
        };
        break;
      }
    } catch (e) {
      console.log('  error — next', e.message);
    }
  }

  if (!fixture) throw new Error('No Confirmed B07 fixture after 3 routes');

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'B07',
    checks: ['V028', 'V029', 'V030', 'V031', 'V032'],
    interpretation: {
      V028: 'meal row(s) for subset pax (PAX1)',
      V029: 'baggage row(s) for subset pax (PAX2)',
      V030: 'seat row(s) for subset pax (PAX3) if seatmap allowed',
      V031: 'lounge — likely N-A / absent',
      V032: 'SSR linked to booking_passenger / cells correctly',
    },
    fixture,
    dbSql: [
      'USE travelx;',
      `SET @br := '${fixture.br}';`,
      `SELECT bp.id, bp.pax_id, bp.first_name, bp.last_name
FROM booking_passenger bp JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br ORDER BY bp.pax_id;`,
      `-- V028 meals`,
      `SELECT pm.*, bp.pax_id, bp.first_name
FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br;`,
      `-- V029 baggage`,
      `SELECT pb.*, bp.pax_id, bp.first_name
FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br;`,
      `-- V030 seats`,
      `SELECT ps.*, bp.pax_id, bp.first_name
FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference = @br;`,
      `-- V031 lounge (may be empty / N-A)`,
      `SHOW TABLES LIKE '%lounge%';`,
      `SELECT * FROM passenger_delay_care WHERE 1=0; -- placeholder if no lounge table`,
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('FIXTURE', fixture.br, fixture.pnr, fixture.applied);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

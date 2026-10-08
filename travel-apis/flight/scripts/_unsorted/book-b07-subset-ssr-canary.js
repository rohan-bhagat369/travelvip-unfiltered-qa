/**
 * B07: 3ADT OW — PAX1 seat+meal, PAX2 baggage, PAX3 none. No lounge.
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-b07-subset-ssr-canary.js
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

const OUT = 'reports/book-b07-subset-ssr-canary.json';
const Q = { ...FLIGHT_QUERY };
const ROUTES = [
  { o: 'DEL', d: 'BOM', days: 70 },
  { o: 'BLR', d: 'HYD', days: 72 },
  { o: 'HYD', d: 'BLR', days: 74 },
];

function brief(d, n = 300) {
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

function buildPax() {
  const tag = letterTag();
  const city = { cityCode: 'Pune', cityName: 'Pune' };
  const passport = { number: null, expiry: null, issuedDate: null, issuedCountryCode: null };
  const empty = () => ({ baggage: [], meals: [], seats: [] });
  return [
    {
      paxId: 'PAX1', type: 'adult', isLead: true, city, passport, ssr: empty(),
      profile: { title: 'Mr', firstName: 'Aditya', lastName: `Verma ${tag}`, gender: 'Male', dob: '1987-02-14', nationality: 'IN' },
    },
    {
      paxId: 'PAX2', type: 'adult', isLead: false, city, passport, ssr: empty(),
      profile: { title: 'Mrs', firstName: 'Kavya', lastName: `Rao ${tag}`, gender: 'Female', dob: '1991-09-08', nationality: 'IN' },
    },
    {
      paxId: 'PAX3', type: 'adult', isLead: false, city, passport, ssr: empty(),
      profile: { title: 'Mr', firstName: 'Milan', lastName: `Shah ${tag}`, gender: 'Male', dob: '1994-12-01', nationality: 'IN' },
    },
  ];
}

async function searchOnce(flight, body) {
  let last;
  for (let i = 0; i < 8; i += 1) {
    last = await flight.search(body);
    const sid = extractFirstSearchId(last.data);
    console.log('  search', i + 1, last.data?.progress?.state, !!sid);
    if (sid) return sid;
    if (isSearchProgressComplete(last.data)) break;
    await sleep(2000);
  }
  return null;
}

async function waitStatus(flight, br) {
  for (let i = 0; i < 10; i += 1) {
    const st = await flight.getBookingStatus(br);
    const s = String(st.data?.status || '');
    console.log('  status', i + 1, s);
    if (isTerminalBookingStatus(s)) return s;
    if (/inprogress/i.test(s) && i >= 2) {
      console.log('  leave Inprogress');
      return s;
    }
    await sleep(2500);
  }
  return null;
}

function onwardMeta(pricingData) {
  const leg = (pricingData?.itinerary || [])[0] || {};
  const seg = (leg.segments || [])[0] || {};
  return {
    origin: seg.departure?.airportCode || seg.origin || 'DEL',
    destination: seg.arrival?.airportCode || seg.destination || 'BOM',
    segmentId: seg.segmentId || 'SEG_1',
  };
}

async function attachB07Ssr(flight, pricing, passengers) {
  const meta = onwardMeta(pricing.data);
  const applied = { mealPax1: false, seatPax1: false, bagPax2: false, lounge: false };

  // Meal + bag from SSR catalog (no lounge)
  try {
    const ssr = await flight.getSsr(pricing.data.priceId);
    let meal = null;
    for (const seg of ssr.data?.meal?.segments || []) {
      for (const m of seg.Meals || seg.meals || []) {
        const pref = m.priceReference || m.pricing?.priceReference;
        if (!pref) continue;
        meal = {
          ssrId: String(m.ssrId || m.mealId || ''),
          mealId: String(m.ssrId || m.mealId || ''),
          direction: 'ONWARD',
          segmentId: m.segmentId || seg.segmentId || meta.segmentId,
          paxType: 'ADT',
          code: m.code,
          title: m.title || m.description || 'Meal',
          description: m.description || m.title || 'Meal',
          priceReference: pref,
        };
        break;
      }
      if (meal) break;
    }
    let bag = null;
    for (const seg of ssr.data?.baggage?.segments || []) {
      const o = seg.Origin || seg.origin || meta.origin;
      const d = seg.Destination || seg.destination || meta.destination;
      for (const b of seg.Baggage || seg.baggage || []) {
        const pref = b.priceReference || b.pricing?.priceReference;
        if (!pref) continue;
        bag = {
          ssrId: String(b.ssrId || b.baggageId || ''),
          baggageId: String(b.ssrId || b.baggageId || ''),
          direction: 'ONWARD',
          segmentId: b.segmentId || seg.segmentId || meta.segmentId,
          paxType: 'ADT',
          code: b.code,
          title: b.title || b.description || 'Bag',
          description: b.description || b.title || 'Bag',
          priceReference: pref,
          weight: Number(b.weight || 5),
          origin: o,
          destination: d,
        };
        break;
      }
      if (bag) break;
    }
    if (meal) {
      passengers[0].ssr.meals = [meal];
      applied.mealPax1 = true;
    }
    if (bag) {
      passengers[1].ssr.baggage = [bag];
      applied.bagPax2 = true;
    }
  } catch (e) {
    console.log('  getSsr fail', e.message);
  }

  // Seat for PAX1 only
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
    if (seg) {
      for (const s of seg.seatMap || []) {
        if (!/open/i.test(String(s.seatAvailability || ''))) continue;
        const pref = s.priceReference || s.priceDetail?.priceReference;
        const seatName = s.seatName || s.seatNumber;
        const seatId = s.seatId || s.seatKey;
        if (!pref || !seatName || !seatId) continue;
        passengers[0].ssr.seats = [{
          origin: s.origin || meta.origin,
          destination: s.destination || meta.destination,
          segmentId: s.segmentId || seg.segmentId || meta.segmentId,
          seatAvailability: s.seatAvailability || 'Open',
          seatName,
          seatPosition: s.seatPosition || '',
          seatKey: String(s.seatKey || seatId),
          seatId: String(seatId),
          direction: 'ONWARD',
          priceReference: pref,
        }];
        applied.seatPax1 = true;
        break;
      }
    }
  } catch (e) {
    console.log('  seatmap fail', e.message);
  }

  // Ensure PAX3 has no SSR; no lounge anywhere
  passengers[2].ssr = { baggage: [], meals: [], seats: [] };
  for (const p of passengers) {
    delete p.ssr.lounge;
    delete p.ssr.lounges;
  }

  return applied;
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', config.baseUrl);
  console.log('B07: PAX1 seat+meal | PAX2 baggage | PAX3 none | no lounge');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  for (const r of ROUTES) {
    const passengers = buildPax();
    console.log(`TRY ${r.o}->${r.d}`, passengers.map((p) => `${p.paxId}:${p.profile.firstName} ${p.profile.lastName}`).join(' | '));
    try {
      const body = buildOneWaySearchBody(r.days, {
        origin: r.o, destination: r.d, fareType: 'NORMAL', maxStops: 0,
      });
      body.travellers = { adults: 3, children: 0, infants: 0 };
      const searchId = await searchOnce(flight, body);
      if (!searchId) {
        console.log('  skip — no searchId');
        continue;
      }
      const pricing = await flight.getPricing([searchId], 'ONE_WAY');
      if (!pricing.data?.priceId) {
        console.log('  skip — pricing', brief(pricing.data));
        continue;
      }
      const applied = await attachB07Ssr(flight, pricing, passengers);
      console.log('  applied', applied);
      if (!applied.mealPax1 || !applied.bagPax2) {
        console.log('  skip — missing meal or bag inventory');
        continue;
      }

      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
      });
      payload.data.passengers = passengers;

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
      const status = await waitStatus(flight, br);
      const detail = await flight.getBookingDetail(br);
      const detailStatus = detail.data?.status || status;
      const pnr = (detail.data?.bookingResponse?.itinerary || []).find((x) => x.pnr)?.pnr || null;
      const paxOut = (detail.data?.bookingResponse?.passengers || []).map((p) => ({
        paxId: p.paxId,
        name: `${p.profile?.firstName || ''} ${p.profile?.lastName || ''}`.trim(),
        meals: (p.ssr?.meals || p.ssr?.meal || []).length,
        bags: (p.ssr?.baggage || []).length,
        seats: (p.ssr?.seats || p.ssr?.seat || []).length,
      }));

      const report = {
        ranAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        scenario: 'B07',
        expected: 'PAX1 seat+meal; PAX2 baggage; PAX3 none; no lounge',
        route: `${r.o}-${r.d}`,
        br,
        status: detailStatus,
        pnr,
        applied,
        paxOut,
        usable: Boolean(pnr && /confirm/i.test(String(detailStatus)) && pnr !== 'FVRVRV'),
        dbSql: [
          'USE travelx;',
          `SET @br := '${br}';`,
          `SELECT bp.pax_id, bp.first_name, bp.last_name FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id WHERE b.booking_reference = @br ORDER BY bp.pax_id;`,
          `SELECT pm.*, bp.pax_id FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id WHERE b.booking_reference = @br;`,
          `SELECT pb.*, bp.pax_id FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id WHERE b.booking_reference = @br;`,
          `SELECT ps.*, bp.pax_id FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id WHERE b.booking_reference = @br;`,
        ],
      };
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
      console.log('RESULT', br, detailStatus, pnr, paxOut);
      console.log('Report', OUT);
      if (report.usable) return;
      if (/inprogress/i.test(String(detailStatus))) {
        console.log('Stopping — leave Inprogress alone');
        return;
      }
    } catch (e) {
      console.log('  error', e.message);
    }
  }
  throw new Error('No Confirmed B07 after routes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

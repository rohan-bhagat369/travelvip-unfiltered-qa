/**
 * Book representative flight scenarios on zeta-api, then emit phpMyAdmin SQL
 * to check travelx mapping (booking / item / passenger / journey / FJP / SSR / cancel tables).
 *
 *   $env:BASE_URL='https://zeta-api.travelvip.ai'
 *   $env:FLIGHT_ISSUE_PID='vgm'
 *   node scripts/book-zeta-db-pack.js
 */
process.env.BASE_URL = (process.env.BASE_URL || 'https://zeta-api.travelvip.ai').replace(/\/$/, '');
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

import fs from 'fs';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  canSelectSeats,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../../src/helpers.js';
import { buildPassengers, uniqueTag } from '../../src/passengerBuilder.js';
import { sleep } from '../../../../shared/lib/testUtils.js';
import { GST } from '../../../hotel/src/regression/fixtures.js';

const OUT = 'reports/book-zeta-db-pack.json';
const SQL_OUT = 'reports/book-zeta-db-pack.sql';

function brief(data, n = 240) {
  try {
    return JSON.stringify(data || {}).slice(0, n);
  } catch {
    return String(data).slice(0, n);
  }
}

function classifyStatus(raw) {
  const s = String(raw || '').trim();
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

function isSettled(raw) {
  return ['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classifyStatus(raw));
}

async function pollSearch(flight, body, max = 14) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    if (!last.ok) return last;
    const n = (last.data?.results || []).reduce((a, r) => a + (r.options?.length || 0), 0);
    if (n > 0 || isSearchProgressComplete(last.data)) return last;
    await sleep(2500);
  }
  return last;
}

async function pollUntilSettled(flight, br, maxPolls = 28) {
  let last = { status: '', classified: 'Pending', polls: 0 };
  for (let i = 0; i < maxPolls; i += 1) {
    const st = await flight.getBookingStatus(br);
    const raw = String(st.data?.status || '');
    last = { status: raw, classified: classifyStatus(raw), polls: i + 1 };
    console.log('    status', last.polls, last.classified);
    if (isSettled(raw)) return last;
    await sleep(3000);
  }
  return last;
}

function applyGst(payload, pricingData) {
  if (pricingData?.addGstInfo === true) {
    payload.data.includeGst = true;
    payload.data.addGstInfo = true;
    payload.data.gstDetails = { ...GST };
    return;
  }
  payload.data.includeGst = false;
  payload.data.addGstInfo = false;
  payload.data.gstDetails = null;
}

function pickOwIds(searchData, limit = 8) {
  const ids = (searchData?.results || [])
    .flatMap((r) => r.options || [])
    .map((o) => o.searchId)
    .filter(Boolean);
  if (ids.length) return ids.slice(0, limit);
  const one = extractFirstSearchId(searchData);
  return one ? [one] : [];
}

function ssrMetaFromPricing(pricingData, origin, destination) {
  const leg0 = (pricingData?.itinerary || [])[0] || {};
  const seg0 = (leg0.segments || [])[0] || {};
  return {
    origin: seg0.departure?.airportCode || origin,
    destination: seg0.arrival?.airportCode || destination,
    segmentId: seg0.segmentId || 'SEG_1',
  };
}

function pickPaidMeal(ssrData, meta) {
  for (const seg of ssrData?.meal?.segments || []) {
    for (const m of seg.Meals || seg.meals || []) {
      const pref = m.priceReference || m.pricing?.priceReference;
      const amt = Number(m.pricing?.totalAmount || m.amount || 0);
      if (!pref || amt <= 0) continue;
      return {
        item: {
          ssrId: String(m.ssrId || m.mealId || ''),
          mealId: String(m.ssrId || m.mealId || ''),
          direction: 'ONWARD',
          segmentId: m.segmentId || seg.segmentId || meta.segmentId,
          paxType: 'ADT',
          code: m.code,
          title: m.title || m.description || 'Meal',
          description: m.description || m.title || 'Meal',
          priceReference: pref,
        },
        amount: amt,
      };
    }
  }
  return null;
}

function pickPaidBag(ssrData, meta) {
  for (const seg of ssrData?.baggage?.segments || ssrData?.baggage?.Segments || []) {
    const o = seg.Origin || seg.origin || meta.origin;
    const d = seg.Destination || seg.destination || meta.destination;
    for (const b of seg.Baggage || seg.baggage || []) {
      const pref = b.priceReference || b.pricing?.priceReference;
      const amt = Number(b.pricing?.totalAmount || b.amount || 0);
      if (!pref || amt <= 0) continue;
      return {
        item: {
          ssrId: String(b.ssrId || b.baggageId || ''),
          baggageId: String(b.ssrId || b.baggageId || ''),
          direction: 'ONWARD',
          segmentId: b.segmentId || seg.segmentId || meta.segmentId,
          paxType: 'ADT',
          code: b.code,
          title: b.title || b.description || 'Baggage',
          description: b.description || b.title || 'Baggage',
          priceReference: pref,
          weight: Number(b.weight || 5),
          origin: o,
          destination: d,
        },
        amount: amt,
      };
    }
  }
  return null;
}

function pickOpenSeat(seatMapRes, meta) {
  const data = seatMapRes?.data?.data || seatMapRes?.data || {};
  const segs = data.segments || data.FlightSeat?.segments || [];
  for (const seg of segs) {
    for (const s of seg.seatMap || seg.seats || []) {
      if (!/open/i.test(String(s.seatAvailability || s.availability || ''))) continue;
      const seatName = s.seatName || s.seatNumber;
      const seatId = s.seatId || s.seatKey;
      const pref = s.priceReference || s.priceDetail?.priceReference;
      if (!seatName || !seatId || !pref) continue;
      return {
        item: {
          origin: s.origin || seg.origin || meta.origin,
          destination: s.destination || seg.destination || meta.destination,
          segmentId: s.segmentId || seg.segmentId || meta.segmentId,
          seatAvailability: s.seatAvailability || 'Open',
          seatName,
          seatPosition: s.seatPosition || '',
          seatKey: String(s.seatKey || seatId),
          seatId: String(seatId),
          direction: 'ONWARD',
          priceReference: pref,
        },
        amount: Number(s.pricing?.totalAmount || s.amount || s.price || 0),
      };
    }
  }
  return null;
}

const SLOTS = [
  {
    id: 'OW-DOM-2ADT',
    journeyType: 'ONE_WAY',
    adults: 2,
    children: 0,
    infants: 0,
    requireSsr: false,
    attachSsrIfPresent: true,
    intl: false,
    routes: [
      { o: 'DEL', d: 'BOM', days: [40, 47, 54] },
      { o: 'BOM', d: 'BLR', days: [41, 48] },
    ],
  },
  {
    id: 'RT-DOM-2ADT',
    journeyType: 'ROUND_TRIP',
    adults: 2,
    children: 0,
    infants: 0,
    requireSsr: false,
    attachSsrIfPresent: true,
    intl: false,
    routes: [
      { o: 'DEL', d: 'BOM', days: [42, 49, 56] },
      { o: 'BOM', d: 'HYD', days: [43, 50] },
    ],
  },
  {
    id: 'OW-DOM-SSR-2ADT',
    journeyType: 'ONE_WAY',
    adults: 2,
    children: 0,
    infants: 0,
    requireSsr: true,
    attachSsrIfPresent: true,
    intl: false,
    routes: [
      { o: 'DEL', d: 'BOM', days: [45, 52, 59] },
      { o: 'DEL', d: 'GOI', days: [46, 53] },
    ],
  },
  {
    id: 'OW-INTL-2ADT',
    journeyType: 'ONE_WAY',
    adults: 2,
    children: 0,
    infants: 0,
    requireSsr: false,
    attachSsrIfPresent: false,
    intl: true,
    routes: [
      { o: 'DEL', d: 'DXB', days: [40, 50, 60] },
      { o: 'BOM', d: 'BKK', days: [42, 55] },
      { o: 'DEL', d: 'SIN', days: [44, 58] },
    ],
  },
  {
    id: 'RT-INTL-2ADT',
    journeyType: 'ROUND_TRIP',
    adults: 2,
    children: 0,
    infants: 0,
    requireSsr: false,
    attachSsrIfPresent: false,
    intl: true,
    routes: [
      { o: 'DEL', d: 'DXB', days: [48, 58] },
      { o: 'BOM', d: 'BKK', days: [50, 60] },
    ],
  },
  {
    id: 'OW-DOM-1ADT-1CHD-1INF',
    journeyType: 'ONE_WAY',
    adults: 1,
    children: 1,
    infants: 1,
    requireSsr: false,
    attachSsrIfPresent: false,
    intl: false,
    routes: [
      { o: 'DEL', d: 'BOM', days: [44, 51, 58] },
      { o: 'BOM', d: 'DEL', days: [45, 52] },
    ],
  },
];

async function resolveCandidates(flight, slot, origin, destination, onwardDays) {
  const travellers = { adults: slot.adults, children: slot.children || 0, infants: slot.infants || 0 };
  if (slot.journeyType === 'ROUND_TRIP') {
    const body = buildRoundTripSearchBody(onwardDays, onwardDays + 7, {
      origin,
      destination,
      fareType: 'NORMAL',
    });
    body.travellers = travellers;
    const probe = await pollSearch(flight, body, 8);
    if (!probe.ok || probe.data?.error?.code === 'NO_FLIGHTS_FOUND') {
      return {
        candidates: [],
        ok: false,
        searchHttp: probe.status,
        searchErr: brief(probe.data),
      };
    }
    try {
      const rt = await flight.searchRoundTripUntilComplete(body);
      return {
        candidates: rt.searchIds?.length >= 2 ? [rt.searchIds] : [],
        ok: Boolean(rt.searchIds?.length >= 2),
        searchHttp: rt.response?.status,
        searchErr: rt.searchIds?.length >= 2 ? null : 'no RT searchId pair',
      };
    } catch (e) {
      return { candidates: [], ok: false, searchErr: String(e.message || e) };
    }
  }
  const body = buildOneWaySearchBody(onwardDays, { origin, destination, fareType: 'NORMAL' });
  body.travellers = travellers;
  const search = await pollSearch(flight, body);
  const ids = search.ok ? pickOwIds(search.data, 8) : [];
  return { candidates: ids.map((id) => [id]), ok: ids.length > 0, searchHttp: search.status, searchErr: brief(search.data) };
}

async function attemptBook(flight, slot, origin, destination, onwardDays, nameLag) {
  const resolved = await resolveCandidates(flight, slot, origin, destination, onwardDays);
  if (!resolved.ok || !resolved.candidates.length) {
    return {
      ok: false,
      stage: 'search',
      route: `${origin}-${destination}`,
      days: onwardDays,
      err: resolved.searchErr || 'no options',
    };
  }

  let lastMiss = null;
  for (const searchIds of resolved.candidates) {
    const pricing = await flight.getPricing(searchIds, slot.journeyType);
    if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
      lastMiss = {
        ok: false,
        stage: 'pricing',
        route: `${origin}-${destination}`,
        days: onwardDays,
        err: brief(pricing.data),
      };
      continue;
    }

    const tag = uniqueTag();
    const passengers = buildPassengers({
      adults: slot.adults,
      children: slot.children || 0,
      infants: slot.infants || 0,
      uniqueNames: true,
      leadFirstName: 'Rohan',
      leadLastName: `Bhagat${tag}`.replace(/[^a-zA-Z]/g, '').slice(0, 16) || 'Bhagatx',
      nameIndex: nameLag,
      withPassport: Boolean(slot.intl),
    });

    const ssrAttach = { meal: null, bag: null, seat: null };
    if (slot.attachSsrIfPresent || slot.requireSsr) {
      const ssr = await flight.getSsr(pricing.data.priceId);
      const meta = ssrMetaFromPricing(pricing.data, origin, destination);
      ssrAttach.meal = pickPaidMeal(ssr.data, meta);
      ssrAttach.bag = pickPaidBag(ssr.data, meta);
      if (canSelectSeats(pricing.data)) {
        const smPax = passengers.map((p, i) => ({
          paxRefNumber: String(i + 1),
          passengerType: p.type === 'child' ? 2 : p.type === 'infant' ? 3 : 1,
          gender: p.profile.gender,
          title: p.profile.title,
          firstName: p.profile.firstName,
          lastName: p.profile.lastName,
        }));
        const seatMap = await flight.getSeatMap(pricing.data.bookingContext, smPax);
        ssrAttach.seat = pickOpenSeat(seatMap, meta);
      }
      if (slot.requireSsr && (!ssrAttach.meal || !ssrAttach.bag || !ssrAttach.seat)) {
        lastMiss = {
          ok: false,
          stage: 'ssr',
          route: `${origin}-${destination}`,
          days: onwardDays,
          missingSsr: {
            meal: !ssrAttach.meal,
            baggage: !ssrAttach.bag,
            seat: !ssrAttach.seat,
            seatsAllowed: canSelectSeats(pricing.data),
          },
        };
        continue;
      }
      const lead = passengers.find((p) => p.isLead) || passengers[0];
      lead.ssr = {
        meals: ssrAttach.meal ? [ssrAttach.meal.item] : [],
        baggage: ssrAttach.bag ? [ssrAttach.bag.item] : [],
        seats: ssrAttach.seat ? [ssrAttach.seat.item] : [],
      };
    }

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: slot.journeyType,
    });
    payload.data.passengers = passengers;
    payload.data.contact.email = `zeta.db.${slot.id}.${Date.now()}@travelvip.ai`;
    payload.data.passportType = slot.intl
      ? pricing.data.passportType || 'REGULAR'
      : pricing.data.passportType || 'NONE';
    applyGst(payload, pricing.data);

    const issue = await flight.issueTicketV2(payload);
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
    if (issue.data?.error?.code === 'INSUFFICIENT_BALANCE') {
      return {
        ok: false,
        stage: 'issue',
        br: null,
        route: `${origin}-${destination}`,
        days: onwardDays,
        issueCode: 'INSUFFICIENT_BALANCE',
        issueMsg: issue.data?.error?.message || null,
        stopPack: true,
      };
    }
    return {
      ok: Boolean(br),
      stage: br ? 'issued' : 'issue',
      br,
      route: `${origin}-${destination}`,
      days: onwardDays,
      journeyType: slot.journeyType,
      adults: slot.adults,
      children: slot.children || 0,
      infants: slot.infants || 0,
      intl: Boolean(slot.intl),
      requireSsr: Boolean(slot.requireSsr),
      priceId: pricing.data.priceId,
      issueHttp: issue.status,
      issueCode: issue.data?.error?.code || null,
      issueMsg: issue.data?.error?.message || null,
      duplicate: Boolean(issue.data?.duplicate),
      ssr: {
        meal: Boolean(ssrAttach.meal),
        bag: Boolean(ssrAttach.bag),
        seat: Boolean(ssrAttach.seat),
        mealCode: ssrAttach.meal?.item?.code || null,
        bagCode: ssrAttach.bag?.item?.code || null,
        seatName: ssrAttach.seat?.item?.seatName || null,
      },
      totalAmount: pricing.data.totalAmount ?? pricing.data.pricing?.totalAmount ?? null,
    };
  }
  return lastMiss || { ok: false, stage: 'pricing', route: `${origin}-${destination}`, days: onwardDays };
}

async function runSlot(flight, slot, nameBase) {
  const attempts = [];
  let nameLag = nameBase;
  let booked = null;
  let stopPack = false;

  outer: for (const r of slot.routes) {
    for (const day of r.days) {
      nameLag += 1;
      console.log(`  ${slot.id} try ${r.o}→${r.d} +${day}d ${slot.journeyType} pax=${slot.adults}A/${slot.children || 0}C/${slot.infants || 0}I`);
      let attempt;
      try {
        attempt = await attemptBook(flight, slot, r.o, r.d, day, nameLag);
      } catch (e) {
        attempt = {
          ok: false,
          stage: 'exception',
          error: String(e.message || e),
          route: `${r.o}-${r.d}`,
          days: day,
        };
      }
      attempts.push(attempt);
      console.log(
        `    stage=${attempt.stage} br=${attempt.br || '-'} code=${attempt.issueCode || attempt.error || JSON.stringify(attempt.missingSsr || '')}`,
      );
      if (attempt.stopPack) {
        stopPack = true;
        break outer;
      }
      if (!attempt.br) continue;

      const st = await pollUntilSettled(flight, attempt.br);
      attempt.classified = st.classified;
      attempt.statusRaw = st.status;
      if (st.classified === 'Confirmed') {
        booked = attempt;
        break outer;
      }
      if (st.classified === 'Inprogress') {
        nameLag += 1;
        const retryDay = day + 9;
        console.log(`    Inprogress — leave ${attempt.br}; one retry +${retryDay}d`);
        let retry;
        try {
          retry = await attemptBook(flight, slot, r.o, r.d, retryDay, nameLag);
        } catch (e) {
          retry = { ok: false, stage: 'exception', error: String(e.message || e) };
        }
        attempts.push({ ...retry, priorInprogressBr: attempt.br });
        if (retry.stopPack) {
          stopPack = true;
          break outer;
        }
        if (retry.br) {
          const st2 = await pollUntilSettled(flight, retry.br);
          retry.classified = st2.classified;
          retry.statusRaw = st2.status;
          if (st2.classified === 'Confirmed') booked = retry;
        }
        break outer;
      }
    }
  }

  return {
    id: slot.id,
    journeyType: slot.journeyType,
    adults: slot.adults,
    children: slot.children || 0,
    infants: slot.infants || 0,
    intl: Boolean(slot.intl),
    requireSsr: Boolean(slot.requireSsr),
    br: booked?.br || null,
    status: booked?.classified || null,
    route: booked?.route || null,
    ssr: booked?.ssr || null,
    totalAmount: booked?.totalAmount || null,
    verdict: booked?.classified === 'Confirmed' ? 'PASS' : 'NOT TESTED',
    stopPack,
    attempts,
  };
}

function sqlForBrs(brs) {
  const list = brs.map((b) => `'${b}'`).join(', ');
  return `-- zeta-api flight DB mapping checks
-- Paste in phpMyAdmin against travelx (or the zeta DB schema if different).
USE travelx;

SELECT b.booking_reference, b.confirmed_at, b.cancelled_at, COUNT(DISTINCT bi.id) AS items
FROM booking b
LEFT JOIN booking_item bi ON bi.booking_id = b.id
WHERE b.booking_reference IN (${list})
GROUP BY b.id, b.booking_reference, b.confirmed_at, b.cancelled_at;

SELECT b.booking_reference, bi.id AS booking_item_id, bi.service_type, bi.version, bsm.code AS item_status
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
LEFT JOIN booking_status_mapping bsm ON bsm.id = bi.current_status_mapping_id
WHERE b.booking_reference IN (${list});

SELECT b.booking_reference, bp.pax_id, bp.first_name, bp.last_name, bp.is_lead, bp.passenger_type
FROM booking_passenger bp
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN (${list})
ORDER BY b.booking_reference, bp.pax_id;

SELECT b.booking_reference, fj.id AS journey_id, fj.sequence, fj.origin, fj.destination, fj.airline_pnr
FROM flight_journey fj
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference IN (${list})
ORDER BY b.booking_reference, fj.sequence;

SELECT
  b.booking_reference,
  bp.pax_id,
  fj.sequence AS journey_seq,
  fjp.id AS cell_id,
  fjp.eticket_number,
  fjp.vendor_pnr,
  fjp.pnr_override,
  bsm.code AS cell_status
FROM flight_journey_passenger fjp
JOIN flight_journey fj ON fj.id = fjp.flight_journey_id
JOIN booking_passenger bp ON bp.id = fjp.booking_passenger_id
JOIN booking_item bi ON bi.id = fj.booking_item_id
JOIN booking b ON b.id = bi.booking_id
LEFT JOIN booking_status_mapping bsm ON bsm.id = fjp.current_status_mapping_id
WHERE b.booking_reference IN (${list})
ORDER BY b.booking_reference, bp.pax_id, fj.sequence;

SELECT
  b.booking_reference,
  COUNT(DISTINCT fj.id) AS journeys,
  COUNT(DISTINCT bp.id) AS pax,
  COUNT(fjp.id) AS cells,
  COUNT(DISTINCT fj.id) * COUNT(DISTINCT bp.id) AS expected_cells
FROM booking b
JOIN booking_item bi ON bi.booking_id = b.id
JOIN flight_journey fj ON fj.booking_item_id = bi.id
JOIN booking_passenger bp ON bp.booking_id = b.id
LEFT JOIN flight_journey_passenger fjp
  ON fjp.flight_journey_id = fj.id AND fjp.booking_passenger_id = bp.id
WHERE b.booking_reference IN (${list})
GROUP BY b.booking_reference;

SELECT b.booking_reference, pm.*
FROM passenger_meal pm
JOIN booking_passenger bp ON bp.id = pm.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN (${list});

SELECT b.booking_reference, pb.*
FROM passenger_baggage pb
JOIN booking_passenger bp ON bp.id = pb.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN (${list});

SELECT b.booking_reference, ps.*
FROM passenger_seat ps
JOIN booking_passenger bp ON bp.id = ps.booking_passenger_id
JOIN booking b ON b.id = bp.booking_id
WHERE b.booking_reference IN (${list});

SELECT b.booking_reference, pt.id, pt.status, pt.amount, pt.txn_type
FROM payment_transaction pt
JOIN booking b ON b.id = pt.booking_id
WHERE b.booking_reference IN (${list});
`;
}

async function main() {
  clearSession();
  console.log('Base', config.baseUrl, 'pid', process.env.FLIGHT_ISSUE_PID, 'partner', config.partnerId);
  if (!/zeta-api\.travelvip\.ai/i.test(config.baseUrl)) {
    throw new Error(`Refusing to run: BASE_URL is ${config.baseUrl}, expected https://zeta-api.travelvip.ai`);
  }

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  console.log('Auth OK');

  const rows = [];
  let nameBase = 0;
  for (const slot of SLOTS) {
    console.log(`\n=== ${slot.id} ===`);
    const row = await runSlot(flight, slot, nameBase);
    nameBase += 20;
    rows.push(row);
    console.log(`  verdict=${row.verdict} br=${row.br || '-'} status=${row.status || '-'}`);
    if (row.stopPack) {
      console.log('Stopping pack: INSUFFICIENT_BALANCE');
      break;
    }
  }

  const confirmed = rows.filter((r) => r.status === 'Confirmed' && r.br);
  const sql = confirmed.length ? sqlForBrs(confirmed.map((r) => r.br)) : '-- no Confirmed BRs; skip SQL\n';
  fs.writeFileSync(SQL_OUT, sql);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    partner: config.partnerId,
    note: 'Book first on zeta-api. Then paste SQL in phpMyAdmin (travelx / zeta schema).',
    summary: {
      PASS: rows.filter((r) => r.verdict === 'PASS').length,
      'NOT TESTED': rows.filter((r) => r.verdict !== 'PASS').length,
      confirmedBrs: confirmed.map((r) => r.br),
    },
    rows,
    sqlFile: SQL_OUT,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Report', OUT);
  console.log('SQL', SQL_OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

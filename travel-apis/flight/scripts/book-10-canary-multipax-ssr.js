/**
 * Book exactly 10 flights on canary: mix OW + RT, multipax (2ADT), with seat+meal+baggage SSR.
 *
 * Usage:
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/book-10-canary-multipax-ssr.js
 *
 * Report: reports/book-10-canary-multipax-ssr.json
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  canSelectSeats,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';
import { buildPassengers, uniqueTag } from '../src/passengerBuilder.js';
import { GST } from '../../hotel/src/regression/fixtures.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
const OUT = path.join('reports', 'book-10-canary-multipax-ssr.json');
const TARGET = 10;

function brief(data, n = 200) {
  return JSON.stringify(data || {}).slice(0, n);
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

function seatMapSegments(seatMapRes) {
  const data = seatMapRes?.data?.data || seatMapRes?.data || {};
  return data.segments || data.FlightSeat?.segments || [];
}

function pickOpenSeat(seatMapRes, meta) {
  for (const seg of seatMapSegments(seatMapRes)) {
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

function ssrMetaFromPricing(pricingData, origin, destination) {
  const leg0 = (pricingData?.itinerary || [])[0] || {};
  const seg0 = (leg0.segments || [])[0] || {};
  return {
    origin: seg0.departure?.airportCode || origin,
    destination: seg0.arrival?.airportCode || destination,
    segmentId: seg0.segmentId || 'SEG_1',
  };
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

async function pollSearch(flight, body, max = 12) {
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

function pickOwSearchIds(searchData, limit = 10) {
  const all = (searchData?.results || []).flatMap((r) => r.options || []);
  const ids = all.map((o) => o.searchId).filter(Boolean);
  if (ids.length) return ids.slice(0, limit);
  const one = extractFirstSearchId(searchData);
  return one ? [one] : [];
}

/** 10 slots: 5 OW multipax + 5 RT multipax; each with route/day fallbacks */
const SLOTS = [
  { id: 'OW-01', journeyType: 'ONE_WAY', adults: 2, children: 0, routes: [{ o: 'DEL', d: 'BOM', days: [35, 42, 49] }, { o: 'BOM', d: 'BLR', days: [36, 43] }] },
  { id: 'OW-02', journeyType: 'ONE_WAY', adults: 2, children: 1, routes: [{ o: 'DEL', d: 'GOI', days: [37, 44, 51] }, { o: 'BOM', d: 'GOI', days: [38, 45] }] },
  { id: 'OW-03', journeyType: 'ONE_WAY', adults: 2, children: 0, routes: [{ o: 'BOM', d: 'HYD', days: [39, 46] }, { o: 'DEL', d: 'HYD', days: [40, 47] }] },
  { id: 'OW-04', journeyType: 'ONE_WAY', adults: 3, children: 0, routes: [{ o: 'DEL', d: 'BOM', days: [41, 48] }, { o: 'BLR', d: 'BOM', days: [42, 49] }] },
  { id: 'OW-05', journeyType: 'ONE_WAY', adults: 2, children: 0, routes: [{ o: 'DEL', d: 'MAA', days: [43, 50] }, { o: 'BOM', d: 'DEL', days: [44, 51] }] },
  { id: 'RT-01', journeyType: 'ROUND_TRIP', adults: 2, children: 0, routes: [{ o: 'DEL', d: 'BOM', days: [45, 52] }, { o: 'BOM', d: 'BLR', days: [46, 53] }] },
  { id: 'RT-02', journeyType: 'ROUND_TRIP', adults: 2, children: 1, routes: [{ o: 'BOM', d: 'GOI', days: [47, 54] }, { o: 'DEL', d: 'GOI', days: [48, 55] }] },
  { id: 'RT-03', journeyType: 'ROUND_TRIP', adults: 2, children: 0, routes: [{ o: 'DEL', d: 'HYD', days: [49, 56] }, { o: 'BLR', d: 'DEL', days: [50, 57] }] },
  { id: 'RT-04', journeyType: 'ROUND_TRIP', adults: 3, children: 0, routes: [{ o: 'BOM', d: 'DEL', days: [51, 58] }, { o: 'DEL', d: 'BLR', days: [52, 59] }] },
  { id: 'RT-05', journeyType: 'ROUND_TRIP', adults: 2, children: 0, routes: [{ o: 'DEL', d: 'MAA', days: [53, 60] }, { o: 'BOM', d: 'HYD', days: [54, 61] }] },
];

async function resolveCandidates(flight, slot, origin, destination, onwardDays) {
  const travellers = { adults: slot.adults, children: slot.children || 0, infants: 0 };
  if (slot.journeyType === 'ROUND_TRIP') {
    const body = buildRoundTripSearchBody(onwardDays, onwardDays + 7, {
      origin,
      destination,
      fareType: 'NORMAL',
    });
    body.travellers = travellers;
    const rt = await flight.searchRoundTripUntilComplete(body);
    return {
      candidates: rt.searchIds?.length >= 2 ? [rt.searchIds] : [],
      journeyType: 'ROUND_TRIP',
      ok: Boolean(rt.searchIds?.length >= 2),
    };
  }
  const body = buildOneWaySearchBody(onwardDays, { origin, destination, fareType: 'NORMAL' });
  body.travellers = travellers;
  const search = await pollSearch(flight, body);
  const ids = search.ok ? pickOwSearchIds(search.data, 10) : [];
  return {
    candidates: ids.map((id) => [id]),
    journeyType: 'ONE_WAY',
    ok: ids.length > 0,
  };
}

async function attemptBook(flight, slot, origin, destination, onwardDays, nameLag) {
  const resolved = await resolveCandidates(flight, slot, origin, destination, onwardDays);
  if (!resolved.ok || !resolved.candidates.length) {
    return { ok: false, stage: 'search', route: `${origin}-${destination}`, days: onwardDays };
  }

  let lastMiss = null;
  for (const searchIds of resolved.candidates) {
    const pricing = await flight.getPricing(searchIds, resolved.journeyType);
    if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
      lastMiss = { ok: false, stage: 'pricing', route: `${origin}-${destination}`, days: onwardDays, err: brief(pricing?.data) };
      continue;
    }

    const ssr = await flight.getSsr(pricing.data.priceId);
    const meta = ssrMetaFromPricing(pricing.data, origin, destination);
    const meal = pickPaidMeal(ssr.data, meta);
    const bag = pickPaidBag(ssr.data, meta);

    const tag = uniqueTag();
    const passengers = buildPassengers({
      adults: slot.adults,
      children: slot.children || 0,
      infants: 0,
      uniqueNames: true,
      leadFirstName: 'Rohan',
      leadLastName: `Bhagat${tag}`.replace(/[^a-zA-Z]/g, '').slice(0, 16) || 'Bhagatx',
      nameIndex: nameLag,
      withPassport: false,
    });

    let seat = null;
    if (canSelectSeats(pricing.data)) {
      const smPax = passengers.map((p, i) => ({
        paxRefNumber: String(i + 1),
        passengerType: p.type === 'child' ? 2 : (p.type === 'infant' ? 3 : 1),
        gender: p.profile.gender,
        title: p.profile.title,
        firstName: p.profile.firstName,
        lastName: p.profile.lastName,
      }));
      const seatMap = await flight.getSeatMap(pricing.data.bookingContext, smPax);
      seat = pickOpenSeat(seatMap, meta);
    }

    if (!meal || !bag || !seat) {
      lastMiss = {
        ok: false,
        stage: 'ssr',
        route: `${origin}-${destination}`,
        days: onwardDays,
        missingSsr: { meal: !meal, baggage: !bag, seat: !seat, seatsAllowed: canSelectSeats(pricing.data) },
        priceId: pricing.data.priceId,
      };
      continue;
    }

    const lead = passengers.find((p) => p.isLead) || passengers[0];
    lead.ssr = { meals: [meal.item], baggage: [bag.item], seats: [seat.item] };

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: resolved.journeyType,
    });
    payload.data.passengers = passengers;
    payload.data.contact.email = `canary.ssr10.${Date.now()}.${nameLag}@travelvip.ai`;
    payload.data.passportType = pricing.data.passportType || 'NONE';
    applyGst(payload, pricing.data);

    const issue = await flight.issueTicketV2(payload);
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
    return {
      ok: Boolean(br),
      stage: br ? 'issued' : 'issue',
      br,
      route: `${origin}-${destination}`,
      days: onwardDays,
      journeyType: resolved.journeyType,
      adults: slot.adults,
      children: slot.children || 0,
      priceId: pricing.data.priceId,
      searchIds,
      issueHttp: issue.status,
      issueCode: issue.data?.error?.code || null,
      issueMsg: issue.data?.error?.message || null,
      duplicate: Boolean(issue.data?.duplicate),
      ssr: {
        mealCode: meal.item.code || null,
        bagCode: bag.item.code || null,
        seatName: seat.item.seatName || null,
        amount: (meal.amount || 0) + (bag.amount || 0) + (seat.amount || 0),
      },
      totalAmount: pricing.data.totalAmount ?? pricing.data.pricing?.totalAmount ?? null,
    };
  }
  return lastMiss || { ok: false, stage: 'ssr', route: `${origin}-${destination}`, days: onwardDays };
}

async function runSlot(flight, slot, nameBase) {
  const attempts = [];
  let nameLag = nameBase;
  let booked = null;

  outer: for (const r of slot.routes) {
    for (const day of r.days) {
      nameLag += 1;
      console.log(`  ${slot.id} try ${r.o}→${r.d} +${day}d pax=${slot.adults}ADT+${slot.children || 0}CHD`);
      let attempt;
      try {
        attempt = await attemptBook(flight, slot, r.o, r.d, day, nameLag);
      } catch (e) {
        attempt = { ok: false, stage: 'exception', error: String(e.message || e), route: `${r.o}-${r.d}`, days: day };
      }
      attempts.push(attempt);
      console.log(`    stage=${attempt.stage} br=${attempt.br || '-'} miss=${JSON.stringify(attempt.missingSsr || attempt.issueCode || attempt.error || '')}`);

      if (!attempt.br) continue;

      const st = await pollUntilSettled(flight, attempt.br);
      console.log(`    status=${st.classified} polls=${st.polls}`);
      attempt.classified = st.classified;
      attempt.statusRaw = st.status;

      if (st.classified === 'Confirmed') {
        booked = attempt;
        break outer;
      }
      if (st.classified === 'Inprogress') {
        nameLag += 1;
        const retryDay = day + 9;
        console.log(`    Inprogress → one retry +${retryDay}d`);
        let retry;
        try {
          retry = await attemptBook(flight, slot, r.o, r.d, retryDay, nameLag);
        } catch (e) {
          retry = { ok: false, stage: 'exception', error: String(e.message || e) };
        }
        attempts.push({ ...retry, priorInprogressBr: attempt.br });
        if (retry.br) {
          const st2 = await pollUntilSettled(flight, retry.br);
          retry.classified = st2.classified;
          retry.statusRaw = st2.status;
          console.log(`    retry status=${st2.classified}`);
          booked = retry;
        } else {
          booked = attempt;
        }
        break outer;
      }
      // Failed/Cancelled → try next date/route
    }
  }

  let verdict = 'NOT TESTED';
  if (booked?.br && booked.classified === 'Confirmed') verdict = 'PASS';
  else if (booked?.br && booked.classified === 'Inprogress') verdict = 'NOT TESTED';
  else if (booked?.br) verdict = 'BUG';
  else if (attempts.some((a) => a.issueCode === 'VALIDATION_ERROR')) verdict = 'BUG';
  else if (attempts.length && attempts.every((a) => a.stage === 'ssr' || a.stage === 'search' || a.stage === 'pricing')) {
    verdict = 'NOT TESTED';
  } else if (attempts.length) verdict = 'BUG';

  return {
    id: slot.id,
    journeyType: slot.journeyType,
    adults: slot.adults,
    children: slot.children || 0,
    verdict,
    br: booked?.br || null,
    status: booked?.classified || null,
    route: booked?.route || null,
    days: booked?.days || null,
    ssr: booked?.ssr || null,
    totalAmount: booked?.totalAmount || null,
    attempts: attempts.map((a) => ({
      stage: a.stage,
      br: a.br || null,
      route: a.route,
      days: a.days,
      missingSsr: a.missingSsr || null,
      issueCode: a.issueCode || null,
      classified: a.classified || null,
      error: a.error || null,
    })),
  };
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const rows = [];
  let nameBase = Math.floor(Date.now() % 900) + 100;

  console.log(`BASE_URL=${process.env.BASE_URL}`);
  console.log(`Target: ${TARGET} multipax OW/RT books with seat+meal+baggage SSR`);

  for (let i = 0; i < Math.min(TARGET, SLOTS.length); i += 1) {
    const slot = SLOTS[i];
    console.log(`\n=== [${i + 1}/${TARGET}] ${slot.id} ${slot.journeyType} ${slot.adults}ADT+${slot.children || 0}CHD ===`);
    const row = await runSlot(flight, slot, nameBase);
    nameBase += 25;
    rows.push(row);
    console.log(`[${row.verdict}] ${row.id} br=${row.br || '-'} ${row.status || ''} ${row.route || ''} ssr=${JSON.stringify(row.ssr || {})}`);
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    target: TARGET,
    requirement: '10 canary flights: OW + RT, multipax (2–3 ADT ± CHD), SSR seat+meal+baggage on lead',
    counts: {
      PASS: rows.filter((r) => r.verdict === 'PASS').length,
      BUG: rows.filter((r) => r.verdict === 'BUG').length,
      'NOT TESTED': rows.filter((r) => r.verdict === 'NOT TESTED').length,
      total: rows.length,
      confirmedBrs: rows.filter((r) => r.status === 'Confirmed').map((r) => r.br),
    },
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nReport: ${OUT}`);
  console.log(JSON.stringify(out.counts, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

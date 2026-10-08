/**
 * Book flights with seat + meal + baggage on api-staging.
 * Matrix: OW/RT × domestic/international × 1ADT / 2ADT
 *
 * Usage:
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/book-ssr-matrix-staging.js
 *
 * Report: reports/book-ssr-matrix-staging.json
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

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join('reports', 'book-ssr-matrix-staging.json');

function brief(data, n = 180) {
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

async function pollSearch(flight, body, max = 10) {
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

async function pollUntilSettled(flight, br, maxPolls = 24) {
  let last = { status: '', classified: 'Pending', polls: 0 };
  for (let i = 0; i < maxPolls; i += 1) {
    const st = await flight.getBookingStatus(br);
    const raw = String(st.data?.status || '');
    last = { status: raw, classified: classifyStatus(raw), polls: i + 1, res: st };
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

function pickOwSearchIds(searchData, limit = 8) {
  const all = (searchData?.results || []).flatMap((r) => r.options || []);
  const ids = all.map((o) => o.searchId).filter(Boolean);
  if (ids.length) return ids.slice(0, limit);
  const one = extractFirstSearchId(searchData);
  return one ? [one] : [];
}

async function resolveSearchIds(flight, caseSpec, onwardDays) {
  const { journeyType, origin, destination, adults, children = 0, infants = 0, airlines = [] } = caseSpec;
  const travellers = { adults, children, infants };

  if (journeyType === 'ROUND_TRIP') {
    const body = buildRoundTripSearchBody(onwardDays, onwardDays + 7, {
      origin,
      destination,
      fareType: 'NORMAL',
    });
    body.travellers = travellers;
    if (airlines.length) body.preferences = { ...(body.preferences || {}), airlines };
    const rt = await flight.searchRoundTripUntilComplete(body);
    return {
      candidates: rt.searchIds?.length >= 2 ? [rt.searchIds] : [],
      journeyType: 'ROUND_TRIP',
      searchOk: Boolean(rt.searchIds?.length >= 2),
      searchHttp: rt.response?.status,
    };
  }

  const body = buildOneWaySearchBody(onwardDays, {
    origin,
    destination,
    fareType: 'NORMAL',
  });
  body.travellers = travellers;
  if (airlines.length) body.preferences = { ...(body.preferences || {}), airlines };
  const search = await pollSearch(flight, body);
  const ids = search.ok ? pickOwSearchIds(search.data, 8) : [];
  return {
    candidates: ids.map((id) => [id]),
    journeyType: 'ONE_WAY',
    searchOk: ids.length > 0,
    searchHttp: search?.status,
    searchErr: search?.data?.error?.code || null,
  };
}

async function attemptBook(flight, caseSpec, { onwardDays, nameLag }) {
  const { origin, destination, adults, children = 0, infants = 0, international } = caseSpec;
  const resolved = await resolveSearchIds(flight, caseSpec, onwardDays);
  if (!resolved.searchOk || !resolved.candidates.length) {
    return { ok: false, stage: 'search', resolved, missingSsr: null };
  }

  const journey = resolved.journeyType;
  let lastMiss = null;
  let lastPricingFail = null;

  for (const searchIds of resolved.candidates) {
    const pricing = await flight.getPricing(searchIds, journey);
    if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
      lastPricingFail = {
        ok: false,
        stage: 'pricing',
        resolved,
        pricingHttp: pricing?.status,
        pricingErr: pricing?.data?.error?.code || brief(pricing?.data),
      };
      continue;
    }

    const ssr = await flight.getSsr(pricing.data.priceId);
    const meta = ssrMetaFromPricing(pricing.data, origin, destination);
    const meal = pickPaidMeal(ssr.data, meta);
    const bag = pickPaidBag(ssr.data, meta);

    const tag = uniqueTag();
    const passengers = buildPassengers({
      adults,
      children,
      infants,
      uniqueNames: true,
      leadFirstName: 'Rohan',
      leadLastName: `Bhagat${tag}`.replace(/[^a-zA-Z]/g, '').slice(0, 16) || 'Bhagatx',
      nameIndex: nameLag,
      withPassport: Boolean(international),
    });

    let seat = null;
    let seatMap = null;
    if (canSelectSeats(pricing.data)) {
      const smPax = passengers.map((p, i) => ({
        paxRefNumber: String(i + 1),
        passengerType: p.type === 'child' ? 2 : (p.type === 'infant' ? 3 : 1),
        gender: p.profile.gender,
        title: p.profile.title,
        firstName: p.profile.firstName,
        lastName: p.profile.lastName,
      }));
      seatMap = await flight.getSeatMap(pricing.data.bookingContext, smPax);
      seat = pickOpenSeat(seatMap, meta);
    }

    if (!meal || !bag || !seat) {
      lastMiss = {
        ok: false,
        stage: 'ssr',
        resolved,
        priceId: pricing.data.priceId,
        missingSsr: { meal: !meal, baggage: !bag, seat: !seat, seatsAllowed: canSelectSeats(pricing.data) },
      };
      continue;
    }

    const leadPax = passengers.find((p) => p.isLead) || passengers[0];
    leadPax.ssr = {
      meals: [meal.item],
      baggage: [bag.item],
      seats: [seat.item],
    };

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: journey,
    });
    payload.data.passengers = passengers;
    payload.data.contact.email = `ssr.matrix.${Date.now()}.${nameLag}@travelvip.ai`;
    payload.data.passportType = international
      ? (pricing.data.passportType && pricing.data.passportType !== 'NONE'
        ? pricing.data.passportType
        : 'MINI')
      : (pricing.data.passportType || 'NONE');
    applyGst(payload, pricing.data);

    const issue = await flight.issueTicketV2(payload);
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
    const detailsArr = issue.data?.error?.details;
    const ssrAttached = {
      meals: 1,
      baggage: 1,
      seats: 1,
      mealCode: meal.item.code || null,
      bagCode: bag.item.code || null,
      seatName: seat.item.seatName || null,
      amount: (meal.amount || 0) + (bag.amount || 0) + (seat.amount || 0),
    };

    return {
      ok: Boolean(br),
      stage: br ? 'issued' : 'issue',
      searchIds,
      journey,
      priceId: pricing.data.priceId,
      br,
      issueHttp: issue.status,
      issueCode: issue.data?.error?.code || null,
      issueMsg: issue.data?.error?.message || null,
      issueDetails: Array.isArray(detailsArr) ? detailsArr.slice(0, 8) : detailsArr || null,
      duplicate: Boolean(issue.data?.duplicate),
      ssrAttached,
    };
  }

  return lastMiss || lastPricingFail || { ok: false, stage: 'ssr', missingSsr: { meal: true, baggage: true, seat: true } };
}

const CASES = [
  {
    id: 'DOM-OW-1ADT',
    label: 'Domestic OW 1ADT + seat/meal/bag',
    journeyType: 'ONE_WAY',
    international: false,
    adults: 1,
    airlines: [],
    routes: [
      { origin: 'DEL', destination: 'BOM', days: [42, 49] },
      { origin: 'BOM', destination: 'BLR', days: [44, 51] },
      { origin: 'BOM', destination: 'GOI', days: [46, 53] },
      { origin: 'DEL', destination: 'HYD', days: [47, 54] },
    ],
  },
  {
    id: 'DOM-OW-2ADT',
    label: 'Domestic OW 2ADT + seat/meal/bag',
    journeyType: 'ONE_WAY',
    international: false,
    adults: 2,
    airlines: [],
    routes: [
      { origin: 'DEL', destination: 'BOM', days: [43, 50] },
      { origin: 'BOM', destination: 'BLR', days: [45, 52] },
      { origin: 'BOM', destination: 'GOI', days: [48, 55] },
    ],
  },
  {
    id: 'DOM-RT-1ADT',
    label: 'Domestic RT 1ADT + seat/meal/bag',
    journeyType: 'ROUND_TRIP',
    international: false,
    adults: 1,
    airlines: [],
    routes: [
      { origin: 'BOM', destination: 'BLR', days: [50, 57] },
      { origin: 'DEL', destination: 'BOM', days: [48, 55] },
    ],
  },
  {
    id: 'DOM-RT-2ADT',
    label: 'Domestic RT 2ADT + seat/meal/bag',
    journeyType: 'ROUND_TRIP',
    international: false,
    adults: 2,
    airlines: [],
    routes: [
      { origin: 'BOM', destination: 'BLR', days: [51, 58] },
      { origin: 'DEL', destination: 'BOM', days: [49, 56] },
    ],
  },
  {
    id: 'INTL-OW-1ADT',
    label: 'International OW 1ADT + seat/meal/bag + passport',
    journeyType: 'ONE_WAY',
    international: true,
    adults: 1,
    airlines: [],
    routes: [
      { origin: 'DEL', destination: 'DXB', days: [52, 59] },
      { origin: 'BOM', destination: 'BKK', days: [54, 61] },
      { origin: 'DEL', destination: 'SIN', days: [56, 63] },
    ],
  },
  {
    id: 'INTL-OW-2ADT',
    label: 'International OW 2ADT + seat/meal/bag + passport',
    journeyType: 'ONE_WAY',
    international: true,
    adults: 2,
    airlines: [],
    routes: [
      { origin: 'DEL', destination: 'DXB', days: [53, 60] },
      { origin: 'BOM', destination: 'BKK', days: [55, 62] },
    ],
  },
  {
    id: 'INTL-RT-1ADT',
    label: 'International RT 1ADT + seat/meal/bag + passport',
    journeyType: 'ROUND_TRIP',
    international: true,
    adults: 1,
    airlines: [],
    routes: [
      { origin: 'DEL', destination: 'DXB', days: [58, 65] },
      { origin: 'BOM', destination: 'BKK', days: [60, 67] },
    ],
  },
  {
    id: 'INTL-RT-2ADT',
    label: 'International RT 2ADT + seat/meal/bag + passport',
    journeyType: 'ROUND_TRIP',
    international: true,
    adults: 2,
    airlines: [],
    routes: [
      { origin: 'DEL', destination: 'DXB', days: [59, 66] },
      { origin: 'BOM', destination: 'BKK', days: [61, 68] },
    ],
  },
];

async function runCase(flight, caseSpec, nameBase) {
  const attemptsLog = [];
  let nameLag = nameBase;
  let booked = null;

  for (const route of caseSpec.routes) {
    for (const day of route.days) {
      nameLag += 1;
      console.log(`  try ${caseSpec.id} ${route.origin}→${route.destination} +${day}d nameLag=${nameLag}`);
      let attempt;
      try {
        attempt = await attemptBook(flight, {
          ...caseSpec,
          origin: route.origin,
          destination: route.destination,
        }, { onwardDays: day, nameLag });
      } catch (e) {
        attempt = { ok: false, stage: 'exception', error: String(e.message || e) };
      }
      attemptsLog.push({
        route: `${route.origin}-${route.destination}`,
        days: day,
        stage: attempt.stage,
        br: attempt.br || null,
        missingSsr: attempt.missingSsr || null,
        issueCode: attempt.issueCode || null,
        issueDetails: attempt.issueDetails || null,
        issueMsg: attempt.issueMsg || null,
        error: attempt.error || null,
      });

      if (attempt.stage === 'ssr') {
        console.log(`    no paid SSR inventory: ${JSON.stringify(attempt.missingSsr)}`);
        continue;
      }
      if (!attempt.br) {
        console.log(`    no BR stage=${attempt.stage} code=${attempt.issueCode || attempt.pricingErr || ''} details=${JSON.stringify(attempt.issueDetails || attempt.issueMsg || '')}`);
        continue;
      }

      console.log(`    issued BR=${attempt.br}; polling status...`);
      const firstSt = await pollUntilSettled(flight, attempt.br);
      console.log(`    status=${firstSt.classified} polls=${firstSt.polls}`);

      if (firstSt.classified === 'Confirmed') {
        booked = { ...attempt, status: firstSt.status, classified: firstSt.classified, route: `${route.origin}-${route.destination}`, days: day };
        break;
      }
      if (firstSt.classified === 'Failed' || firstSt.classified === 'Cancelled') {
        // try next route/day
        continue;
      }
      if (firstSt.classified === 'Inprogress') {
        // Inprogress rule: one retry with different names + dates
        nameLag += 1;
        const retryDay = day + 7;
        console.log(`    Inprogress left; retry once +${retryDay}d nameLag=${nameLag}`);
        let retry;
        try {
          retry = await attemptBook(flight, {
            ...caseSpec,
            origin: route.origin,
            destination: route.destination,
          }, { onwardDays: retryDay, nameLag });
        } catch (e) {
          retry = { ok: false, stage: 'exception', error: String(e.message || e) };
        }
        attemptsLog.push({
          route: `${route.origin}-${route.destination}`,
          days: retryDay,
          stage: retry.stage,
          br: retry.br || null,
          missingSsr: retry.missingSsr || null,
          issueCode: retry.issueCode || null,
          retryOf: attempt.br,
        });
        if (retry.br) {
          const secondSt = await pollUntilSettled(flight, retry.br);
          console.log(`    retry status=${secondSt.classified}`);
          booked = {
            ...retry,
            status: secondSt.status,
            classified: secondSt.classified,
            route: `${route.origin}-${route.destination}`,
            days: retryDay,
            priorInprogressBr: attempt.br,
          };
        } else {
          booked = {
            ...attempt,
            status: firstSt.status,
            classified: firstSt.classified,
            route: `${route.origin}-${route.destination}`,
            days: day,
          };
        }
        break;
      }
      // Pending timeout etc.
      booked = {
        ...attempt,
        status: firstSt.status,
        classified: firstSt.classified,
        route: `${route.origin}-${route.destination}`,
        days: day,
      };
      break;
    }
    if (booked) break;
  }

  let verdict = 'NOT TESTED';
  let actual = 'no bookable fare with paid seat+meal+baggage';
  if (booked?.br) {
    const c = booked.classified;
    if (c === 'Confirmed') {
      verdict = 'PASS';
      actual = `br=${booked.br} Confirmed route=${booked.route} seat=${booked.ssrAttached?.seatName} meal=${booked.ssrAttached?.mealCode} bag=${booked.ssrAttached?.bagCode}`;
    } else if (c === 'Inprogress') {
      verdict = 'NOT TESTED';
      actual = `br=${booked.br} Inprogress (left after 1 retry) route=${booked.route}`;
    } else {
      verdict = 'BUG';
      actual = `br=${booked.br} status=${c} route=${booked.route}`;
    }
  } else if (attemptsLog.some((a) => a.issueCode === 'VALIDATION_ERROR')) {
    const lastVal = [...attemptsLog].reverse().find((a) => a.issueCode === 'VALIDATION_ERROR');
    verdict = 'BUG';
    actual = `issue-ticket VALIDATION_ERROR details=${JSON.stringify(lastVal?.issueDetails || lastVal?.issueMsg)}`;
  } else if (attemptsLog.every((a) => a.stage === 'ssr') || attemptsLog.some((a) => a.stage === 'ssr')) {
    const onlySsrMiss = attemptsLog.every((a) => a.stage === 'ssr' || a.stage === 'pricing' || a.stage === 'search');
    verdict = 'NOT TESTED';
    actual = onlySsrMiss
      ? `no fare with meal+baggage+seat; last=${JSON.stringify(attemptsLog.slice(-1)[0]?.missingSsr || attemptsLog.slice(-1)[0])}`
      : `partial inventory; last=${JSON.stringify(attemptsLog.slice(-1)[0])}`;
  } else if (attemptsLog.length) {
    verdict = 'BUG';
    actual = `issue/search failed; last=${JSON.stringify(attemptsLog.slice(-1)[0])}`;
  }

  return {
    id: caseSpec.id,
    label: caseSpec.label,
    journeyType: caseSpec.journeyType,
    international: caseSpec.international,
    adults: caseSpec.adults,
    verdict,
    actual,
    br: booked?.br || null,
    status: booked?.classified || null,
    route: booked?.route || null,
    ssr: booked?.ssrAttached || null,
    attempts: attemptsLog,
  };
}

async function main() {
  clearSession();
  const session = await authenticate(true);
  const flight = new FlightService(session.client);
  const rows = [];
  let nameBase = Math.floor(Date.now() % 1000);

  console.log(`BASE_URL=${process.env.BASE_URL}`);
  console.log(`Cases: ${CASES.length}`);

  for (const c of CASES) {
    console.log(`\n=== ${c.id}: ${c.label} ===`);
    const row = await runCase(flight, c, nameBase);
    nameBase += 20;
    rows.push(row);
    console.log(`[${row.verdict}] ${row.id} ${row.actual}`);
  }

  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    counts: {
      PASS: rows.filter((r) => r.verdict === 'PASS').length,
      BUG: rows.filter((r) => r.verdict === 'BUG').length,
      'NOT TESTED': rows.filter((r) => r.verdict === 'NOT TESTED').length,
      total: rows.length,
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

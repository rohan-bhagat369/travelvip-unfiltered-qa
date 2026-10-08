/**
 * api-staging: multipax OW/RT books WITH ancillaries (seat+meal+baggage on each adult).
 * Cases: 2ADT, 3ADT, max adults (try 9 → step down).
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/book-ow-rt-multipax-ssr-staging.js
 *   ONLY_CASES=OW-2ADT,RT-2ADT node ...
 *
 * Report: reports/book-ow-rt-multipax-ssr-staging.json
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
import { config } from '../../../shared/config/env.js';
import { waitForVendorAlert } from './lib/mattermostVendorAlerts.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = path.join('reports', process.env.BOOK_REPORT || 'book-ow-rt-multipax-ssr-staging.json');
const MAX_ADULTS_TRY = Number(process.env.MAX_ADULTS || 9);
const NO_RETRY = process.env.NO_RETRY === '1';
const DAY_SHIFT = Number(process.env.DAY_SHIFT || 0);

function brief(data, n = 180) {
  return JSON.stringify(data || {}).slice(0, n);
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

async function pollUntilSettled(flight, br, maxPolls = 30) {
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

function pickOwIds(searchData, limit = 8) {
  const all = (searchData?.results || []).flatMap((r) => r.options || []);
  const ids = all.map((o) => o.searchId).filter(Boolean);
  if (ids.length) return ids.slice(0, limit);
  const one = extractFirstSearchId(searchData);
  return one ? [one] : [];
}

function isSeatSelectable(s) {
  const av = String(s.seatAvailability ?? s.availability ?? '').trim().toLowerCase();
  if (!av || av === 'false' || av === '0' || /occup|blocked|sold|closed|unavailable/i.test(av)) return false;
  return av === 'true' || av === '1' || /open|available|free/i.test(av);
}

function seatMapSegments(seatMapRes) {
  const data = seatMapRes?.data?.data || seatMapRes?.data || {};
  return data.segments || data.FlightSeat?.segments || [];
}

function pickOpenSeats(seatMapRes, meta, count) {
  const out = [];
  const used = new Set();
  for (const seg of seatMapSegments(seatMapRes)) {
    for (const s of seg.seatMap || seg.seats || []) {
      if (!isSeatSelectable(s)) continue;
      const seatName = s.seatName || s.seatNumber;
      const seatId = s.seatId || s.seatKey;
      const pref = s.priceReference || s.priceDetail?.priceReference;
      if (!seatName || !seatId || !pref) continue;
      const key = String(seatId);
      if (used.has(key)) continue;
      used.add(key);
      out.push({
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
        amount: Number(s.pricing?.totalAmount || s.amount || s.price || s.priceDetail?.totalAmount || 0),
      });
      if (out.length >= count) return out;
    }
  }
  return out;
}

function pickPaidMeals(ssrData, meta, count) {
  const out = [];
  for (const seg of ssrData?.meal?.segments || []) {
    for (const m of seg.Meals || seg.meals || []) {
      const pref = m.priceReference || m.pricing?.priceReference;
      const amt = Number(m.pricing?.totalAmount || m.amount || 0);
      if (!pref || amt <= 0) continue;
      out.push({
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
      });
      if (out.length >= count) return out;
    }
  }
  // reuse first meal if catalog has fewer unique rows than pax
  while (out.length && out.length < count) out.push({ ...out[0], item: { ...out[0].item } });
  return out;
}

function pickPaidBags(ssrData, meta, count) {
  const out = [];
  for (const seg of ssrData?.baggage?.segments || ssrData?.baggage?.Segments || []) {
    const o = seg.Origin || seg.origin || meta.origin;
    const d = seg.Destination || seg.destination || meta.destination;
    for (const b of seg.Baggage || seg.baggage || []) {
      const pref = b.priceReference || b.pricing?.priceReference;
      const amt = Number(b.pricing?.totalAmount || b.amount || 0);
      if (!pref || amt <= 0) continue;
      out.push({
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
      });
      if (out.length >= count) return out;
    }
  }
  while (out.length && out.length < count) out.push({ ...out[0], item: { ...out[0].item } });
  return out;
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

async function resolveCandidates(flight, journeyType, origin, destination, onwardDays, adults) {
  const travellers = { adults, children: 0, infants: 0 };
  if (journeyType === 'ROUND_TRIP') {
    const body = buildRoundTripSearchBody(onwardDays, onwardDays + 7, {
      origin,
      destination,
      fareType: 'NORMAL',
    });
    body.travellers = travellers;
    const rt = await flight.searchRoundTripUntilComplete(body);
    return {
      journeyType: 'ROUND_TRIP',
      candidates: rt.searchIds?.length >= 2 ? [rt.searchIds] : [],
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
  const search = await pollSearch(flight, body);
  const ids = search.ok ? pickOwIds(search.data, 8) : [];
  return {
    journeyType: 'ONE_WAY',
    candidates: ids.map((id) => [id]),
    searchOk: ids.length > 0,
    searchHttp: search?.status,
    searchCode: search?.data?.error?.code || null,
  };
}

function shiftDays(days) {
  return days.map((d) => d + DAY_SHIFT);
}

async function noteVendorAlert(attempt) {
  if (!attempt?.br || attempt.status === 'Confirmed') return attempt;
  console.log(`  Mattermost lookup ${attempt.br}...`);
  const alert = await waitForVendorAlert({
    bookingReference: attempt.br,
    timeoutMs: 20000,
    sinceMs: Date.now() - 30 * 60 * 1000,
  });
  attempt.mattermost = alert.found
    ? { found: true, message: alert.matches?.[0]?.message || '' }
    : { found: false, reason: alert.reason || alert.error || 'no match', sample: alert.latestSample || [] };
  if (alert.found) console.log('  MM', String(alert.matches[0].message || '').replace(/\s+/g, ' ').slice(0, 400));
  else console.log(`  MM no post for ${attempt.br}`);
  return attempt;
}

async function attemptBook(flight, {
  journeyType, adults, origin, destination, onwardDays, nameLag, international = false,
  leadFirstName = 'Rohan', leadLastName = null,
}) {
  const resolved = await resolveCandidates(flight, journeyType, origin, destination, onwardDays, adults);
  if (!resolved.searchOk || !resolved.candidates.length) {
    return {
      ok: false,
      stage: 'search',
      route: `${origin}-${destination}`,
      days: onwardDays,
      adults,
      searchHttp: resolved.searchHttp || null,
      searchCode: resolved.searchCode || null,
    };
  }

  let lastFail = null;
  for (const searchIds of resolved.candidates) {
    const pricing = await flight.getPricing(searchIds, resolved.journeyType);
    if (!pricing.ok || !pricing.data?.priceId || !pricing.data?.bookingContext) {
      lastFail = {
        ok: false,
        stage: 'pricing',
        pricingHttp: pricing?.status,
        pricingErr: pricing?.data?.error?.code || brief(pricing?.data),
      };
      continue;
    }

    const tag = uniqueTag();
    const leadLast = (leadLastName || `Bhagat${tag}`).replace(/[^a-zA-Z]/g, '').slice(0, 16) || 'Bhagatx';
    const passengers = buildPassengers({
      adults,
      children: 0,
      infants: 0,
      uniqueNames: true,
      leadFirstName,
      leadLastName: leadLast,
      nameIndex: nameLag,
      withPassport: Boolean(international),
    });
    const paxNames = passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`);
    console.log('    pax', paxNames.join(' | '));

    const ssr = await flight.getSsr(pricing.data.priceId);
    const meta = ssrMetaFromPricing(pricing.data, origin, destination);
    const meals = pickPaidMeals(ssr.data, meta, adults);
    const bags = pickPaidBags(ssr.data, meta, adults);
    let seats = [];
    if (canSelectSeats(pricing.data)) {
      const smPax = passengers.map((p, i) => ({
        paxRefNumber: String(i + 1),
        passengerType: 1,
        gender: p.profile.gender,
        title: p.profile.title,
        firstName: p.profile.firstName,
        lastName: p.profile.lastName,
      }));
      const seatMap = await flight.getSeatMap(pricing.data.bookingContext, smPax);
      seats = pickOpenSeats(seatMap, meta, adults);
    }

    if (meals.length < adults || bags.length < adults || seats.length < adults) {
      lastFail = {
        ok: false,
        stage: 'ssr',
        missingSsr: {
          meals: meals.length,
          bags: bags.length,
          seats: seats.length,
          need: adults,
          seatsAllowed: canSelectSeats(pricing.data),
        },
        priceId: pricing.data.priceId,
      };
      continue;
    }

    const adultsOnly = passengers.filter((p) => p.type === 'adult');
    let ssrAmount = 0;
    const seatNames = [];
    adultsOnly.forEach((pax, i) => {
      pax.ssr = {
        meals: [meals[i].item],
        baggage: [bags[i].item],
        seats: [seats[i].item],
      };
      ssrAmount += (meals[i].amount || 0) + (bags[i].amount || 0) + (seats[i].amount || 0);
      seatNames.push(seats[i].item.seatName);
    });

    const payload = buildIssueTicketPayload({
      bookingContext: pricing.data.bookingContext,
      priceId: pricing.data.priceId,
      searchIds,
      journeyType: resolved.journeyType,
    });
    payload.data.passengers = passengers;
    payload.data.contact.email = `mpaxssr.${adults}a.${Date.now()}.${nameLag}@travelvip.ai`;
    payload.data.passportType = international
      ? (pricing.data.passportType && pricing.data.passportType !== 'NONE'
        ? pricing.data.passportType
        : 'MINI')
      : (pricing.data.passportType || 'NONE');
    applyGst(payload, pricing.data);

    const issue = await flight.issueTicketV2(payload);
    const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
    if (!br) {
      const issueCode = issue.data?.error?.code || null;
      lastFail = {
        ok: false,
        stage: 'issue',
        issueHttp: issue.status,
        issueCode,
        issueMsg: issue.data?.error?.message || null,
        issueDetails: issue.data?.error?.details || null,
      };
      if (issueCode === 'INSUFFICIENT_BALANCE') {
        console.log('STOP INSUFFICIENT_BALANCE', issue.data?.error?.details || issue.data?.error?.message || '');
        return { ...lastFail, stop: true };
      }
      if (NO_RETRY) return lastFail;
      continue;
    }

    const settled = await pollUntilSettled(flight, br);
    return {
      ok: true,
      stage: 'booked',
      br,
      status: settled.classified,
      rawStatus: settled.status,
      polls: settled.polls,
      route: `${origin}-${destination}`,
      days: onwardDays,
      journeyType: resolved.journeyType,
      adults,
      passengers: passengers.map((p) => `${p.profile.firstName} ${p.profile.lastName}`),
      priceId: pricing.data.priceId,
      searchIds,
      ssrAttached: {
        adults,
        meals: adults,
        baggage: adults,
        seats: adults,
        seatNames,
        amount: ssrAmount,
      },
      pricingTotal: pricing.data?.totalAmount ?? pricing.data?.pricing?.totalAmount ?? null,
      issueHttp: issue.status,
      duplicate: Boolean(issue.data?.duplicate),
    };
  }

  return lastFail || { ok: false, stage: 'unknown' };
}

async function discoverMaxAdults(flight) {
  for (let n = MAX_ADULTS_TRY; n >= 4; n -= 1) {
    console.log(`  probing max adults=${n} search BOM→BLR...`);
    const resolved = await resolveCandidates(flight, 'ONE_WAY', 'BOM', 'BLR', 40, n);
    if (resolved.searchOk) {
      console.log(`  max adults that return inventory: ${n}`);
      return n;
    }
    console.log(`    no inventory http=${resolved.searchHttp || '-'} code=${resolved.searchCode || '-'}`);
  }
  return 4;
}

const ONLY = (process.env.ONLY_CASES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function buildCases(maxAdults) {
  const four = [
    {
      id: 'OW-DOM-2',
      label: 'OW domestic 2ADT + seat/meal/bag',
      journeyType: 'ONE_WAY',
      adults: 2,
      international: false,
      leadFirstName: 'Ishaan',
      leadLastName: 'Grewal',
      nameIndex: 4,
      routes: [
        { origin: 'BOM', destination: 'GOI', days: shiftDays([80, 87]) },
        { origin: 'BOM', destination: 'BLR', days: shiftDays([82, 89]) },
      ],
    },
    {
      id: 'OW-INTL-2',
      label: 'OW international 2ADT + seat/meal/bag',
      journeyType: 'ONE_WAY',
      adults: 2,
      international: true,
      leadFirstName: 'Kabir',
      leadLastName: 'Sethi',
      nameIndex: 6,
      routes: [
        { origin: 'DEL', destination: 'DXB', days: shiftDays([81, 88]) },
        { origin: 'BOM', destination: 'BKK', days: shiftDays([83, 90]) },
        { origin: 'DEL', destination: 'SIN', days: shiftDays([85, 92]) },
      ],
    },
    {
      id: 'RT-DOM-2',
      label: 'RT domestic 2ADT + seat/meal/bag',
      journeyType: 'ROUND_TRIP',
      adults: 2,
      international: false,
      leadFirstName: 'Vihaan',
      leadLastName: 'Kapoor',
      nameIndex: 8,
      routes: [
        { origin: 'BOM', destination: 'BLR', days: shiftDays([84, 91]) },
        { origin: 'BOM', destination: 'GOI', days: shiftDays([86, 93]) },
      ],
    },
    {
      id: 'RT-INTL-2',
      label: 'RT international 2ADT + seat/meal/bag',
      journeyType: 'ROUND_TRIP',
      adults: 2,
      international: true,
      leadFirstName: 'Ayaan',
      leadLastName: 'Mehra',
      nameIndex: 2,
      routes: [
        { origin: 'DEL', destination: 'DXB', days: shiftDays([88, 95]) },
        { origin: 'BOM', destination: 'BKK', days: shiftDays([90, 97]) },
      ],
    },
  ];

  const all = [
    {
      id: 'OW-2ADT',
      label: 'OW 2ADT + seat/meal/bag each',
      journeyType: 'ONE_WAY',
      adults: 2,
      routes: [
        { origin: 'BOM', destination: 'BLR', days: [34, 41] },
        { origin: 'BOM', destination: 'GOI', days: [36, 43] },
        { origin: 'DEL', destination: 'HYD', days: [38, 45] },
      ],
    },
    {
      id: 'OW-3ADT',
      label: 'OW 3ADT + seat/meal/bag each',
      journeyType: 'ONE_WAY',
      adults: 3,
      routes: [
        { origin: 'BOM', destination: 'BLR', days: [35, 42] },
        { origin: 'BOM', destination: 'GOI', days: [37, 44] },
        { origin: 'DEL', destination: 'HYD', days: [39, 46] },
      ],
    },
    {
      id: `OW-${maxAdults}ADT-MAX`,
      label: `OW ${maxAdults}ADT (max) + seat/meal/bag each`,
      journeyType: 'ONE_WAY',
      adults: maxAdults,
      routes: [
        { origin: 'BOM', destination: 'BLR', days: [40, 47] },
        { origin: 'BOM', destination: 'GOI', days: [42, 49] },
        { origin: 'DEL', destination: 'BOM', days: [44, 51] },
      ],
    },
    {
      id: 'RT-2ADT',
      label: 'RT 2ADT + seat/meal/bag each',
      journeyType: 'ROUND_TRIP',
      adults: 2,
      routes: [
        { origin: 'BOM', destination: 'BLR', days: [46, 53] },
        { origin: 'BOM', destination: 'GOI', days: [48, 55] },
      ],
    },
    {
      id: 'RT-3ADT',
      label: 'RT 3ADT + seat/meal/bag each',
      journeyType: 'ROUND_TRIP',
      adults: 3,
      routes: [
        { origin: 'BOM', destination: 'BLR', days: [47, 54] },
        { origin: 'BOM', destination: 'GOI', days: [49, 56] },
      ],
    },
    {
      id: `RT-${maxAdults}ADT-MAX`,
      label: `RT ${maxAdults}ADT (max) + seat/meal/bag each`,
      journeyType: 'ROUND_TRIP',
      adults: maxAdults,
      routes: [
        { origin: 'BOM', destination: 'BLR', days: [50, 57] },
        { origin: 'BOM', destination: 'GOI', days: [52, 59] },
      ],
    },
  ];
  const pool = [...four, ...all];
  return ONLY.length ? pool.filter((c) => ONLY.includes(c.id)) : all;
}

async function runCase(flight, caseSpec, nameBase) {
  const attempts = [];
  let nameLag = nameBase;

  async function tryRoutes(tag) {
    for (const route of caseSpec.routes) {
      for (const day of route.days) {
        nameLag += 1;
        console.log(`  [${tag}] ${caseSpec.id} ${route.origin}→${route.destination} +${day}d adults=${caseSpec.adults}`);
        let attempt;
        try {
          attempt = await attemptBook(flight, {
            journeyType: caseSpec.journeyType,
            adults: caseSpec.adults,
            origin: route.origin,
            destination: route.destination,
            onwardDays: day,
            nameLag: caseSpec.nameIndex ?? nameLag,
            leadFirstName: caseSpec.leadFirstName,
            leadLastName: caseSpec.leadLastName,
            international: Boolean(caseSpec.international),
          });
        } catch (e) {
          attempt = { ok: false, stage: 'exception', error: String(e.message || e) };
        }
        attempts.push({ tag, ...attempt });
        if (attempt.stop) return attempt;
        if (attempt.ok && attempt.br && attempt.status === 'Confirmed') return attempt;
        if (NO_RETRY && attempt.br) {
          await noteVendorAlert(attempt);
          return attempt;
        }
        if (NO_RETRY && attempt.stage === 'issue') return attempt;
        if (attempt.ok && attempt.br && attempt.status === 'Inprogress') return attempt;
        console.log(
          `    -> ${attempt.stage} ${attempt.status || ''} ${attempt.br || ''} ${attempt.missingSsr ? JSON.stringify(attempt.missingSsr) : ''} ${attempt.issueCode || ''}`,
        );
      }
    }
    return [...attempts].reverse().find((a) => a.tag === tag && a.br) || null;
  }

  let first = await tryRoutes('try1');
  let retry = null;
  if (first?.stop) {
    console.log(`  ${caseSpec.id} stopped — insufficient balance`);
  } else if (NO_RETRY) {
    console.log(`  ${caseSpec.id} no retry (${first?.status || first?.stage || 'no book'})`);
  } else if (first && (first.status === 'Inprogress' || first.status === 'Failed')) {
    console.log(`  ${caseSpec.id} ${first.status} ${first.br} — retry once`);
    for (const r of caseSpec.routes) r.days = r.days.map((d) => d + 12);
    retry = await tryRoutes('retry');
  } else if (!first) {
    console.log(`  ${caseSpec.id} no book — retry +12d`);
    for (const r of caseSpec.routes) r.days = r.days.map((d) => d + 12);
    retry = await tryRoutes('retry');
  }

  const final = (retry?.status === 'Confirmed' ? retry : null)
    || (first?.status === 'Confirmed' ? first : null)
    || retry
    || first;

  return {
    id: caseSpec.id,
    label: caseSpec.label,
    journeyType: caseSpec.journeyType,
    adults: caseSpec.adults,
    br: final?.br || null,
    status: final?.status || null,
    passengers: final?.passengers || null,
    mattermost: final?.mattermost || null,
    route: final?.route || null,
    days: final?.days || null,
    ssrAttached: final?.ssrAttached || null,
    pricingTotal: final?.pricingTotal ?? null,
    attempts,
    result:
      !final ? 'NOT TESTED'
        : final.status === 'Confirmed' ? 'PASS'
          : final.status === 'Inprogress' ? 'NOT TESTED'
            : final.status === 'Failed' ? 'BUG'
              : 'NOT TESTED',
  };
}

async function main() {
  clearSession();
  console.log('BASE', config.baseUrl || process.env.BASE_URL);
  const session = await authenticate(true);
  const flight = new FlightService(session.client);

  const maxAdults = ONLY.length ? 2 : await discoverMaxAdults(flight);
  const cases = buildCases(maxAdults);
  console.log('CASES', cases.map((c) => `${c.id}(${c.adults}A)`).join(', '));

  const rows = [];
  let nameBase = 300;
  for (const c of cases) {
    console.log(`\n=== ${c.id}: ${c.label} ===`);
    const row = await runCase(flight, c, nameBase);
    nameBase += 60;
    rows.push(row);
    if (row.attempts?.some((a) => a.issueCode === 'INSUFFICIENT_BALANCE' || a.stop)) {
      console.log('Aborting remaining cases — wallet balance is not enough.');
      break;
    }
    console.log(`=> ${row.id} ${row.result} BR=${row.br || '-'} status=${row.status || '-'} route=${row.route || '-'}`);
  }

  const summary = rows.reduce((acc, r) => {
    acc[r.result] = (acc[r.result] || 0) + 1;
    return acc;
  }, {});
  const report = {
    baseUrl: config.baseUrl || process.env.BASE_URL,
    at: new Date().toISOString(),
    maxAdults,
    summary,
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSUMMARY', summary);
  console.log('WROTE', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

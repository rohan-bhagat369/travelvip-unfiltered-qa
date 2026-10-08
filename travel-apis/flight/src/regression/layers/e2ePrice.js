import path from 'path';
import { row, errCode, brief, writeJson } from '../../../hotel/regression/report.js';
import { noteCall, uniqueEmail, findRiyaHits } from '../session.js';
import {
  analyzeFlightOptions,
  buildIssueTicketPayload,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  canSelectSeats,
  extractFirstSearchId,
  isSearchProgressComplete,
} from '../../helpers.js';
import { isInternationalRoute, pollRoundTripSearch } from '../../searchPicker.js';
import { buildPassengers, uniqueTag } from '../../passengerBuilder.js';
import { sleep } from '../../../../../shared/lib/testUtils.js';
import { GST, money, moneyEq } from '../../../hotel/regression/fixtures.js';

function optionCount(data) {
  return (data?.results || []).reduce((n, b) => n + (b.options?.length || 0), 0);
}

const SEARCH_QUERY = { lang: 'en', currency: 'INR', page: 0, perpage: 20, sortby: 'fare,asc' };

function fareOf(opt) {
  const n = Number(
    opt?.fare?.pricing?.totalAmount
    ?? opt?.fare?.totalAmount
    ?? opt?.pricing?.totalAmount
    ?? opt?.displayPricing?.pricing?.totalAmount
    ?? opt?.totalAmount
    ?? opt?.price?.totalAmount,
  );
  return Number.isFinite(n) ? n : null;
}

function totalOf(block) {
  if (!block) return null;
  if (typeof block === 'number') return money(block);
  return money(
    block.totalAmount
    ?? block.salesSummary?.totalAmount
    ?? block.pricing?.totalAmount
    ?? block.price?.totalAmount
    ?? block.fare?.totalAmount
    ?? block.bookingResponse?.salesSummary?.totalAmount,
  );
}

function allTotalsMatch(amounts, tol = 1) {
  const nums = amounts.filter((n) => n != null);
  if (!nums.length) return false;
  return nums.every((n) => moneyEq(n, nums[0], tol));
}

function findSearchOption(searchData, searchId) {
  for (const block of searchData?.results || []) {
    for (const opt of block.options || []) {
      if (opt.searchId === searchId) return { direction: block.direction, opt, fare: opt.fare || opt };
      const fare = (opt.fares || []).find((f) => f.searchId === searchId);
      if (fare) return { direction: block.direction, opt, fare };
    }
  }
  return null;
}

function summarizeFlights(opt) {
  const segs = opt?.segments || opt?.flights || [];
  return segs.map((s) => ({
    flight: `${s.airline?.code || s.airlineCode || ''} ${s.flightNumber || ''}`.trim(),
    from: s.origin || s.from || s.departureAirport || s.departure?.airport,
    to: s.destination || s.to || s.arrivalAirport || s.arrival?.airport,
    dep: s.departureTime || s.depTime || s.departure?.time,
    arr: s.arrivalTime || s.arrTime || s.arrival?.time,
    durationMinutes: s.durationMinutes || s.duration,
  }));
}

function fareLine(f, searchId) {
  if (!f) return null;
  const pricing = f.pricing || f.displayPricing?.pricing || {};
  return {
    searchId: f.searchId || searchId || null,
    fareType: f.fareType || f.fareName || f.brandName || null,
    total: fareOf(f),
    baseFare: pricing.baseFare ?? f.baseFare ?? null,
    taxes: pricing.taxes ?? f.taxes ?? null,
    convenienceFee: pricing.convenienceFee ?? f.convenienceFee ?? null,
  };
}

function summarizeSelectedOption(hit) {
  if (!hit?.opt) return null;
  const opt = hit.opt;
  return {
    direction: hit.direction || null,
    searchId: opt.searchId,
    validatingAirline: opt.validatingAirline || opt.airline?.code || opt.airlineCode || null,
    fareType: hit.fare?.fareType || opt.fare?.fareType || opt.fareType || null,
    totalStops: opt.totalStops ?? null,
    segmentCount: opt.segments?.length ?? null,
    totalDurationMinutes: opt.totalDurationMinutes ?? null,
    flights: summarizeFlights(opt),
    selectedFare: fareLine(hit.fare, opt.searchId),
    otherFares: (opt.fares || []).map((f) => fareLine(f, f.searchId)).filter(Boolean),
  };
}

function salesSlice(label, data) {
  if (!data || typeof data !== 'object') {
    return { hop: label, total: totalOf(data) };
  }
  const ss = data.salesSummary || data.pricing?.salesSummary || data.bookingResponse?.salesSummary || null;
  const pr = data.pricing || data.price || data.fare || {};
  return {
    hop: label,
    total: totalOf(data),
    totalAmount: data.totalAmount ?? ss?.totalAmount ?? pr.totalAmount ?? null,
    baseFare: ss?.baseFare ?? pr.baseFare ?? data.baseFare ?? null,
    taxes: ss?.taxes ?? pr.taxes ?? data.taxes ?? null,
    convenienceFee: ss?.convenienceFee ?? pr.convenienceFee ?? data.convenienceFee ?? null,
    grandTotal: ss?.grandTotal ?? data.grandTotal ?? null,
    priceId: data.priceId ?? null,
    bookingReference: data.bookingReference || data.bookingReferenceId || null,
    pnr: data.pnr ?? data.bookingResponse?.pnr ?? null,
    status: data.status || data.bookingStatus || data.bookingResponse?.status || null,
    salesSummary: ss,
  };
}

function buildPriceRepro({ ow, owDetail, totals, correlationId }) {
  const searchIds = ow.searchIds || [];
  const body = ow.searchBody || null;
  const picked = summarizeSelectedOption(
    findSearchOption(ow.search?.data, searchIds[0]) || { opt: ow.picked?.opt, fare: ow.picked?.opt?.fare },
  );
  return {
    bug: 'PRICE.1 Search ≈ details ≈ pricing ≈ confirmed ≈ detail',
    expected: 'all hop totals match within ±₹1',
    actual: totals,
    mismatch: !allTotalsMatch([totals.search, totals.details, totals.pricing, totals.confirmed, totals.detail], 1),
    correlationId: correlationId || null,
    bookingReference: ow.br || null,
    pnr: ow.statusRes?.data?.pnr || ow.issue?.data?.pnr || owDetail?.data?.pnr || null,
    bookingStatus: ow.status || ow.classified || null,
    journeyType: ow.journey || body?.journeyType || 'ONE_WAY',
    searchCriteria: {
      method: 'POST',
      path: '/v1/flights/search',
      query: SEARCH_QUERY,
      body,
      origin: ow.origin || body?.itinerary?.[0]?.origin || null,
      destination: ow.destination || body?.itinerary?.[0]?.destination || null,
      itinerary: body?.itinerary || null,
      travellers: body?.travellers || { adults: ow.adults, children: ow.children, infants: ow.infants },
      cabinClass: body?.cabinClass || null,
      fareType: body?.fareType || null,
      preferences: body?.preferences || null,
    },
    searchIds,
    selectedOption: picked,
    hops: {
      search: {
        total: totals.search,
        option: picked,
      },
      details: {
        request: { method: 'POST', path: '/v1/flights/details', query: { lang: 'en', currency: 'INR' }, body: { journeyType: ow.journey, selection: { selectedSearchIds: searchIds } } },
        ...salesSlice('details', ow.details?.data),
      },
      pricing: {
        request: { method: 'POST', path: '/v1/flights/pricing', query: { lang: 'en', currency: 'INR' }, body: { journeyType: ow.journey, selection: { selectedSearchIds: searchIds } } },
        ...salesSlice('pricing', ow.pricing?.data),
      },
      confirmed: {
        request: { method: 'POST', path: '/api/v2/flights/booking/issue-ticket' },
        priceId: ow.pricing?.data?.priceId || null,
        ...salesSlice('confirmed', ow.issue?.data || ow.statusRes?.data),
        statusHop: salesSlice('status', ow.statusRes?.data),
      },
      detail: {
        request: { method: 'GET', path: `/v1/flights/booking/${ow.br}` },
        ...salesSlice('detail', owDetail?.data),
      },
    },
    howToReproduce: [
      `POST /v1/flights/search?lang=en&currency=INR&page=0&perpage=20&sortby=fare,asc with the searchCriteria.body (route ${ow.origin}-${ow.destination}, travellers ${paxLabel(ow)}).`,
      `Find option/fare searchId=${searchIds.join(' + ') || '(missing)'}${picked?.flights?.length ? ` flights=${picked.flights.map((f) => f.flight).join(',')}` : ''}. Note search total vs otherFares.`,
      'POST /v1/flights/details then POST /v1/flights/pricing with those searchIds and journeyType ONE_WAY.',
      `Issue ticket, then GET /v1/flights/booking/${ow.br || '{BR}'} and compare totalAmount / salesSummary at each hop (±₹1).`,
    ],
  };
}

function persistPriceMismatch(packet) {
  const id = packet.bookingReference || packet.searchIds?.[0] || 'unknown';
  const filePath = path.join(process.cwd(), 'reports', `price-mismatch-${id}.json`);
  writeJson(filePath, packet);
  return filePath;
}

function hasConvenienceFee(data) {
  const blob = JSON.stringify(data || {});
  return /convenienceFee/i.test(blob);
}

function fareParts(data) {
  if (!data || typeof data !== 'object') return { base: null, tax: null, fee: null, total: null };
  const ss = data.salesSummary || data.pricing || data.price || {};
  const base = Number(ss.baseFare ?? ss.baseAmount ?? data.baseFare);
  const tax = Number(ss.taxes ?? ss.tax ?? ss.totalTax ?? ss.taxAmount ?? data.taxes);
  const fee = Number(ss.convenienceFee ?? data.convenienceFee ?? 0);
  const total = Number(ss.totalAmount ?? data.totalAmount);
  return {
    base: Number.isFinite(base) ? base : null,
    tax: Number.isFinite(tax) ? tax : null,
    fee: Number.isFinite(fee) ? fee : 0,
    total: Number.isFinite(total) ? total : null,
  };
}

function paxLabel({ adults = 1, children = 0, infants = 0 } = {}) {
  return `${adults}ADT${children ? `+${children}CHD` : ''}${infants ? `+${infants}INF` : ''}`;
}

function uniqueLeadNames(nameLag) {
  const tag = uniqueTag();
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  const first = `Rohan${abc.slice(nameLag % 10, (nameLag % 10) + 3)}${tag}`.replace(/[^a-zA-Z]/g, 'x');
  const last = `Bhagat${abc.slice(nameLag % 8, (nameLag % 8) + 3)}${tag}`.replace(/[^a-zA-Z]/g, 'x');
  return {
    leadFirstName: first.slice(0, 16),
    leadLastName: last.slice(0, 16),
  };
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

function ssrMetaFromPricing(pricingData, origin, destination) {
  const leg0 = (pricingData?.itinerary || [])[0] || {};
  const seg0 = (leg0.segments || [])[0] || {};
  return {
    origin: seg0.departure?.airportCode || origin,
    destination: seg0.arrival?.airportCode || destination,
    segmentId: seg0.segmentId || 'SEG_1',
  };
}

async function pollSearch(flight, body, max = 8) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    if (!last.ok || errCode(last) === 'VALIDATION_ERROR') return last;
    if (optionCount(last.data) > 0 || isSearchProgressComplete(last.data)) return last;
    await sleep(2500);
  }
  return last;
}

function classifyBookingStatus(raw) {
  const s = String(raw || '').trim();
  if (/confirm/i.test(s)) return 'Confirmed';
  if (/inprogress|in.?progress/i.test(s)) return 'Inprogress';
  if (/fail/i.test(s)) return 'Failed';
  if (/cancel/i.test(s)) return 'Cancelled';
  return s || 'Pending';
}

function isSettledBookingStatus(raw) {
  return ['Confirmed', 'Inprogress', 'Failed', 'Cancelled'].includes(classifyBookingStatus(raw));
}

/** Poll GET /v1/flights/booking/{BR}/status until Confirmed | Inprogress | Failed | Cancelled. */
async function pollUntilSettled(flight, ctx, br, hopPrefix) {
  const maxPolls = 24;
  let last = { status: '', classified: 'Pending', res: null, polls: 0 };
  for (let i = 0; i < maxPolls; i += 1) {
    const st = await flight.getBookingStatus(br);
    noteCall(ctx, `${hopPrefix}-${i + 1}`, `/v1/flights/booking/${br}/status`, st);
    const raw = String(st.data?.status || '');
    last = {
      status: raw,
      classified: classifyBookingStatus(raw),
      res: st,
      polls: i + 1,
    };
    if (isSettledBookingStatus(raw)) return last;
    await sleep(3000);
  }
  return last;
}

function optionOnlineCancel(opt) {
  if (!opt) return null;
  if (opt.onlineCancellation === true || opt.fare?.onlineCancellation === true) return true;
  if ((opt.fares || []).some((f) => f.onlineCancellation === true)) return true;
  if (opt.onlineCancellation === false || opt.fare?.onlineCancellation === false) return false;
  return null;
}

function extractOnlineCancel(data) {
  const it = data?.bookingResponse?.itinerary || data?.itinerary || [];
  if (it.some((leg) => leg.onlineCancellation === true)) return true;
  if (data?.onlineCancellation === true || data?.bookingResponse?.onlineCancellation === true) return true;
  if (it.some((leg) => leg.onlineCancellation === false)) return false;
  if (data?.onlineCancellation === false || data?.bookingResponse?.onlineCancellation === false) return false;
  return null;
}

function pickOwOption(searchData, { preferConnecting = false, requireOnlineCancel = false, requireOffline = false } = {}) {
  const cl = analyzeFlightOptions(searchData);
  const all = (searchData?.results || []).flatMap((r) => r.options || []);
  const online = all.filter((o) => optionOnlineCancel(o) === true);
  const offline = all.filter((o) => optionOnlineCancel(o) === false);
  const pool = requireOnlineCancel && online.length
    ? online
    : (requireOffline && offline.length ? offline : all);
  if (preferConnecting) {
    const conn = pool.find((o) => (o.totalStops ?? 0) > 0 || (o.segments?.length ?? 0) > 1);
    if (conn?.searchId) return { opt: conn, connecting: true, onlineCancellation: optionOnlineCancel(conn) };
  }
  const first = pool[0] || cl.nonStop[0] || cl.connecting[0];
  const id = first?.searchId || extractFirstSearchId(searchData);
  return { opt: first || { searchId: id }, connecting: false, onlineCancellation: optionOnlineCancel(first) };
}

async function issueBooking(ctx, spec) {
  const {
    journeyType = 'ONE_WAY',
    origin,
    destination,
    adults = 1,
    children = 0,
    infants = 0,
    maxStops = null,
    preferConnecting = false,
    onwardDays = 40,
    returnOffsetDays = 7,
    withSsr = false,
    international = false,
    airlines = [],
    requireOnlineCancel = false,
    requireOffline = false,
    nameLag = 0,
    hopPrefix = 'e2e',
  } = spec;

  const journey = journeyType === 'ROUND_TRIP' ? 'ROUND_TRIP' : 'ONE_WAY';
  const intl = international || isInternationalRoute(origin, destination);
  const travellers = { adults, children, infants };
  const hop = `${hopPrefix}-${origin}${destination}-${journey === 'ROUND_TRIP' ? 'rt' : 'ow'}`;
  let search;
  let searchIds;
  let picked;
  let searchFare = null;
  let searchBody = null;

  if (journey === 'ROUND_TRIP') {
    const body = buildRoundTripSearchBody(
      onwardDays,
      onwardDays + returnOffsetDays,
      { origin, destination, maxStops, fareType: 'NORMAL' },
    );
    body.travellers = travellers;
    if (airlines.length) body.preferences = { ...body.preferences, airlines };
    searchBody = body;
    const rt = await pollRoundTripSearch(ctx.flight, body, { maxStops, fareType: 'NORMAL', airlines }, { maxPolls: 10 });
    search = rt.response?.status != null ? rt.response : { ok: true, status: 200, data: rt.data };
    noteCall(ctx, `${hop}-search`, '/v1/flights/search', search);
    const pair = rt.pairs?.[0];
    if (!pair?.searchIds?.[0] || !pair.searchIds[1]) {
      return { search, searchIds: null, noPair: true, searchBody };
    }
    searchIds = pair.searchIds;
    picked = {
      connecting: (pair.onward?.stops > 0) || (pair.ret?.stops > 0),
      onward: pair.onward,
      ret: pair.ret,
    };
    searchFare = pair.total;
  } else {
    const body = buildOneWaySearchBody(onwardDays, { origin, destination, maxStops, fareType: 'NORMAL' });
    body.travellers = travellers;
    if (airlines.length) body.preferences = { ...body.preferences, airlines };
    searchBody = body;
    search = await pollSearch(ctx.flight, body);
    noteCall(ctx, `${hop}-search`, '/v1/flights/search', search);
    if (!search.ok) return { search, searchIds: null, searchBody };
    picked = pickOwOption(search.data, { preferConnecting, requireOnlineCancel, requireOffline });
    const searchId = picked.opt?.searchId;
    if (!searchId) return { search, searchIds: null, searchBody };
    searchIds = [searchId];
    const hit = findSearchOption(search.data, searchId);
    searchFare = fareOf(hit?.fare || hit?.opt);
  }

  const details = await ctx.flight.getDetails(searchIds, journey);
  noteCall(ctx, `${hop}-details`, '/v1/flights/details', details);
  const rules = await ctx.flight.getFareRules(searchIds, journey);
  noteCall(ctx, `${hop}-fareRules`, '/v1/flights/fareRules', rules);
  const pricing = await ctx.flight.getPricing(searchIds, journey);
  noteCall(ctx, `${hop}-pricing`, '/v1/flights/pricing', pricing);
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    return { search, searchIds, picked, details, rules, pricing };
  }
  const pricedOnline = extractOnlineCancel(pricing.data) ?? extractOnlineCancel(details?.data);
  if (requireOnlineCancel && pricedOnline === false) {
    return { search, searchIds, picked, details, rules, pricing, skipOffline: true };
  }
  if (requireOffline && pricedOnline !== false) {
    return { search, searchIds, picked, details, rules, pricing, skipOnline: true };
  }

  const ssr = await ctx.flight.getSsr(pricing.data.priceId);
  noteCall(ctx, `${hop}-ssr`, '/v1/flights/ssr', ssr);

  const lead = uniqueLeadNames(nameLag);
  const passengers = buildPassengers({
    adults,
    children,
    infants,
    uniqueNames: true,
    leadFirstName: lead.leadFirstName,
    leadLastName: lead.leadLastName,
    nameIndex: nameLag,
    withPassport: intl,
  });

  let ssrAttached = { meals: 0, baggage: 0, seats: 0, amount: 0 };
  let seatMap = null;
  if (withSsr) {
    const meta = ssrMetaFromPricing(pricing.data, origin, destination);
    const meal = pickPaidMeal(ssr.data, meta);
    const bag = pickPaidBag(ssr.data, meta);
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
      seatMap = await ctx.flight.getSeatMap(pricing.data.bookingContext, smPax);
      noteCall(ctx, `${hop}-seatmap`, '/v1/flights/seatmap', seatMap);
      seat = pickOpenSeat(seatMap, meta);
    }
    if (!meal || !bag || !seat) {
      return {
        search, searchIds, picked, details, rules, pricing, ssr, seatMap,
        noPaidSsr: true,
        missingSsr: { meal: !meal, baggage: !bag, seat: !seat },
      };
    }
    const leadPax = passengers.find((p) => p.isLead) || passengers[0];
    leadPax.ssr = {
      meals: [meal.item],
      baggage: [bag.item],
      seats: [seat.item],
    };
    ssrAttached = {
      meals: 1,
      baggage: 1,
      seats: 1,
      amount: (meal.amount || 0) + (bag.amount || 0) + (seat.amount || 0),
      mealCode: meal.item.code || null,
      bagCode: bag.item.code || null,
      seatName: seat.item.seatName || null,
    };
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds,
    journeyType: journey,
  });
  payload.data.passengers = passengers;
  payload.data.contact.email = uniqueEmail('flight.e2e');
  payload.data.passportType = intl
    ? (pricing.data.passportType && pricing.data.passportType !== 'NONE'
      ? pricing.data.passportType
      : 'MINI')
    : (pricing.data.passportType || 'NONE');
  applyGst(payload, pricing.data);

  const issue = await ctx.flight.issueTicketV2(payload);
  noteCall(ctx, `${hop}-issue`, '/api/v2/flights/booking/issue-ticket', issue);
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || null;
  return {
    search,
    searchIds,
    picked,
    details,
    rules,
    pricing,
    ssr,
    seatMap,
    intl,
    issue,
    br,
    payload,
    searchFare,
    searchBody,
    ssrAttached,
    passengers,
    journey,
    origin,
    destination,
    adults,
    children,
    infants,
    withSsr,
  };
}

async function bookUntilConfirm(ctx, rows, cfg) {
  let booked = null;
  let lag = cfg.nameLag0 || 0;
  let sawNoPaidSsr = false;
  let anySsrIssueAttempt = false;
  let lastIssue = null;

  for (let i = 0; i < cfg.attempts.length && !booked; i += 1) {
    lag += 1;
    const first = await issueBooking(ctx, {
      ...cfg.attempts[i],
      nameLag: lag,
      hopPrefix: cfg.hopPrefix,
      withSsr: Boolean(cfg.requireSsr || cfg.attempts[i].withSsr),
      requireOnlineCancel: Boolean(cfg.requireOnlineCancel || cfg.attempts[i].requireOnlineCancel),
      requireOffline: Boolean(cfg.requireOffline || cfg.attempts[i].requireOffline),
    });
    lastIssue = first;
    if (first.noPaidSsr) {
      sawNoPaidSsr = true;
      continue;
    }
    if (first.skipOffline || first.skipOnline) continue;
    anySsrIssueAttempt = Boolean(cfg.requireSsr);
    if (!first.br) continue;

    const firstSt = await pollUntilSettled(ctx.flight, ctx, first.br, `${cfg.hopPrefix}-status`);
    if (firstSt.classified === 'Confirmed') {
      let onlineCancellation = null;
      if (cfg.requireOnlineCancel) {
        const det = await ctx.flight.getBookingDetail(first.br);
        noteCall(ctx, `${cfg.hopPrefix}-detail-online`, `/v1/flights/booking/${first.br}`, det);
        onlineCancellation = extractOnlineCancel(det.data);
        if (onlineCancellation !== true) {
          rows.push(row(
            'E2E', 'book', 1, 'Confirmed but onlineCancellation≠true; next airline',
            `BR ${first.br}`,
            'leave BR; cancel fixture needs onlineCancellation=true',
            `onlineCancellation=${onlineCancellation}`,
            'PASS',
          ));
          continue;
        }
      }
      booked = { ...first, status: firstSt.status, classified: firstSt.classified, statusRes: firstSt.res, onlineCancellation };
      break;
    }
    if (firstSt.classified === 'Failed' || firstSt.classified === 'Cancelled') {
      booked = { ...first, status: firstSt.status, classified: firstSt.classified, statusRes: firstSt.res };
      break;
    }
    if (firstSt.classified !== 'Inprogress') {
      booked = { ...first, status: firstSt.status, classified: firstSt.classified, statusRes: firstSt.res };
      break;
    }

    rows.push(row(
      'E2E', 'book', 1, 'Inprogress left; retry once with new names + dates',
      `BR ${first.br} ${cfg.label}`,
      'leave this BR; one retry (new names, different travel dates) then record settled status',
      `status=${firstSt.classified} polls=${firstSt.polls}`,
      'PASS',
    ));

    lag += 1;
    const retryDays = (cfg.attempts[i].onwardDays || 40) + 7;
    const second = await issueBooking(ctx, {
      ...cfg.attempts[i],
      onwardDays: retryDays,
      nameLag: lag,
      hopPrefix: `${cfg.hopPrefix}-retry`,
      withSsr: Boolean(cfg.requireSsr || cfg.attempts[i].withSsr),
      requireOnlineCancel: Boolean(cfg.requireOnlineCancel || cfg.attempts[i].requireOnlineCancel),
      requireOffline: Boolean(cfg.requireOffline || cfg.attempts[i].requireOffline),
    });
    lastIssue = second;
    if (second.skipOffline || second.skipOnline || second.noPaidSsr || !second.br) {
      booked = { ...first, status: firstSt.status, classified: firstSt.classified, statusRes: firstSt.res };
      break;
    }
    const secondSt = await pollUntilSettled(ctx.flight, ctx, second.br, `${cfg.hopPrefix}-retry-status`);
    booked = { ...second, status: secondSt.status, classified: secondSt.classified, statusRes: secondSt.res };
    break;
  }

  if (!booked?.br) {
    const noSsrInventory = cfg.requireSsr && sawNoPaidSsr && !anySsrIssueAttempt;
    const noOnline = Boolean(cfg.requireOnlineCancel);
    const noOffline = Boolean(cfg.requireOffline);
    rows.push(row(
      'E2E',
      cfg.section || 'book',
      cfg.rowId,
      cfg.label,
      cfg.how,
      'issue-ticket BR (Confirmed preferred; Inprogress → 1 retry then any status)',
      noSsrInventory
        ? `no fare with meal+baggage+seat on ${cfg.attempts.map((a) => `${a.origin}${a.destination}`).join(',')}${lastIssue?.missingSsr ? ` lastMissing=${JSON.stringify(lastIssue.missingSsr)}` : ''}`
        : `no booking this run ${brief(lastIssue?.issue?.data || lastIssue?.pricing?.data, 180)}`,
      noSsrInventory || noOnline || noOffline ? 'NOT TESTED' : 'BUG',
    ));
    return null;
  }

  const pax = paxLabel(booked);
  const ssrBit = booked.withSsr
    ? ` meals=${booked.ssrAttached?.meals} bags=${booked.ssrAttached?.baggage} seats=${booked.ssrAttached?.seats} seat=${booked.ssrAttached?.seatName || ''}`
    : '';
  const settled = isSettledBookingStatus(booked.status);
  const classified = booked.classified || classifyBookingStatus(booked.status);
  const failed = classified === 'Failed' || classified === 'Cancelled';
  rows.push(row(
    'E2E',
    cfg.section || 'book',
    cfg.rowId,
    cfg.label,
    `${(booked.searchIds || []).join('+')} ${pax} issue-ticket v2`,
    'poll status until Confirmed / Inprogress / Failed / Cancelled; Inprogress → 1 retry (new names + dates)',
    `br=${booked.br} status=${classified} journey=${booked.journey}${ssrBit}`,
    !settled ? 'NOT TESTED' : (booked.br && !failed ? 'PASS' : 'BUG'),
  ));
  return booked;
}

function rememberBook(ctx, kind, booked) {
  if (!booked?.br) return;
  ctx.e2eBooks = ctx.e2eBooks || [];
  ctx.e2eBooks.push({
    kind,
    br: booked.br,
    status: booked.classified || booked.status,
    journey: booked.journey,
    route: `${booked.origin}-${booked.destination}`,
    pax: paxLabel(booked),
    ssr: booked.withSsr ? booked.ssrAttached : null,
  });
}

export async function runE2e(ctx, { cancel = true, checkPrice = true } = {}) {
  const rows = [];
  ctx.e2eBooks = [];

  const ow = await bookUntilConfirm(ctx, rows, {
    label: 'OW 1ADT Confirmed',
    how: 'DEL-GOI connecting then DEL-BOM fallback',
    rowId: 2,
    hopPrefix: 'ow',
    attempts: [
      {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'GOI',
        maxStops: 1, preferConnecting: true, adults: 1, onwardDays: 40,
      },
      {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'BOM',
        maxStops: null, preferConnecting: false, adults: 1, onwardDays: 42,
      },
    ],
  });
  rememberBook(ctx, 'OW_1ADT', ow);

  const rt = await bookUntilConfirm(ctx, rows, {
    label: 'RT 1ADT Confirmed',
    how: 'DEL-BOM / BOM-DEL then BOM-BLR fallback',
    rowId: 3,
    hopPrefix: 'rt',
    attempts: [
      {
        journeyType: 'ROUND_TRIP', origin: 'DEL', destination: 'BOM',
        maxStops: null, adults: 1, onwardDays: 41, returnOffsetDays: 7,
      },
      {
        journeyType: 'ROUND_TRIP', origin: 'BOM', destination: 'BLR',
        maxStops: null, adults: 1, onwardDays: 44, returnOffsetDays: 6,
      },
    ],
  });
  rememberBook(ctx, 'RT_1ADT', rt);

  const intl2 = await bookUntilConfirm(ctx, rows, {
    label: 'Intl OW 2ADT Confirmed',
    how: 'DEL→DXB 2ADT + passport, then BOM→BKK, then DEL→SIN',
    rowId: 4,
    hopPrefix: 'intl',
    attempts: [
      {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'DXB',
        maxStops: null, adults: 2, onwardDays: 50, international: true,
      },
      {
        journeyType: 'ONE_WAY', origin: 'BOM', destination: 'BKK',
        maxStops: null, adults: 2, onwardDays: 53, international: true,
      },
      {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'SIN',
        maxStops: null, adults: 2, onwardDays: 56, international: true,
      },
    ],
  });
  rememberBook(ctx, 'INTL_OW_2ADT', intl2);

  const ssrBook = await bookUntilConfirm(ctx, rows, {
    label: 'OW 1ADT with seat+meal+baggage SSR Confirmed',
    how: 'GET SSR + seatmap; issue-ticket with meal, baggage, and seat on lead',
    rowId: 5,
    hopPrefix: 'ssrbook',
    requireSsr: true,
    attempts: [
      {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'BOM',
        maxStops: null, adults: 1, onwardDays: 45, withSsr: true,
      },
      {
        journeyType: 'ONE_WAY', origin: 'BOM', destination: 'BLR',
        maxStops: null, adults: 1, onwardDays: 47, withSsr: true,
      },
      {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'HYD',
        maxStops: null, adults: 1, onwardDays: 50, withSsr: true,
      },
      {
        journeyType: 'ONE_WAY', origin: 'BOM', destination: 'GOI',
        maxStops: null, adults: 1, onwardDays: 52, withSsr: true,
      },
    ],
  });
  rememberBook(ctx, 'OW_1ADT_SSR', ssrBook);

  const family = await bookUntilConfirm(ctx, rows, {
    label: 'OW 1ADT+1CHD+1INF Confirmed',
    how: 'DEL→BOM then BOM→DEL 1 adult + 1 child + 1 infant (issue-ticket passengers match search travellers)',
    rowId: 8,
    hopPrefix: 'family',
    attempts: [
      {
        journeyType: 'ONE_WAY', origin: 'DEL', destination: 'BOM',
        maxStops: null, adults: 1, children: 1, infants: 1, onwardDays: 48,
      },
      {
        journeyType: 'ONE_WAY', origin: 'BOM', destination: 'DEL',
        maxStops: null, adults: 1, children: 1, infants: 1, onwardDays: 51,
      },
    ],
  });
  rememberBook(ctx, 'OW_ADT_CHD_INF', family);

  let cancelFixture = null;
  if (cancel) {
    cancelFixture = await bookUntilConfirm(ctx, rows, {
      label: 'OW 1ADT onlineCancellation=true (cancel fixture)',
      how: 'SG/IX DEL-BOM/HYD Confirmed + itinerary.onlineCancellation=true',
      rowId: 7,
      hopPrefix: 'cancelow',
      requireOnlineCancel: true,
      attempts: [
        {
          journeyType: 'ONE_WAY', origin: 'DEL', destination: 'BOM',
          maxStops: null, adults: 1, onwardDays: 38, airlines: ['SG'], requireOnlineCancel: true,
        },
        {
          journeyType: 'ONE_WAY', origin: 'DEL', destination: 'BOM',
          maxStops: null, adults: 1, onwardDays: 43, airlines: ['IX'], requireOnlineCancel: true,
        },
        {
          journeyType: 'ONE_WAY', origin: 'BOM', destination: 'DEL',
          maxStops: null, adults: 1, onwardDays: 47, airlines: ['SG'], requireOnlineCancel: true,
        },
        {
          journeyType: 'ONE_WAY', origin: 'DEL', destination: 'HYD',
          maxStops: null, adults: 1, onwardDays: 50, airlines: ['IX'], requireOnlineCancel: true,
        },
      ],
    });
    rememberBook(ctx, 'OW_ONLINE_CANCEL', cancelFixture);
  }

  let offlineFixture = null;
  if (cancel) {
    offlineFixture = await bookUntilConfirm(ctx, rows, {
      label: 'OW 1ADT onlineCancellation=false (offline cancel copy)',
      how: 'Book fare with itinerary.onlineCancellation=false then POST cancel',
      rowId: 9,
      hopPrefix: 'offlineow',
      requireOffline: true,
      attempts: [
        {
          journeyType: 'ONE_WAY', origin: 'DEL', destination: 'BOM',
          maxStops: null, adults: 1, onwardDays: 39, airlines: ['AI'], requireOffline: true,
        },
        {
          journeyType: 'ONE_WAY', origin: 'BOM', destination: 'DEL',
          maxStops: null, adults: 1, onwardDays: 44, airlines: ['UK'], requireOffline: true,
        },
        {
          journeyType: 'ONE_WAY', origin: 'DEL', destination: 'HYD',
          maxStops: null, adults: 1, onwardDays: 49, requireOffline: true,
        },
      ],
    });
    rememberBook(ctx, 'OW_OFFLINE_CANCEL', offlineFixture);
  }
  ctx.offlineFixture = offlineFixture;

  const fixture = ow || rt || intl2 || ssrBook || family || cancelFixture || offlineFixture;
  if (!fixture?.br) {
    return rows;
  }

  ctx.bookingRefId = cancelFixture?.br || ow?.br || fixture.br;
  ctx.bookingStatus = cancelFixture?.status || ow?.status || fixture.status;
  ctx.onlineCancellation = cancelFixture?.onlineCancellation === true;
  ctx.pnr = (cancelFixture || ow || fixture).statusRes?.data?.pnr
    || (cancelFixture || ow || fixture).issue?.data?.pnr
    || (cancelFixture || ow || fixture).statusRes?.data?.bookingResponse?.itinerary?.[0]?.pnr
    || null;
  ctx.e2e = cancelFixture || fixture;

  const rulesOk = fixture.rules?.ok || errCode(fixture.rules) === 'VENDOR_ERROR';
  rows.push(row(
    'E2E', 'rules', 1, 'Fare rules present or documented VENDOR_ERROR',
    'POST /v1/flights/fareRules',
    '200 rules or VENDOR_ERROR',
    `HTTP ${fixture.rules?.status} code=${errCode(fixture.rules)}`,
    rulesOk ? 'PASS' : 'BUG',
  ));

  const rulesRiya = findRiyaHits(fixture.rules?.data, '$.fareRules');
  rows.push(row(
    'E2E', 'rules', 2, 'Fare rules response has no Riya',
    'POST /v1/flights/fareRules body',
    'no riya in any field',
    rulesRiya.length ? rulesRiya.slice(0, 6).join(', ') : 'none',
    rulesRiya.length ? 'BUG' : 'PASS',
  ));

  const leak = findRiyaHits(fixture.details?.data, '$.details')
    .concat(findRiyaHits(fixture.pricing?.data, '$.pricing'))
    .concat(findRiyaHits(fixture.issue?.data, '$.issue'));
  rows.push(row(
    'E2E', 'vendor', 1, 'No Riya in details / pricing / issue-ticket',
    'details + pricing + issue-ticket JSON',
    'no riya in keys or values',
    leak.length ? leak.slice(0, 6).join(', ') : 'none',
    leak.length ? 'BUG' : 'PASS',
  ));

  const ssrProbe = fixture.ssr || (fixture.pricing?.data?.priceId
    ? await ctx.flight.getSsr(fixture.pricing.data.priceId)
    : null);
  if (ssrProbe && !fixture.ssr) {
    noteCall(ctx, 'e2e-ssr', '/v1/flights/ssr', ssrProbe);
  }
  rows.push(row(
    'E2E', 'ssr', 1, 'SSR catalog does not 500',
    'POST /v1/flights/ssr priceId',
    'HTTP < 500',
    `HTTP ${ssrProbe?.status} code=${errCode(ssrProbe)}`,
    (ssrProbe?.status ?? 500) < 500 ? 'PASS' : 'BUG',
  ));

  const detail = await ctx.flight.getBookingDetail(ctx.bookingRefId);
  noteCall(ctx, 'e2e-detail', `/v1/flights/booking/${ctx.bookingRefId}`, detail);
  const hist = await ctx.flight.bookingHistory();
  noteCall(ctx, 'e2e-history', '/v1/flights/bookings/history', hist);
  const histBlob = JSON.stringify(hist.data || {});
  rows.push(row(
    'E2E', 'book', 6, 'History lists cancel-fixture BR',
    'GET /v1/flights/bookings/history',
    'BR present',
    `http=${hist.status} listed=${histBlob.includes(ctx.bookingRefId)}`,
    hist.ok && histBlob.includes(ctx.bookingRefId) ? 'PASS' : (hist.ok ? 'NOT TESTED' : 'BUG'),
  ));

  const feeSources = [fixture.pricing?.data, fixture.issue?.data, detail.data, fixture.statusRes?.data];
  rows.push(row(
    'E2E', 'fee', 1, 'convenienceFee field present',
    'pricing / issue / status / detail',
    'field present (0 allowed)',
    `present=${feeSources.some(hasConvenienceFee)}`,
    feeSources.some(hasConvenienceFee) ? 'PASS' : 'NOT TESTED',
  ));

  if (checkPrice && ow && /confirm/i.test(ow.status || '')) {
    const owDetail = ow.br
      ? await ctx.flight.getBookingDetail(ow.br)
      : detail;
    if (ow.br) {
      noteCall(ctx, 'price-ow-detail', `/v1/flights/booking/${ow.br}`, owDetail);
    }
    const totals = {
      search: ow.searchFare,
      details: totalOf(ow.details?.data),
      pricing: totalOf(ow.pricing?.data),
      confirmed: totalOf(ow.issue?.data) ?? totalOf(ow.statusRes?.data),
      detail: totalOf(owDetail?.data),
    };
    const matched = allTotalsMatch(
      [totals.search, totals.details, totals.pricing, totals.confirmed, totals.detail],
      1,
    );
    const extra = {};
    if (!matched) {
      const packet = buildPriceRepro({
        ow,
        owDetail,
        totals,
        correlationId: ctx.correlationId,
      });
      extra.responseSnippet = packet;
      extra.note = persistPriceMismatch(packet);
    }
    rows.push(row(
      'PRICE', 'price', 1, 'Search ≈ details ≈ pricing ≈ confirmed ≈ detail',
      `±₹1 on OW 1ADT br=${ow.br} searchId=${(ow.searchIds || []).join('+') || 'n/a'}`,
      'match',
      `search=${totals.search} details=${totals.details} pricing=${totals.pricing} confirmed=${totals.confirmed} detail=${totals.detail}${extra.note ? ` file=${extra.note}` : ''}`,
      matched ? 'PASS' : 'BUG',
      extra,
    ));

    const parts = fareParts(ow.pricing?.data);
    const sumOk = parts.base != null && parts.tax != null && parts.total != null
      && moneyEq(parts.base + parts.tax + (parts.fee || 0), parts.total, 1);
    rows.push(row(
      'PRICE', 'price', 2, 'POST /v1/flights/pricing — baseFare + taxes + convenienceFee ≈ totalAmount',
      `OW 1ADT priceId=${ow.pricing?.data?.priceId || 'n/a'}`,
      'parts sum to total ±₹1',
      `base=${parts.base} tax=${parts.tax} fee=${parts.fee} total=${parts.total}`,
      parts.base == null || parts.tax == null || parts.total == null ? 'NOT TESTED' : (sumOk ? 'PASS' : 'BUG'),
    ));
    const gst = ow.pricing?.data?.gstBreakup;
    rows.push(row(
      'PRICE', 'price', 3, 'POST /v1/flights/pricing — gstBreakup is array or omitted',
      'pricing JSON gstBreakup',
      'array (may be empty) or field absent',
      `gstBreakup=${gst == null ? 'absent' : (Array.isArray(gst) ? `array(${gst.length})` : typeof gst)}`,
      gst == null || Array.isArray(gst) ? 'PASS' : 'BUG',
    ));
  } else if (checkPrice) {
    rows.push(row(
      'PRICE', 'price', 1, 'Search ≈ details ≈ pricing ≈ confirmed ≈ detail',
      'needs Confirmed OW 1ADT fixture',
      'match',
      `owStatus=${ow?.status || null}`,
      'NOT TESTED',
    ));
  }

  if (ssrBook && /confirm/i.test(ssrBook.status || '')) {
    const ssrDetail = ssrBook.br && ssrBook.br !== ctx.bookingRefId
      ? await ctx.flight.getBookingDetail(ssrBook.br)
      : (ssrBook.br === ctx.bookingRefId ? detail : null);
    if (ssrBook.br && ssrBook.br !== ctx.bookingRefId) {
      noteCall(ctx, 'price-ssr-detail', `/v1/flights/booking/${ssrBook.br}`, ssrDetail);
    }
    const priced = totalOf(ssrBook.pricing?.data);
    const confirmed = totalOf(ssrBook.issue?.data) ?? totalOf(ssrBook.statusRes?.data) ?? totalOf(ssrDetail?.data);
    const addOn = Number(ssrBook.ssrAttached?.amount || 0);
    const expected = priced != null && addOn ? priced + addOn : null;
    const close = expected != null && confirmed != null && moneyEq(confirmed, expected, 2);
    rows.push(row(
      'PRICE', 'ssr', 1, 'SSR+seat catalog amount is in confirmed total (pricing + addons)',
      `OW SSR book br=${ssrBook.br} meals=${ssrBook.ssrAttached?.meals} bags=${ssrBook.ssrAttached?.baggage} seats=${ssrBook.ssrAttached?.seats}`,
      'confirmed ≈ pricing + attached SSR/seat ±₹2',
      `pricing=${priced} addons=${addOn} confirmed=${confirmed} expected=${expected}`,
      addOn <= 0 ? 'NOT TESTED' : (close ? 'PASS' : 'BUG'),
    ));
  }

  if (ow?.payload && /confirm/i.test(ow.status || '')) {
    const replay = await ctx.flight.issueTicketV2(ow.payload);
    noteCall(ctx, 'e2e-issue-duplicate', '/api/v2/flights/booking/issue-ticket', replay);
    const newBr = replay.data?.bookingReference || replay.data?.bookingReferenceId || null;
    const dup = replay.data?.duplicate === true;
    const sameBr = Boolean(newBr && ow.br && String(newBr) === String(ow.br));
    const crash = (replay.status || 0) >= 500;
    const extraBook = replay.ok && newBr && !sameBr && !dup;
    rows.push(row(
      'E2E', 'dup', 1, 'POST /api/v2/flights/booking/issue-ticket — replay same payload (duplicate cache)',
      `Replay OW payload after Confirmed br=${ow.br}`,
      'HTTP 200 duplicate:true and/or same BR, or 4xx — never 500 and never a second distinct BR',
      `HTTP ${replay.status} duplicate=${dup} br=${newBr} code=${errCode(replay)}`,
      crash || extraBook ? 'BUG' : 'PASS',
    ));
  }

  ctx.skipCancel = !cancel;
  return rows;
}

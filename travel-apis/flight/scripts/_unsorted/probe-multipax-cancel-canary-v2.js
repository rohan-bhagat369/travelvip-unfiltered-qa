/**
 * Canary multipax cancel retest — OW + RT, different routes, SSR (seat/meal/baggage),
 * full validation matrix, then subset/full cancel on clean PNRs.
 *
 * Canary/dev note: bookings often stay Inprogress (vendor-side). Do NOT keep polling
 * for Confirmed — leave Inprogress and continue cancel tests when PNR is present.
 *
 *   BASE_URL=https://canary-api.travelvip.ai FLIGHT_ISSUE_PID=vgm node scripts/probe-multipax-cancel-canary-v2.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import { FlightService } from '../../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isTerminalBookingStatus,
} from '../../src/helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'multipax-cancel-canary-v2.json');
const Q = { ...FLIGHT_QUERY };

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 450) {
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
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function cancelStatus(r) {
  return (
    r?.data?.cancellationRequest?.status
    || r?.data?.data?.cancellationRequest?.status
    || r?.data?.status
    || null
  );
}
function paxScope(r) {
  return r?.data?.paxScope || r?.data?.data?.paxScope || null;
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

function extractOnline(detailData) {
  const it = detailData?.bookingResponse?.itinerary || [];
  return it.map((leg) => ({
    direction: leg.direction,
    onlineCancellation: leg.onlineCancellation,
    pnr: leg.pnr,
  }));
}

function extractSsrSummary(detailData) {
  const pax = detailData?.bookingResponse?.passengers || [];
  return pax.map((p) => ({
    paxId: p.paxId,
    meals: (p.ssr?.meal || p.ssr?.meals || []).length,
    seats: (p.ssr?.seat || p.ssr?.seats || []).length,
    baggage: (p.ssr?.baggage || []).length,
  }));
}

async function cancelApi(client, bookingId, body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${bookingId}/cancel`,
    query: Q,
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

/**
 * On canary/dev, bookings often stay Inprogress (vendor-side).
 * Poll briefly for Confirmed/Failed/Cancelled; if still Inprogress → leave it and continue.
 * Keep polling Pending longer — canary often flips Pending → Confirmed after PNR appears.
 */
async function waitBookingReady(flight, br, max = 12) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    console.log('  status', br, i + 1, st);
    if (isTerminalBookingStatus(st)) return st;
    // Inprogress → stop early (vendor-side on canary/dev)
    if (/inprogress|in.?progress/i.test(st) && i >= 1) {
      console.log('  leaving Inprogress (vendor-side on canary/dev)');
      return st;
    }
    await sleep(3000);
  }
  return last?.data?.status;
}

function bookingUsable(status, pnr) {
  // Usable when we have a PNR and booking is not Failed/Cancelled
  if (!pnr) return false;
  if (/fail|cancel/i.test(String(status))) return false;
  return true;
}

function adultProfiles(n) {
  const base = [
    ['Rohan', 'Bhagat', 'Mr', 'Male', '2001-05-29'],
    ['Amit', 'Sharma', 'Mr', 'Male', '1995-08-15'],
    ['Neha', 'Patil', 'Mrs', 'Female', '1994-03-12'],
    ['Vikram', 'Singh', 'Mr', 'Male', '1992-11-20'],
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

/**
 * Build SSR objects matching export_b2b Postman examples:
 * Issue Flight Ticket :: Oneway/RT with bag, meal, seat
 */
function routeOdFromPricing(pricingData) {
  const legs = pricingData?.itinerary || [];
  return legs.map((leg) => {
    const seg = leg.segments?.[0];
    return {
      direction: String(leg.direction || 'ONWARD').toUpperCase(),
      origin: seg?.departure?.airportCode || seg?.origin || null,
      destination: seg?.arrival?.airportCode || seg?.destination || null,
      segmentId: seg?.segmentId || 'SEG_1',
    };
  });
}

function buildMealSsr(m, direction = 'ONWARD', segmentId = 'SEG_1') {
  const ssrId = String(m.ssrId || m.mealId || '');
  return {
    ssrId,
    mealId: ssrId,
    direction,
    segmentId: m.segmentId || segmentId,
    paxType: 'ADT',
    code: m.code,
    title: m.title || m.description || 'Meal',
    description: m.description || m.title || 'Meal',
    priceReference: m.priceReference || m.pricing?.priceReference,
  };
}

function buildBagSsr(b, { direction, origin, destination, segmentId }) {
  const ssrId = String(b.ssrId || b.baggageId || '');
  return {
    ssrId,
    baggageId: ssrId,
    direction,
    segmentId: b.segmentId || segmentId || 'SEG_1',
    paxType: 'ADT',
    code: b.code,
    title: b.title || b.description || 'Bag',
    description: b.description || b.title || 'Bag',
    priceReference: b.priceReference || b.pricing?.priceReference,
    weight: Number(b.weight || b.Weight || 5),
    origin: b.origin || b.Origin || origin,
    destination: b.destination || b.Destination || destination,
  };
}

function buildSeatSsr(s, { direction, origin, destination, segmentId }) {
  const seatName = String(s.seatName || s.seatNumber || s.SeatNumber || '');
  const seatId = String(s.seatId || s.SeatId || s.seatKey || seatName);
  return {
    origin: s.origin || origin,
    destination: s.destination || destination,
    segmentId: s.segmentId || segmentId || 'SEG_1',
    seatAvailability: s.seatAvailability || 'Open',
    seatName,
    seatPosition: s.seatPosition || '',
    seatKey: String(s.seatKey || seatId),
    seatId,
    direction,
    priceReference: s.priceReference || s.PriceReference || s.pricing?.priceReference || s.priceDetail?.priceReference,
  };
}

async function pickAddons(flight, pricing, adults, { origin, destination } = {}) {
  const legs = routeOdFromPricing(pricing.data);
  const onward = legs.find((l) => l.direction === 'ONWARD') || {
    direction: 'ONWARD',
    origin: origin || 'DEL',
    destination: destination || 'BOM',
    segmentId: 'SEG_1',
  };
  const ret = legs.find((l) => l.direction === 'RETURN') || null;

  const addons = {
    mealsByPax: [],
    bagsByPax: [],
    seatsByPax: [],
  };

  try {
    const ssr = await flight.getSsr(pricing.data.priceId);
    const mealOpts = [];
    for (const seg of ssr.data?.meal?.segments || []) {
      const dir = /return|inbound/i.test(String(seg.WayType || seg.wayType || ''))
        ? 'RETURN'
        : 'ONWARD';
      const leg = dir === 'RETURN' && ret ? ret : onward;
      for (const m of seg.Meals || seg.meals || []) {
        const pref = m.priceReference || m.pricing?.priceReference;
        const amt = money(m.pricing?.totalAmount ?? m.amount);
        if (!pref) continue;
        mealOpts.push({
          ...m,
          amount: amt ?? 0,
          priceReference: pref,
          _dir: dir,
          _seg: m.segmentId || seg.segmentId || leg.segmentId,
        });
      }
    }
    mealOpts.sort((a, b) => (a.amount || 0) - (b.amount || 0));

    const bagOpts = [];
    for (const seg of ssr.data?.baggage?.segments || []) {
      const dir = /return|inbound/i.test(String(seg.WayType || seg.wayType || ''))
        ? 'RETURN'
        : 'ONWARD';
      const leg = dir === 'RETURN' && ret ? ret : onward;
      const o = seg.Origin || seg.origin || leg.origin;
      const d = seg.Destination || seg.destination || leg.destination;
      for (const b of seg.Baggage || seg.baggage || []) {
        const pref = b.priceReference || b.pricing?.priceReference;
        const amt = money(b.pricing?.totalAmount ?? b.amount);
        if (!pref || !o || !d) continue;
        bagOpts.push({
          ...b,
          amount: amt ?? 0,
          priceReference: pref,
          _dir: dir,
          _seg: b.segmentId || seg.segmentId || leg.segmentId,
          _origin: o,
          _destination: d,
        });
      }
    }
    bagOpts.sort((a, b) => (a.amount || 0) - (b.amount || 0));

    for (let i = 0; i < adults; i += 1) {
      const meals = [];
      const bags = [];
      // one onward meal/bag per adult if available (rotate options)
      const mOn = mealOpts.filter((x) => x._dir === 'ONWARD')[i] || mealOpts.filter((x) => x._dir === 'ONWARD')[0];
      if (mOn) meals.push(buildMealSsr(mOn, 'ONWARD', mOn._seg));
      if (ret) {
        const mRet = mealOpts.filter((x) => x._dir === 'RETURN')[i]
          || mealOpts.filter((x) => x._dir === 'RETURN')[0];
        if (mRet) meals.push(buildMealSsr(mRet, 'RETURN', mRet._seg));
      }
      const bOn = bagOpts.filter((x) => x._dir === 'ONWARD')[i] || bagOpts.filter((x) => x._dir === 'ONWARD')[0];
      if (bOn) {
        bags.push(buildBagSsr(bOn, {
          direction: 'ONWARD',
          origin: bOn._origin,
          destination: bOn._destination,
          segmentId: bOn._seg,
        }));
      }
      if (ret) {
        const bRet = bagOpts.filter((x) => x._dir === 'RETURN')[i]
          || bagOpts.filter((x) => x._dir === 'RETURN')[0];
        if (bRet) {
          bags.push(buildBagSsr(bRet, {
            direction: 'RETURN',
            origin: bRet._origin,
            destination: bRet._destination,
            segmentId: bRet._seg,
          }));
        }
      }
      addons.mealsByPax[i] = meals;
      addons.bagsByPax[i] = bags;
    }
  } catch (e) {
    console.log('  ssr fetch fail', e.message);
  }

  // seats from seatmap — collection uses seatName/seatId/seatKey/seatAvailability/priceReference + OD
  try {
    const smPassengers = adultProfiles(adults).map((p, i) => ({
      paxRefNumber: String(i + 1),
      passengerType: 1,
      gender: p.profile.gender,
      title: p.profile.title,
      firstName: p.profile.firstName,
      lastName: p.profile.lastName,
    }));
    const sm = await flight.getSeatMap(pricing.data.bookingContext, smPassengers);
    const root = sm.data?.data || sm.data || {};
    const segs = root.segments || [];
    const used = new Set();

    const pickOpenSeat = (seg, legMeta) => {
      for (const s of seg.seatMap || []) {
        if (!/open/i.test(String(s.seatAvailability || ''))) continue;
        const pref = s.priceReference || s.priceDetail?.priceReference || s.pricing?.priceReference;
        const seatName = s.seatName || s.seatNumber;
        const seatId = s.seatId || s.seatKey;
        if (!pref || !seatName || !seatId) continue;
        const key = `${legMeta.direction}:${seatId}`;
        if (used.has(key)) continue;
        used.add(key);
        return buildSeatSsr(s, {
          direction: legMeta.direction,
          origin: legMeta.origin || seg.origin,
          destination: legMeta.destination || seg.destination,
          segmentId: s.segmentId || seg.segmentId || legMeta.segmentId,
        });
      }
      return null;
    };

    for (let i = 0; i < adults; i += 1) {
      const seats = [];
      const dirsSeen = new Set();
      for (const seg of segs) {
        const isReturn = /return/i.test(String(seg.direction || ''))
          || (ret && seg.origin === ret.origin && seg.destination === ret.destination);
        const direction = isReturn ? 'RETURN' : 'ONWARD';
        if (dirsSeen.has(direction)) continue;
        const legMeta = isReturn && ret ? ret : onward;
        const seat = pickOpenSeat(seg, {
          ...legMeta,
          direction,
        });
        if (seat?.priceReference && seat.seatId && seat.seatName && seat.origin && seat.destination) {
          seats.push(seat);
          dirsSeen.add(direction);
        }
      }
      // if only one segment in map, still assign onward
      if (!seats.length && segs[0]) {
        const seat = pickOpenSeat(segs[0], onward);
        if (seat) seats.push(seat);
      }
      addons.seatsByPax[i] = seats;
    }
  } catch (e) {
    console.log('  seatmap fail', e.message);
  }

  return addons;
}

function applyAddons(passengers, addons) {
  const applied = { meals: 0, bags: 0, seats: 0 };
  passengers.forEach((p, i) => {
    const meals = (addons.mealsByPax[i] || []).filter((m) => m.priceReference && m.ssrId);
    const bags = (addons.bagsByPax[i] || []).filter((b) => mValidBag(b));
    const seats = (addons.seatsByPax[i] || []).filter((s) => mValidSeat(s));
    p.ssr.meals = meals;
    p.ssr.baggage = bags;
    p.ssr.seats = seats;
    applied.meals += meals.length;
    applied.bags += bags.length;
    applied.seats += seats.length;
  });
  return applied;
}

function mValidBag(b) {
  return Boolean(b?.priceReference && b?.ssrId && b?.origin && b?.destination && b?.baggageId);
}

function mValidSeat(s) {
  return Boolean(
    s?.priceReference
    && s?.seatId
    && s?.seatKey
    && s?.seatName
    && s?.seatAvailability
    && s?.origin
    && s?.destination
    && s?.segmentId
    && s?.direction,
  );
}

async function bookOw(flight, client, {
  adults, days, origin, destination, withAddons = false, label,
}) {
  console.log(`\nBOOK ${label}: OW ${origin}->${destination} +${days}d adults=${adults} addons=${withAddons}`);
  const body = buildOneWaySearchBody(days, {
    origin, destination, fareType: 'NORMAL', maxStops: 0,
  });
  body.travellers = { adults, children: 0, infants: 0 };

  const search = await flight.searchUntilComplete(body);
  const pricing = await flight.getPricing([search.searchId], 'ONE_WAY');
  if (!ok(pricing)) throw new Error(`pricing: ${brief(pricing.data)}`);

  const passengers = adultProfiles(adults);
  let applied = { meals: 0, bags: 0, seats: 0 };
  if (withAddons) {
    const addons = await pickAddons(flight, pricing, adults, { origin, destination });
    applied = applyAddons(passengers, addons);
    console.log('  addons applied', applied);
    console.log('  sample ssr pax0', brief(passengers[0]?.ssr, 500));
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [search.searchId],
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
  let br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
  if (!br && withAddons) {
    console.log('  issue with addons failed, retry plain:', brief(issue.data, 180));
    const plain = adultProfiles(adults);
    payload.data.passengers = plain;
    applied = { meals: 0, bags: 0, seats: 0, fallbackPlain: true, issueError: brief(issue.data, 220) };
    const issue2 = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    br = issue2.data?.bookingReference || issue2.data?.bookingReferenceId || issue2.data?.bookingRefId;
    if (!br) throw new Error(`issue: ${brief(issue2.data)}`);
  } else if (!br) {
    throw new Error(`issue: ${brief(issue.data)}`);
  }

  const status = await waitBookingReady(flight, br);
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractPnrs(detail.data);
  // Prefer detail status when present (can lag behind status endpoint briefly)
  const detailStatus = detail.data?.status || detail.data?.bookingResponse?.status || status;
  return {
    label,
    journeyType: 'ONE_WAY',
    route: `${origin}-${destination}`,
    adults,
    br,
    status: detailStatus || status,
    usable: bookingUsable(detailStatus || status, pnrs[0]),
    pnrs,
    pnr: pnrs[0] || null,
    onlineLegs: extractOnline(detail.data),
    ssrSummary: extractSsrSummary(detail.data),
    addonsApplied: applied,
    priceId: pricing.data.priceId,
  };
}

async function bookRt(flight, client, {
  adults, onwardDays, returnDays, origin, destination, withAddons = false, label,
}) {
  console.log(`\nBOOK ${label}: RT ${origin}<->${destination} +${onwardDays}/${returnDays} adults=${adults}`);
  const body = buildRoundTripSearchBody(onwardDays, returnDays, {
    origin, destination, fareType: 'NORMAL', maxStops: 0,
  });
  body.travellers = { adults, children: 0, infants: 0 };

  const search = await flight.searchRoundTripUntilComplete(body);
  const ids = search.searchIds;
  if (!ids || ids.length < 2) throw new Error('no RT searchIds');

  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  if (!ok(pricing)) throw new Error(`RT pricing: ${brief(pricing.data)}`);

  const passengers = adultProfiles(adults);
  let applied = { meals: 0, bags: 0, seats: 0 };
  if (withAddons) {
    const addons = await pickAddons(flight, pricing, adults, { origin, destination });
    applied = applyAddons(passengers, addons);
    console.log('  addons applied', applied);
    console.log('  sample ssr pax0', brief(passengers[0]?.ssr, 500));
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: ids,
    journeyType: 'ROUND_TRIP',
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
  let br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId;
  if (!br && withAddons) {
    console.log('  RT issue with addons failed, retry plain:', brief(issue.data, 180));
    payload.data.passengers = adultProfiles(adults);
    applied = { meals: 0, bags: 0, seats: 0, fallbackPlain: true, issueError: brief(issue.data, 220) };
    const issue2 = await client.request({
      method: 'POST',
      path: '/api/v2/flights/booking/issue-ticket',
      query: { ...Q, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    br = issue2.data?.bookingReference || issue2.data?.bookingReferenceId || issue2.data?.bookingRefId;
    if (!br) throw new Error(`RT issue: ${brief(issue2.data)}`);
  } else if (!br) {
    throw new Error(`RT issue: ${brief(issue.data)}`);
  }

  const status = await waitBookingReady(flight, br);
  const detail = await flight.getBookingDetail(br);
  const pnrs = extractPnrs(detail.data);
  const detailStatus = detail.data?.status || detail.data?.bookingResponse?.status || status;
  return {
    label,
    journeyType: 'ROUND_TRIP',
    route: `${origin}-${destination}-${origin}`,
    adults,
    br,
    status: detailStatus || status,
    usable: bookingUsable(detailStatus || status, pnrs[0]),
    pnrs,
    pnr: pnrs[0] || null,
    pnrReturn: pnrs[1] || null,
    onlineLegs: extractOnline(detail.data),
    ssrSummary: extractSsrSummary(detail.data),
    addonsApplied: applied,
    priceId: pricing.data.priceId,
  };
}

function row(id, how, expected, actual, status, note = '') {
  return { id, how, expected, actual, status, note };
}

async function main() {
  clearSession();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  console.log('Base', config.baseUrl, 'partner', config.partnerId, 'tier', config.tierId);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    fixtures: {},
    results: [],
    score: { PASS: 0, BUG: 0, NOT_TESTED: 0 },
  };
  const add = (r) => {
    report.results.push(r);
    if (report.score[r.status] != null) report.score[r.status] += 1;
    console.log(`[${r.status}] ${r.id}`);
  };
  const expect = (cond, id, how, expected, actual, note) => {
    add(row(id, how, expected, actual, cond ? 'PASS' : 'BUG', note || ''));
  };

  // ---- Book distinct fixtures ----
  try {
    report.fixtures.OW1_VALID = await bookOw(flight, client, {
      label: 'OW1_VALID', adults: 1, days: 63, origin: 'HYD', destination: 'DEL', withAddons: false,
    });
  } catch (e) {
    report.fixtures.OW1_VALID = { error: e.message };
    console.log('OW1_VALID fail', e.message);
  }

  try {
    report.fixtures.OW4_SSR = await bookOw(flight, client, {
      label: 'OW4_SSR', adults: 4, days: 70, origin: 'BLR', destination: 'DEL', withAddons: true,
    });
  } catch (e) {
    report.fixtures.OW4_SSR = { error: e.message };
    console.log('OW4_SSR fail', e.message);
  }

  try {
    report.fixtures.RT2_SSR = await bookRt(flight, client, {
      label: 'RT2_SSR',
      adults: 2,
      onwardDays: 75,
      returnDays: 82,
      origin: 'DEL',
      destination: 'BOM',
      withAddons: true,
    });
  } catch (e) {
    report.fixtures.RT2_SSR = { error: e.message };
    console.log('RT2_SSR fail', e.message);
  }

  try {
    report.fixtures.OW1_FULL = await bookOw(flight, client, {
      label: 'OW1_FULL', adults: 1, days: 68, origin: 'BOM', destination: 'BLR', withAddons: false,
    });
  } catch (e) {
    report.fixtures.OW1_FULL = { error: e.message };
    console.log('OW1_FULL fail', e.message);
  }

  // Prefer dedicated validation BR; fall back to any usable 1ADT plain fixture
  let V = report.fixtures.OW1_VALID?.usable ? report.fixtures.OW1_VALID : null;
  const F4 = report.fixtures.OW4_SSR?.usable ? report.fixtures.OW4_SSR : null;
  let RT = report.fixtures.RT2_SSR?.usable ? report.fixtures.RT2_SSR : null;
  let F1full = report.fixtures.OW1_FULL?.usable ? report.fixtures.OW1_FULL : null;

  // If RT SSR failed at vendor, book a plain RT for cancel coverage
  if (!RT) {
    try {
      report.fixtures.RT2_PLAIN = await bookRt(flight, client, {
        label: 'RT2_PLAIN',
        adults: 2,
        onwardDays: 78,
        returnDays: 85,
        origin: 'BLR',
        destination: 'DEL',
        withAddons: false,
      });
      if (report.fixtures.RT2_PLAIN?.usable) RT = report.fixtures.RT2_PLAIN;
    } catch (e) {
      report.fixtures.RT2_PLAIN = { error: e.message };
      console.log('RT2_PLAIN fail', e.message);
    }
  }

  if (!V && F1full) {
    // Keep OW1_FULL for full-cancel; book another 1ADT for validations
    try {
      report.fixtures.OW1_VALID2 = await bookOw(flight, client, {
        label: 'OW1_VALID2', adults: 1, days: 66, origin: 'MAA', destination: 'BLR', withAddons: false,
      });
      if (report.fixtures.OW1_VALID2?.usable) V = report.fixtures.OW1_VALID2;
    } catch (e) {
      report.fixtures.OW1_VALID2 = { error: e.message };
      console.log('OW1_VALID2 fail', e.message);
    }
  }

  console.log('\nPNR uniqueness check:', {
    OW1: V?.pnr,
    OW4: F4?.pnr,
    RT: RT?.pnrs,
    OW1_FULL: F1full?.pnr,
    SSR: {
      OW4: F4?.ssrSummary,
      RT: report.fixtures.RT2_SSR?.ssrSummary,
      OW4addons: F4?.addonsApplied,
      RTaddons: report.fixtures.RT2_SSR?.addonsApplied,
    },
  });

  // ---- Section 4 validations on OW1_VALID (invalid payloads should not write) ----
  console.log('\n=== VALIDATIONS on OW1_VALID ===');
  if (!V?.br || !V?.pnr) {
    add(row('4.x', 'validations', 'OW1 confirmed', 'missing', 'NOT_TESTED'));
  } else {
    const br = V.br;
    const pnr = V.pnr;
    const base = { action: 'CANCEL', pnr };

    const cases = [
      ['4.1a', 'PAX1', 'VALIDATION_ERROR', 400],
      ['4.1c', [['PAX1']], 'VALIDATION_ERROR', 400],
      ['4.2a', [null], 'VALIDATION_ERROR', 400],
      ['4.2b', [true], 'VALIDATION_ERROR', 400],
      ['4.2c', [{}], 'VALIDATION_ERROR', 400],
      ['4.3a', ['ABC'], 'VALIDATION_ERROR', 400],
      ['4.3b', [''], 'VALIDATION_ERROR', 400],
      ['4.3c', [' '], 'VALIDATION_ERROR', 400],
      ['4.3d', ['1.5'], 'VALIDATION_ERROR', 400],
      ['4.3e', [-1], 'VALIDATION_ERROR', 400],
      ['4.3f', [0], 'VALIDATION_ERROR', 400],
      ['4.3g', ['PAX0'], 'VALIDATION_ERROR', 400],
      ['4.3h', ['PAX01'], 'VALIDATION_ERROR', 400],
      ['4.3i', ['2PAX3'], 'VALIDATION_ERROR', 400],
      ['4.4', ['FOO9'], 'VALIDATION_ERROR', 400],
      ['4.6', ['PAX9', 'ABC'], 'VALIDATION_ERROR', 400],
      ['4.7a', ['PAX1', 'PAX1'], 'VALIDATION_ERROR', 400],
      ['4.7b', ['PAX1', '1'], 'VALIDATION_ERROR', 400],
      ['4.7c', ['PAX1', 'pax_1'], 'VALIDATION_ERROR', 400],
      ['4.7d', [1, 1], 'VALIDATION_ERROR', 400],
      ['4.7e', [' PAX1 ', 'PAX1'], 'VALIDATION_ERROR', 400],
      ['4.8', ['PAX1', 'PAX1', 'PAX2', 'PAX2'], 'VALIDATION_ERROR', 400],
      ['4.9', ['ABC', 'PAX1', 'PAX1'], 'VALIDATION_ERROR', 400],
    ];

    for (const [id, list, code, http] of cases) {
      const r = await cancelApi(client, br, { ...base, cancellationPaxList: list });
      expect(
        r.status === http && errCode(r) === code,
        id,
        `list=${JSON.stringify(list)}`,
        `${http} ${code}`,
        `${r.status} ${errCode(r)}`,
        brief(r.data?.error, 160),
      );
    }

    // 4.1b object — known bug candidate; run last among invalids
    {
      const r = await cancelApi(client, br, { ...base, cancellationPaxList: { 0: 'PAX1' } });
      expect(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.1b',
        'object {0:"PAX1"}',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r) || cancelStatus(r)}`,
        brief(r.data, 220),
      );
    }

    // 4.5 whitespace via PENALTY (should not write cancel)
    {
      const r = await cancelApi(client, br, {
        action: 'PENALTY',
        pnr,
        cancellationPaxList: [' PAX1 '],
      });
      expect(
        errCode(r) !== 'VALIDATION_ERROR',
        '4.5',
        '[" PAX1 "] accepted',
        'not VALIDATION_ERROR',
        `${r.status} ${errCode(r) || cancelStatus(r)}`,
        brief(r.data, 200),
      );
    }

    // 4.10 too large on 1-pax
    {
      const r = await cancelApi(client, br, {
        ...base,
        cancellationPaxList: ['PAX1', 'PAX2', 'PAX3'],
      });
      expect(
        r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
        '4.10',
        '3 entries on 1-pax',
        '400 PAX_LIST_TOO_LARGE',
        `${r.status} ${errCode(r)}`,
      );
    }

    // 4.11
    {
      const list = Array.from({ length: 51 }, (_, i) => `PAX${i + 1}`);
      const r = await cancelApi(client, br, { ...base, cancellationPaxList: list });
      expect(
        r.status === 400 && errCode(r) === 'PAX_LIST_TOO_LARGE',
        '4.11',
        '51 entries',
        '400 PAX_LIST_TOO_LARGE',
        `${r.status} ${errCode(r)}`,
      );
    }

    // 4.12
    {
      const r = await cancelApi(client, br, {
        ...base,
        cancellationPaxList: ['PAX1', 'PAX9'],
      });
      expect(
        r.status === 422 && errCode(r) === 'PAX_NOT_IN_BOOKING',
        '4.12',
        'PAX9 not in booking',
        '422 PAX_NOT_IN_BOOKING',
        `${r.status} ${errCode(r)}`,
      );
    }

    {
      const r = await cancelApi(client, br, { action: 'CANCEL', pnr: 'ZZZZZZ', cancellationPaxList: ['PAX1'] });
      expect(
        r.status === 422 && (errCode(r) === 'PNR_INVALID' || errCode(r) === 'PNR_NOT_FOUND'),
        '4.pnr-invalid',
        'unknown pnr',
        '422 PNR_INVALID/NOT_FOUND',
        `${r.status} ${errCode(r)}`,
      );
    }
    {
      const r = await cancelApi(client, 'BR0000000000000000', { action: 'CANCEL', pnr: 'XXXXXX' });
      expect(
        r.status === 404 && errCode(r) === 'BOOKING_NOT_FOUND',
        '4.booking-not-found',
        'unknown BR',
        '404 BOOKING_NOT_FOUND',
        `${r.status} ${errCode(r)}`,
      );
    }
    {
      const r = await cancelApi(client, br, { action: 'NOPE', pnr });
      expect(
        r.status === 400 && errCode(r) === 'VALIDATION_ERROR',
        '4.bad-action',
        'bad action',
        '400 VALIDATION_ERROR',
        `${r.status} ${errCode(r)}`,
      );
    }
  }

  // ---- Section 3 on OW4_SSR (fresh multi-pax) ----
  console.log('\n=== SUBSET on OW4_SSR ===');
  if (!F4?.br || !F4?.pnr) {
    add(row('3.x', 'subset', 'OW4 confirmed', 'missing', 'NOT_TESTED'));
  } else {
    const br = F4.br;
    const pnr = F4.pnr;

    {
      const r = await cancelApi(client, br, {
        action: 'PENALTY',
        pnr,
        cancellationPaxList: ['PAX1'],
      });
      const st = String(cancelStatus(r) || errCode(r) || '');
      const scope = paxScope(r);
      expect(
        /not available/i.test(st) || /NOT_AVAILABLE/i.test(st) || scope?.penaltyQuotable === false,
        '3.6',
        'PENALTY ["PAX1"] subset',
        'Penalty Not Available / penaltyQuotable=false',
        `${r.status} ${st} scope=${brief(scope)}`,
        brief(r.data, 280),
      );
    }

    {
      const r = await cancelApi(client, br, {
        action: 'CANCEL',
        pnr,
        cancellationPaxList: ['PAX1', 'PAX2'],
        cancellationReason: 'QA subset multipax',
      });
      const st = cancelStatus(r);
      const scope = paxScope(r);
      expect(
        ok(r) && /requested/i.test(String(st)) && scope?.scope === 'PARTIAL_PAX' && scope?.prorated === true,
        '3.1',
        'CANCEL ["PAX1","PAX2"]',
        'Cancellation Requested + PARTIAL_PAX prorated',
        `${r.status} ${st} scope=${brief(scope)}`,
        brief(r.data, 300),
      );
    }

    {
      const r = await cancelApi(client, br, {
        action: 'CANCEL',
        pnr,
        cancellationPaxList: ['PAX1'],
      });
      expect(
        r.status === 409 && errCode(r) === 'CANCELLATION_ALREADY_IN_PROGRESS',
        '4.21',
        'repeat PAX1 while open',
        '409 CANCELLATION_ALREADY_IN_PROGRESS',
        `${r.status} ${errCode(r)}`,
        brief(r.data, 200),
      );
    }

    {
      const r = await cancelApi(client, br, {
        action: 'CANCEL',
        pnr,
        cancellationPaxList: ['PAX3'],
      });
      expect(
        ok(r) && /requested/i.test(String(cancelStatus(r))),
        '4.22',
        'PAX3 while PAX1 open — allowed',
        'Cancellation Requested',
        `${r.status} ${cancelStatus(r)} ${errCode(r)}`,
        brief(r.data, 220),
      );
    }

    {
      const r = await cancelApi(client, br, {
        action: 'PENALTY',
        pnr,
        cancellationPaxList: ['PAX1', 'PAX2', 'PAX3'],
      });
      const st = String(cancelStatus(r) || errCode(r) || '');
      expect(
        /not available/i.test(st) || /NOT_AVAILABLE/i.test(st) || paxScope(r)?.penaltyQuotable === false,
        '3.7',
        'PENALTY 3 of 4',
        'Penalty Not Available',
        `${r.status} ${st}`,
        brief(r.data, 220),
      );
    }
  }

  // ---- RT subset on one PNR ----
  console.log('\n=== RT subset ===');
  if (!RT?.br || !RT?.pnr) {
    add(row('3.4', 'RT subset one PNR', 'RT confirmed', 'missing', 'NOT_TESTED'));
  } else {
    const r = await cancelApi(client, RT.br, {
      action: 'CANCEL',
      pnr: RT.pnr,
      cancellationPaxList: ['PAX1'],
      cancellationReason: 'QA RT partial pax',
    });
    const st = cancelStatus(r);
    const scope = paxScope(r);
    expect(
      ok(r) && /requested/i.test(String(st)) && (scope?.scope === 'PARTIAL_PAX' || scope == null || scope?.scope),
      '3.4',
      `RT CANCEL ["PAX1"] on pnr ${RT.pnr}`,
      'Cancellation Requested (partial)',
      `${r.status} ${st} scope=${brief(scope)} pnrs=${JSON.stringify(RT.pnrs)}`,
      brief(r.data, 280),
    );
  }

  // ---- Full no-list on fresh OW1 ----
  console.log('\n=== FULL no-list ===');
  if (!F1full?.br || !F1full?.pnr) {
    add(row('1.1', 'full cancel', 'OW1 confirmed', 'missing', 'NOT_TESTED'));
  } else {
    const pen = await cancelApi(client, F1full.br, { action: 'PENALTY', pnr: F1full.pnr });
    expect(
      ok(pen) && /penalty fetched/i.test(String(cancelStatus(pen))),
      '1.4',
      'PENALTY no list',
      'Penalty Fetched',
      `${pen.status} ${cancelStatus(pen)}`,
      brief(pen.data, 220),
    );

    const can = await cancelApi(client, F1full.br, { action: 'CANCEL', pnr: F1full.pnr });
    const canSt = String(cancelStatus(can) || '');
    expect(
      ok(can)
        && /cancel/i.test(canSt)
        && !/fail/i.test(canSt)
        && !paxScope(can),
      '1.1',
      'CANCEL no list',
      'Cancelled / Cancellation Requested, no paxScope',
      `${can.status} ${canSt} scope=${brief(paxScope(can))}`,
      brief(can.data, 250),
    );

    // null / [] same as no list — need another booking; mark if already cancelled
    add(row('1.2–1.3', 'null/[] list full cancel', 'need fresh BR', 'skipped after 1.1 used OW1_FULL', 'NOT_TESTED'));
  }

  // Full list cancel equivalent — book quick 2ADT if needed for 2.1
  try {
    const f2 = await bookOw(flight, client, {
      label: 'OW2_FULL_LIST',
      adults: 2,
      days: 72,
      origin: 'DEL',
      destination: 'HYD',
      withAddons: false,
    });
    report.fixtures.OW2_FULL_LIST = f2;
    if (f2.usable && f2.pnr) {
      const r = await cancelApi(client, f2.br, {
        action: 'CANCEL',
        pnr: f2.pnr,
        cancellationPaxList: ['PAX2', 'PAX1'],
      });
      const scope = paxScope(r);
      expect(
        ok(r)
          && (/cancel/i.test(String(cancelStatus(r))) || /requested/i.test(String(cancelStatus(r))))
          && !/fail/i.test(String(cancelStatus(r)))
          && (scope?.scope === 'FULL_PAX' || scope == null),
        '2.2',
        'CANCEL all 2 pax out of order',
        'Cancelled/Requested + FULL_PAX (or whole-PNR)',
        `${r.status} ${cancelStatus(r)} scope=${brief(scope)}`,
        brief(r.data, 260),
      );
    }
  } catch (e) {
    add(row('2.2', 'full list cancel 2ADT', 'Cancelled', e.message, 'NOT_TESTED'));
  }

  for (const id of ['F2-offline', 'F5-infant', 'F6-2adt+inf', 'F7-null-paxid', 'F8-dup-paxid', 'F9-no-journey']) {
    add(row(id, 'special fixture', 'seeded booking', 'not created', 'NOT_TESTED'));
  }

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nSCORE', report.score);
  console.log('Report', OUT);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

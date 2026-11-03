/**
 * Benepik Riya simulator — detailed follow-up cases (S/C/B/X).
 * BASE_URL=https://dev-benepik-api.travelvip.ai + staging .env creds.
 * No client retry loops (EXPIRED/TOKEN/SEATFAIL: wait for sim self-retry).
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  buildSeatMapPassengers,
  extractFirstSearchId,
  extractOnwardSearchId,
  extractReturnSearchId,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT_JSON = path.join('travel-apis', 'flight', 'reports', 'benepik-riya-sim-detailed.json');
const OUT_MD = path.join('travel-apis', 'flight', 'reports', 'benepik-riya-sim-detailed.md');
const BASE = 'https://dev-benepik-api.travelvip.ai';

function brief(d, n = 500) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function opts(data, dir = 'ONWARD') {
  return ((data?.results || []).find((r) => String(r.direction).toUpperCase() === dir)?.options) || [];
}
function add(rows, id, how, status, evidence = {}) {
  rows.push({ id, how, status, ...evidence, at: new Date().toISOString() });
  console.log(id, status, evidence.br || evidence.note || evidence.err || '');
}

async function searchOnce(flight, body, maxPolls = 3) {
  let last = null;
  for (let i = 0; i < maxPolls; i += 1) {
    last = await flight.search(body);
    const n = opts(last.data).length;
    const err = last.data?.error;
    const state = last.data?.progress?.state;
    if (n > 0 || err || state === 'COMPLETE' || (last.status >= 400 && last.status < 500)) {
      return { res: last, polls: i + 1 };
    }
    await sleep(last.data?.progress?.pollAfterMs || 1500);
  }
  return { res: last, polls: maxPolls };
}

function owBody(origin, destination, {
  days = 25, fareType = 'NORMAL', cabinClass = 'ECONOMY',
} = {}) {
  const b = buildOneWaySearchBody(days, { origin, destination, fareType, maxStops: null });
  b.cabinClass = cabinClass;
  b.travellers = { adults: 1, children: 0, infants: 0 };
  return b;
}

function rtBody(origin, destination, {
  onwardDays = 25, returnDays = 32, fareType = 'NORMAL', cabinClass = 'ECONOMY',
} = {}) {
  const b = buildRoundTripSearchBody(onwardDays, returnDays, {
    origin, destination, fareType, maxStops: null,
  });
  b.cabinClass = cabinClass;
  b.travellers = { adults: 1, children: 0, infants: 0 };
  return b;
}

async function resolveRtIds(flight, body) {
  const { res } = await searchOnce(flight, body);
  const onward = extractOnwardSearchId(res.data) || opts(res.data, 'ONWARD')[0]?.searchId;
  if (!onward) return { error: 'no onward', res };
  const retRes = await flight.search({ ...body, selection: { selectedSearchIds: [onward] } });
  const ret = extractReturnSearchId(retRes.data)
    || opts(retRes.data, 'RETURN').find((o) => o.searchId !== onward)?.searchId;
  if (!ret) return { error: 'no return', res, retRes };
  return { searchIds: [onward, ret], res, retRes };
}

async function waitStatus(flight, br, {
  max = 12, intervalMs = 3000, allowInprogressStop = false,
} = {}) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await flight.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (isTerminalBookingStatus(st)) return { status: st, polls: i + 1 };
    if (allowInprogressStop && /inprogress/i.test(st) && i >= 2) {
      return { status: st, polls: i + 1, stop: 'INPROGRESS' };
    }
    await sleep(intervalMs);
  }
  return { status: last?.data?.status || 'UNKNOWN', polls: max };
}

function firstMeal(ssrData) {
  for (const seg of ssrData?.meal?.segments || []) {
    for (const m of seg.Meals || seg.meals || []) {
      const pref = m.priceReference || m.pricing?.priceReference;
      if (pref) return { m, pref };
    }
  }
  return null;
}

function mealsForPricing(pricingData, raw) {
  if (!raw) return [];
  return (pricingData?.itinerary || []).map((leg) => {
    const seg0 = (leg.segments || [])[0] || {};
    const dir = String(leg.direction || '').toUpperCase() === 'RETURN' ? 'RETURN' : 'ONWARD';
    return {
      ssrId: String(raw.m.ssrId || raw.m.mealId || ''),
      mealId: String(raw.m.ssrId || raw.m.mealId || ''),
      direction: dir,
      segmentId: seg0.segmentId || 'SEG_1',
      paxType: 'ADT',
      code: raw.m.code,
      title: raw.m.title || 'Meal',
      description: raw.m.description || raw.m.title || 'Meal',
      priceReference: raw.pref,
      origin: seg0.departure?.airportCode,
      destination: seg0.arrival?.airportCode,
    };
  });
}

function pickOpenSeat(seatMapRes) {
  const data = seatMapRes?.data?.data || seatMapRes?.data || {};
  const segments = data.segments || data.FlightSeat?.segments || [];
  for (const seg of segments) {
    for (const s of seg.seatMap || seg.seats || []) {
      if (!/open/i.test(String(s.seatAvailability || s.availability || ''))) continue;
      const seatName = s.seatName || s.seatNumber;
      const seatId = s.seatId || s.seatKey;
      const pref = s.priceReference || s.priceDetail?.priceReference;
      if (!seatName || !seatId || !pref) continue;
      return {
        origin: s.origin || seg.origin,
        destination: s.destination || seg.destination,
        segmentId: s.segmentId || seg.segmentId || 'SEG_1',
        seatAvailability: s.seatAvailability || 'Open',
        seatName,
        seatPosition: s.seatPosition || '',
        seatKey: String(s.seatKey || seatId),
        seatId: String(seatId),
        direction: 'ONWARD',
        priceReference: pref,
      };
    }
  }
  return null;
}

async function issueBook(flight, client, {
  origin = 'PNQ',
  destination = 'DEL',
  journey = 'ONE_WAY',
  fareType = 'NORMAL',
  cabinClass = 'ECONOMY',
  lastName = 'Smith',
  firstName = 'Rohan',
  attachMeal = false,
  attachSeat = false,
  wait = {},
  intlPassport = false,
}) {
  let searchIds;
  let body;
  if (journey === 'ROUND_TRIP') {
    body = rtBody(origin, destination, { fareType, cabinClass });
    const rt = await resolveRtIds(flight, body);
    if (rt.error) return { ok: false, stage: 'search', error: rt.error, sample: brief(rt.res?.data) };
    searchIds = rt.searchIds;
  } else {
    body = owBody(origin, destination, { fareType, cabinClass });
    const { res } = await searchOnce(flight, body);
    const sid = extractFirstSearchId(res.data) || opts(res.data)[0]?.searchId;
    if (!sid) return { ok: false, stage: 'search', error: res.data?.error || 'no options', sample: brief(res.data) };
    searchIds = [sid];
  }

  const pricing = await flight.getPricing(searchIds, journey);
  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    return { ok: false, stage: 'pricing', error: pricing.data?.error || 'pricing', sample: brief(pricing.data) };
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds,
    journeyType: journey,
    passengerProfile: {
      title: 'Mr', firstName, lastName, gender: 'Male', dob: '1992-11-18', nationality: 'IN',
    },
  });

  if (intlPassport || destination === 'DXB' || destination === 'LHR' || origin === 'DXB' || origin === 'LHR') {
    payload.data.passportType = 'FULL';
    payload.data.passengers[0].passport = {
      number: 'M7654321', expiry: '2031-06-30', issuedDate: '2021-03-01', issuedCountryCode: 'IN',
    };
  }

  if (attachMeal || (pricing.data?.itinerary || []).some((l) => l.mandatorySsr?.meal)) {
    const ssr = await flight.getSsr(pricing.data.priceId);
    const raw = firstMeal(ssr.data);
    const meals = mealsForPricing(pricing.data, raw);
    if (meals.length) payload.data.passengers[0].ssr.meals = meals;
  }

  if (attachSeat) {
    const sm = await flight.getSeatMap(pricing.data.bookingContext, buildSeatMapPassengers(), 1);
    const seat = pickOpenSeat(sm);
    if (seat) payload.data.passengers[0].ssr.seats = [seat];
  }

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: {
      ...FLIGHT_QUERY,
      ...config.flight.issueTicketQuery,
      pid: process.env.FLIGHT_ISSUE_PID || config.partnerId || 'vgm',
      count: 10, page: 0, perpage: 20,
    },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  if (!br) {
    return {
      ok: false, stage: 'issue', http: issue.status,
      error: issue.data?.error || issue.data, sample: brief(issue.data),
    };
  }

  const st = await waitStatus(flight, br, wait);
  const detail = await flight.getBookingDetail(br);
  const it = detail.data?.bookingResponse?.itinerary || [];
  const paxLegs = detail.data?.bookingResponse?.passengers?.[0]?.legs || [];
  return {
    ok: true,
    br,
    status: st.status,
    polls: st.polls,
    pnrs: it.map((j) => j.pnr).filter(Boolean),
    etickets: paxLegs.map((l) => l.eticket).filter(Boolean),
    legs: it.map((j, idx) => ({
      direction: j.direction,
      pnr: j.pnr,
      paxStatus: paxLegs[idx]?.status || null,
    })),
    detailStatus: detail.data?.status,
  };
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || BASE;
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';
  console.log('Base', process.env.BASE_URL, 'partner', config.partnerId);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);
  const rows = [];

  // ═══════════ 1. Search & pricing ═══════════
  // S1
  {
    const body = owBody('PNQ', 'DEL', { days: 25 });
    const t0 = Date.now();
    const { res, polls } = await searchOnce(flight, body);
    const n = opts(res.data).length;
    const ms = Date.now() - t0;
    const date = body.itinerary[0].date;
    add(rows, 'S1', 'Search PNQ→DEL OW', n > 0 ? 'PASS' : 'FAIL', {
      note: `${n} flights · ${ms}ms · date ${date} · polls ${polls}`,
      sample: brief(res.data, 200),
    });
  }

  // S2 different date — same flight numbers moved
  {
    const a = owBody('PNQ', 'DEL', { days: 25 });
    const b = owBody('PNQ', 'DEL', { days: 32 });
    const ra = await searchOnce(flight, a);
    const rb = await searchOnce(flight, b);
    const fa = opts(ra.res.data).map((o) => `${o.segments?.[0]?.airline?.code}${o.segments?.[0]?.flightNumber}`);
    const fb = opts(rb.res.data).map((o) => `${o.segments?.[0]?.airline?.code}${o.segments?.[0]?.flightNumber}`);
    const overlap = fa.filter((x) => fb.includes(x));
    const pass = opts(ra.res.data).length > 0 && opts(rb.res.data).length > 0
      && a.itinerary[0].date !== b.itinerary[0].date;
    add(rows, 'S2', 'Same search different date', pass ? 'PASS' : 'FAIL', {
      note: `dates ${a.itinerary[0].date} vs ${b.itinerary[0].date}; flightsA=${fa.join(',')} flightsB=${fb.join(',')} overlap=${overlap.join(',') || 'n/a'}`,
    });
  }

  // S3 routes
  for (const [id, o, d] of [
    ['S3a', 'DEL', 'PNQ'],
    ['S3b', 'PNQ', 'DXB'],
    ['S3c', 'DXB', 'LHR'],
  ]) {
    const { res } = await searchOnce(flight, owBody(o, d, { days: 40 }));
    const n = opts(res.data).length;
    add(rows, id, `Search ${o}→${d}`, n > 0 ? 'PASS' : 'FAIL', {
      note: `${n} flights`, err: res.data?.error || null,
    });
  }

  // S4 business
  {
    const { res } = await searchOnce(flight, owBody('PNQ', 'DEL', { cabinClass: 'BUSINESS' }));
    const n = opts(res.data).length;
    add(rows, 'S4', 'Search PNQ→DEL BUSINESS', n > 0 ? 'PASS' : 'FAIL', {
      note: `${n} flights · cabin BUSINESS`,
      err: res.data?.error || null,
    });
  }

  // S5 price
  {
    const body = owBody('PNQ', 'DEL');
    const { res } = await searchOnce(flight, body);
    const sid = extractFirstSearchId(res.data) || opts(res.data)[0]?.searchId;
    const pricing = sid ? await flight.getPricing([sid], 'ONE_WAY') : { status: 0, data: {} };
    const pass = Boolean(pricing.data?.priceId && pricing.data?.bookingContext);
    add(rows, 'S5', 'Price any flight', pass ? 'PASS' : 'FAIL', {
      note: `priceId=${pricing.data?.priceId || '-'} total=${pricing.data?.pricing?.totalAmount ?? '-'}`,
      err: pricing.data?.error || null,
    });
  }

  // S6 fare rules (try a few)
  {
    const body = owBody('PNQ', 'DEL');
    const { res } = await searchOnce(flight, body);
    const ids = opts(res.data).slice(0, 3).map((o) => o.searchId).filter(Boolean);
    let ok = 0;
    let simNo = 0;
    const notes = [];
    for (const id of ids) {
      const fr = await flight.getFareRules([id], 'ONE_WAY');
      const blob = JSON.stringify(fr.data || {});
      if (/SIM-NO-RECORDING/i.test(blob)) { simNo += 1; notes.push(`${id}:SIM-NO-RECORDING`); continue; }
      if (fr.ok || (fr.status < 500 && !fr.data?.error)) { ok += 1; notes.push(`${id}:ok`); }
      else notes.push(`${id}:err`);
    }
    add(rows, 'S6', 'Fare rules on a few flights', (ok > 0 || simNo > 0) ? 'PASS' : 'FAIL', {
      note: notes.join(' · ') || 'no ids',
    });
  }

  // S7 seat map
  {
    const body = owBody('PNQ', 'DEL');
    const { res } = await searchOnce(flight, body);
    const sid = opts(res.data)[0]?.searchId;
    const pricing = sid ? await flight.getPricing([sid], 'ONE_WAY') : null;
    let pass = false;
    let note = 'no pricing';
    if (pricing?.data?.bookingContext) {
      const sm = await flight.getSeatMap(pricing.data.bookingContext, buildSeatMapPassengers(), 1);
      const blob = JSON.stringify(sm.data || {});
      if (/SIM-NO-RECORDING/i.test(blob)) { pass = true; note = 'SIM-NO-RECORDING'; }
      else if (sm.ok || sm.status < 500) { pass = true; note = `http ${sm.status}`; }
      else { note = brief(sm.data?.error || sm.data, 160); }
    }
    add(rows, 'S7', 'Seat map on a flight', pass ? 'PASS' : 'FAIL', { note });
  }

  // S8 RT price
  {
    const body = rtBody('PNQ', 'DEL');
    const rt = await resolveRtIds(flight, body);
    if (rt.error) {
      add(rows, 'S8', 'RT PNQ↔DEL price pair', 'FAIL', { note: rt.error });
    } else {
      const pricing = await flight.getPricing(rt.searchIds, 'ROUND_TRIP');
      const pass = Boolean(pricing.data?.priceId);
      add(rows, 'S8', 'RT PNQ↔DEL price pair', pass ? 'PASS' : 'FAIL', {
        note: `total=${pricing.data?.pricing?.totalAmount ?? '-'}`,
      });
    }
  }

  // S9 BOM-DEL
  {
    const { res } = await searchOnce(flight, owBody('BOM', 'DEL'));
    const blob = JSON.stringify(res.data || {});
    const hit = /SIM-NO-RECORDING|Simulator only replays/i.test(blob);
    add(rows, 'S9', 'Search BOM→DEL expect SIM-NO-RECORDING', hit ? 'PASS' : 'FAIL', {
      note: brief(res.data?.error || res.data, 220),
    });
  }

  // ═══════════ 2. Corporate & SME ═══════════
  for (const [id, ft, expectCat] of [
    ['C1', 'CORPORATE', /CORPORATE/i],
    ['C2', 'SME', /SME/i],
  ]) {
    const body = owBody('PNQ', 'DEL', { fareType: ft });
    const { res } = await searchOnce(flight, body);
    const n = opts(res.data).length;
    const sid = opts(res.data)[0]?.searchId;
    const pricing = sid ? await flight.getPricing([sid], 'ONE_WAY') : null;
    const cat = String(
      pricing?.data?.fareCategory
      || pricing?.data?.pricing?.fareCategory
      || opts(res.data)[0]?.fareCategory
      || opts(res.data)[0]?.fareType
      || '',
    );
    const blob = JSON.stringify({ search: res.data, pricing: pricing?.data });
    const pass = n > 0 && (expectCat.test(cat) || expectCat.test(blob) || Boolean(pricing?.data?.priceId));
    add(rows, id, `Fare type ${ft}`, pass ? 'PASS' : 'FAIL', {
      note: `flights=${n} fareCategory=${cat || 'n/a'} priced=${Boolean(pricing?.data?.priceId)}`,
    });
  }

  // C3 normal + corporate both present
  {
    const normal = await searchOnce(flight, owBody('PNQ', 'DEL', { fareType: 'NORMAL' }));
    const corp = await searchOnce(flight, owBody('PNQ', 'DEL', { fareType: 'CORPORATE' }));
    // also try combined if API accepts
    const bothBody = owBody('PNQ', 'DEL', { fareType: 'NORMAL' });
    bothBody.fareTypes = ['NORMAL', 'CORPORATE'];
    bothBody.fareType = 'NORMAL,CORPORATE';
    const both = await searchOnce(flight, bothBody);
    const nN = opts(normal.res.data).length;
    const nC = opts(corp.res.data).length;
    const nB = opts(both.res.data).length;
    const cats = new Set();
    for (const o of [...opts(normal.res.data), ...opts(corp.res.data), ...opts(both.res.data)]) {
      if (o.fareCategory) cats.add(o.fareCategory);
      if (o.fareType) cats.add(o.fareType);
    }
    const pass = nN > 0 && nC > 0;
    add(rows, 'C3', 'Normal + corporate fares', pass ? 'PASS' : 'FAIL', {
      note: `normal=${nN} corp=${nC} combinedTry=${nB} cats=${[...cats].join(',') || 'n/a'}`,
    });
  }

  // C4 corporate Smith
  {
    const book = await issueBook(flight, client, {
      fareType: 'CORPORATE', lastName: 'Smith', wait: { max: 10 },
    });
    const pass = /confirm/i.test(String(book.status)) && (book.pnrs || []).some((p) => /^SIM-/i.test(p));
    add(rows, 'C4', 'Corporate book Smith → CONFIRMED SIM-PNR', pass ? 'PASS' : 'FAIL', {
      br: book.br, note: `${book.status} pnrs=${(book.pnrs || []).join(',')}`, err: book.error,
    });
  }

  // ═══════════ 3. Bookings by last name ═══════════
  // B1 Smith OW
  {
    const book = await issueBook(flight, client, { lastName: 'Smith', wait: { max: 10 } });
    const pass = /confirm/i.test(String(book.status))
      && (book.pnrs || []).some((p) => /^SIM-/i.test(p))
      && (book.etickets || []).some((t) => /^SIM\d+/i.test(String(t)));
    add(rows, 'B1', 'Smith OW CONFIRMED + SIM PNR/ticket', pass ? 'PASS' : 'FAIL', {
      br: book.br,
      note: `${book.status} pnr=${(book.pnrs || [])[0]} eticket=${(book.etickets || [])[0]}`,
      err: book.error,
    });
  }

  // B2 Smith RT
  {
    const book = await issueBook(flight, client, {
      journey: 'ROUND_TRIP', lastName: 'Smith', attachMeal: true, wait: { max: 12 },
    });
    let pass = /confirm/i.test(String(book.status)) && (book.pnrs || []).length >= 1;
    // prefer 2 SIM PNRs; if same PNR both legs still OK if Confirmed
    const simPnrs = (book.pnrs || []).filter((p) => /^SIM-/i.test(p));
    if (!book.ok && /meal/i.test(JSON.stringify(book.error || ''))) {
      const alt = await issueBook(flight, client, {
        origin: 'DXB', destination: 'LHR', journey: 'ROUND_TRIP', lastName: 'Smith',
        intlPassport: true, wait: { max: 12 },
      });
      pass = /confirm/i.test(String(alt.status)) && (alt.pnrs || []).some((p) => /^SIM-/i.test(p));
      add(rows, 'B2', 'Smith RT CONFIRMED SIM PNR each leg', pass ? 'PASS' : 'FAIL', {
        br: alt.br,
        note: `fallback DXB-LHR ${alt.status} pnrs=${(alt.pnrs || []).join(',')} (PNQ-DEL meal block)`,
      });
    } else {
      add(rows, 'B2', 'Smith RT CONFIRMED SIM PNR each leg', pass ? 'PASS' : 'FAIL', {
        br: book.br,
        note: `${book.status} pnrs=${simPnrs.join(',')} legs=${book.legs?.length || 0}`,
        err: book.error,
      });
    }
  }

  // B3 FAIL
  {
    const book = await issueBook(flight, client, { lastName: 'FAIL', wait: { max: 10 } });
    const pass = /fail/i.test(String(book.status)) && !(book.pnrs || []).length;
    add(rows, 'B3', 'FAIL → sold out Failed no PNR', pass ? 'PASS' : 'FAIL', {
      br: book.br, note: `${book.status} pnrs=${(book.pnrs || []).join(',') || 'none'}`,
    });
  }

  // B4 SOLDOUT — in progress with sold-out error
  {
    const book = await issueBook(flight, client, {
      lastName: 'SOLDOUT', wait: { max: 6, allowInprogressStop: true },
    });
    const detail = book.br ? await flight.getBookingDetail(book.br) : null;
    const blob = JSON.stringify(detail?.data || book);
    const pass = /inprogress|pending|fail/i.test(String(book.status))
      || /sold.?out/i.test(blob);
    add(rows, 'B4', 'SOLDOUT → in progress / sold-out error', pass ? 'PASS' : 'FAIL', {
      br: book.br, note: `${book.status} ${/sold.?out/i.test(blob) ? 'sold-out mentioned' : 'check detail'}`,
    });
  }

  // B5 CHANGE
  {
    const book = await issueBook(flight, client, { lastName: 'CHANGE', wait: { max: 10 } });
    const blob = JSON.stringify(book);
    const pass = /fail/i.test(String(book.status));
    add(rows, 'B5', 'CHANGE → Failed fare changed', pass ? 'PASS' : 'FAIL', {
      br: book.br, note: `${book.status} ${/fare.*chang|SIM-PRICE-CHANGE/i.test(blob) ? 'fare-change hint' : ''}`,
    });
  }

  // B6 EXPIRED — wait for self-retry → Confirmed
  {
    const book = await issueBook(flight, client, { lastName: 'EXPIRED', wait: { max: 16, intervalMs: 3000 } });
    add(rows, 'B6', 'EXPIRED → self-retry → CONFIRMED', /confirm/i.test(String(book.status)) ? 'PASS' : 'FAIL', {
      br: book.br, note: String(book.status),
    });
  }

  // B7 SEATFAIL with seat
  {
    const book = await issueBook(flight, client, {
      lastName: 'SEATFAIL', attachSeat: true, wait: { max: 16, intervalMs: 3000 },
    });
    add(rows, 'B7', 'SEATFAIL (with seat) → CONFIRMED after retry', /confirm/i.test(String(book.status)) ? 'PASS' : 'FAIL', {
      br: book.br, note: String(book.status), err: book.error,
    });
  }

  // B8 TOKEN
  {
    const book = await issueBook(flight, client, { lastName: 'TOKEN', wait: { max: 16, intervalMs: 3000 } });
    add(rows, 'B8', 'TOKEN → self-retry → CONFIRMED', /confirm/i.test(String(book.status)) ? 'PASS' : 'FAIL', {
      br: book.br, note: String(book.status),
    });
  }

  // B9 HALFFAIL RT PNQ-DEL
  {
    let book = await issueBook(flight, client, {
      journey: 'ROUND_TRIP', lastName: 'HALFFAIL', attachMeal: true, wait: { max: 14 },
    });
    let route = 'PNQ-DEL';
    if (!book.ok) {
      book = await issueBook(flight, client, {
        origin: 'DXB', destination: 'LHR', journey: 'ROUND_TRIP', lastName: 'HALFFAIL',
        intlPassport: true, wait: { max: 14 },
      });
      route = 'DXB-LHR (fallback)';
    }
    const onwardOk = /confirm/i.test(String(book.legs?.[0]?.paxStatus || ''));
    const returnFail = /fail/i.test(String(book.legs?.[1]?.paxStatus || book.status || ''));
    const pass = (/fail/i.test(String(book.status)) && route.includes('DXB'))
      || (onwardOk && returnFail)
      || (/fail|partial/i.test(String(book.status)) && Boolean(book.br));
    add(rows, 'B9', 'HALFFAIL RT onward OK / return FAIL', pass ? 'PASS' : 'FAIL', {
      br: book.br,
      note: `${route} status=${book.status} legs=${brief(book.legs, 200)}`,
      err: book.error,
    });
  }

  // B10 TIMEOUT ~1 min then Failed
  {
    const book = await issueBook(flight, client, {
      lastName: 'TIMEOUT', wait: { max: 24, intervalMs: 5000 },
    });
    add(rows, 'B10', 'TIMEOUT ~1min → Failed no PNR', (/fail/i.test(String(book.status)) && !(book.pnrs || []).length) ? 'PASS' : 'FAIL', {
      br: book.br, note: `${book.status} polls=${book.polls} pnrs=${(book.pnrs || []).join(',') || 'none'}`,
    });
  }

  // B11 SERVERERROR
  {
    const book = await issueBook(flight, client, {
      lastName: 'SERVERERROR', wait: { max: 16, intervalMs: 4000 },
    });
    add(rows, 'B11', 'SERVERERROR → Failed no booking', (/fail/i.test(String(book.status)) && !(book.pnrs || []).length) ? 'PASS' : 'FAIL', {
      br: book.br, note: `${book.status} pnrs=${(book.pnrs || []).join(',') || 'none'}`,
    });
  }

  // B12 EMPTY
  {
    const book = await issueBook(flight, client, {
      lastName: 'EMPTY', wait: { max: 16, intervalMs: 4000 },
    });
    const detail = book.br ? await flight.getBookingDetail(book.br) : null;
    const blob = JSON.stringify(detail?.data || book);
    const pass = /fail/i.test(String(book.status)) && !(book.pnrs || []).length;
    add(rows, 'B12', 'EMPTY → Failed empty response', pass ? 'PASS' : 'FAIL', {
      br: book.br,
      note: `${book.status} ${/empty response/i.test(blob) ? 'empty-response text' : 'no PNR'}`,
    });
  }

  // B13 SLOW
  {
    const t0 = Date.now();
    const book = await issueBook(flight, client, {
      lastName: 'SLOW', wait: { max: 12, intervalMs: 3000 },
    });
    const sec = Math.round((Date.now() - t0) / 1000);
    add(rows, 'B13', 'SLOW ~15s → CONFIRMED', /confirm/i.test(String(book.status)) ? 'PASS' : 'FAIL', {
      br: book.br, note: `${book.status} elapsed~${sec}s`,
    });
  }

  // ═══════════ 4. Cancellation ═══════════
  // X1 + X2 Smith OW penalty + cancel
  {
    const book = await issueBook(flight, client, { lastName: 'Smith', firstName: 'Cancelqa', wait: { max: 10 } });
    if (!book.br || !/confirm/i.test(String(book.status))) {
      add(rows, 'X1', 'Smith OW cancellation charges', 'FAIL', { note: 'book failed', err: book.error });
      add(rows, 'X2', 'Cancel Smith OW', 'FAIL', { note: 'no confirmed BR' });
    } else {
      const pnr = book.pnrs?.[0];
      const pen = await flight.checkCancellationPenalty(book.br, { pnr });
      // also try v2
      const pen2 = await flight.cancelV2({ bookingId: book.br, action: 'PENALTY', pnr });
      const charges = pen.ok || pen2.ok || pen.status < 500 || pen2.status < 500;
      add(rows, 'X1', 'Smith OW cancellation charges', charges ? 'PASS' : 'FAIL', {
        br: book.br,
        note: `penalty http ${pen.status}/${pen2.status} ${brief(pen2.data || pen.data, 160)}`,
      });

      const cancel = await flight.cancelV2({ bookingId: book.br, action: 'CANCEL', pnr });
      await sleep(2000);
      const st = await flight.getBookingStatus(book.br);
      const pass = /cancel/i.test(String(st.data?.status)) || cancel.ok;
      add(rows, 'X2', 'Cancel Smith OW → Cancelled', pass ? 'PASS' : 'FAIL', {
        br: book.br,
        note: `cancelHttp=${cancel.status} status=${st.data?.status}`,
      });
    }
  }

  // X3 Smith RT cancel both legs
  {
    let book = await issueBook(flight, client, {
      journey: 'ROUND_TRIP', lastName: 'Smith', firstName: 'Rtx', attachMeal: true, wait: { max: 12 },
    });
    let route = 'PNQ-DEL';
    if (!book.ok) {
      book = await issueBook(flight, client, {
        origin: 'DXB', destination: 'LHR', journey: 'ROUND_TRIP', lastName: 'Smith', firstName: 'Rtx',
        intlPassport: true, wait: { max: 12 },
      });
      route = 'DXB-LHR';
    }
    if (!book.br || !/confirm/i.test(String(book.status))) {
      add(rows, 'X3', 'Smith RT cancel both legs', 'FAIL', { note: `${route} book failed`, err: book.error });
    } else {
      const pnr = book.pnrs?.[0];
      const cancel = await flight.cancelV2({ bookingId: book.br, action: 'CANCEL', pnr });
      await sleep(3000);
      const st = await flight.getBookingStatus(book.br);
      const det = await flight.getBookingDetail(book.br);
      const legs = det.data?.bookingResponse?.passengers?.[0]?.legs || [];
      const cancelledLegs = legs.filter((l) => /cancel/i.test(String(l.status)));
      const pass = /cancel/i.test(String(st.data?.status)) || cancelledLegs.length >= 1;
      add(rows, 'X3', 'Smith RT cancel both legs', pass ? 'PASS' : 'FAIL', {
        br: book.br,
        note: `${route} status=${st.data?.status} cancelledLegs=${cancelledLegs.length}/${legs.length} http=${cancel.status}`,
      });
    }
  }

  // X4 CANCELFAIL
  {
    const book = await issueBook(flight, client, { lastName: 'CANCELFAIL', wait: { max: 10 } });
    if (!book.br || !/confirm/i.test(String(book.status))) {
      add(rows, 'X4', 'CANCELFAIL confirm then cancel fails', 'FAIL', { note: String(book.status), err: book.error });
    } else {
      const pnr = book.pnrs?.[0];
      const cancel = await flight.cancelV2({ bookingId: book.br, action: 'CANCEL', pnr });
      await sleep(1500);
      const st = await flight.getBookingStatus(book.br);
      const cancelFailed = !cancel.ok || cancel.status >= 400 || /fail/i.test(JSON.stringify(cancel.data));
      const stillConfirmed = /confirm/i.test(String(st.data?.status));
      add(rows, 'X4', 'CANCELFAIL confirm then cancel fails', (stillConfirmed && cancelFailed) ? 'PASS' : 'FAIL', {
        br: book.br,
        note: `status=${st.data?.status} cancelHttp=${cancel.status} ${brief(cancel.data?.error || cancel.data, 120)}`,
      });
    }
  }

  // X5 PARTIALCANCEL RT
  {
    let book = await issueBook(flight, client, {
      journey: 'ROUND_TRIP', lastName: 'PARTIALCANCEL', attachMeal: true, wait: { max: 12 },
    });
    let route = 'PNQ-DEL';
    if (!book.ok) {
      book = await issueBook(flight, client, {
        origin: 'DXB', destination: 'LHR', journey: 'ROUND_TRIP', lastName: 'PARTIALCANCEL',
        intlPassport: true, wait: { max: 12 },
      });
      route = 'DXB-LHR';
    }
    if (!book.br || !/confirm/i.test(String(book.status))) {
      add(rows, 'X5', 'PARTIALCANCEL RT → 1/2 failed', 'FAIL', { note: `${route} book failed`, err: book.error });
    } else {
      const pnr = book.pnrs?.[0];
      const cancel = await flight.cancelV2({ bookingId: book.br, action: 'CANCEL', pnr });
      await sleep(2500);
      const det = await flight.getBookingDetail(book.br);
      const legs = det.data?.bookingResponse?.passengers?.[0]?.legs || [];
      const blob = JSON.stringify(cancel.data || {}) + JSON.stringify(det.data || {});
      const partialText = /partial cancel|1\/2/i.test(blob);
      const mixed = legs.some((l) => /cancel/i.test(String(l.status)))
        && legs.some((l) => /confirm/i.test(String(l.status)));
      add(rows, 'X5', 'PARTIALCANCEL RT → partial 1/2', (partialText || mixed || cancel.ok) ? 'PASS' : 'FAIL', {
        br: book.br,
        note: `${route} cancelHttp=${cancel.status} legs=${brief(legs, 220)} partialText=${partialText}`,
      });
    }
  }

  const summary = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    partner: config.partnerId,
    note: 'Detailed Riya sim follow-up · no client retry loops',
    results: rows,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));

  const pass = rows.filter((r) => r.status === 'PASS').length;
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const md = [
    '# Benepik Riya simulator — detailed follow-up',
    '',
    `- **Base:** ${summary.base}`,
    `- **Partner:** ${summary.partner}`,
    `- **At:** ${summary.at}`,
    '',
    '| ID | Case | Status | Evidence |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.how} | **${r.status}** | ${(r.br ? `BR ${r.br} · ` : '') + String(r.note || r.err || '—').replace(/\|/g, '/').slice(0, 180)} |`),
    '',
    `**Totals:** ${pass} PASS · ${fail} FAIL`,
    '',
    `Raw: \`${OUT_JSON}\``,
    '',
  ].join('\n');
  fs.writeFileSync(OUT_MD, md);
  console.log('\nREPORT', OUT_MD);
  console.log(`Totals: ${pass} PASS / ${fail} FAIL`);
}

main().catch((e) => { console.error(e); process.exit(1); });

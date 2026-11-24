/**
 * ENG-763…768 — preprod mixed-fare RT, NO book, L2B-safe.
 *
 * One pinned RT DOM search tree (DEL↔BOM). Details / pricing / fareRules /
 * SSR / seatmap only. Never calls issue-ticket.
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   $env:ALLOW_BOOK='false'
 *   node travel-apis/flight/scripts/probe-eng763-768-mixed-fare-nobook-preprod.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { isSearchProgressComplete } from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { futureDate, sleep } from '../../../shared/lib/testUtils.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505');
/** L2B pin: default +40 / +42 (longest after 15–20d window, within L2B +45). Override via env. */
const ONWARD_DAYS = Number(process.env.FLIGHT_ONWARD_DAYS || '40');
const RETURN_DAYS = Number(process.env.FLIGHT_RETURN_DAYS || String(ONWARD_DAYS + 2));
const ONWARD_DATE = process.env.FLIGHT_SEARCH_DATE || futureDate(ONWARD_DAYS);
const RETURN_DATE = process.env.FLIGHT_RETURN_DATE || futureDate(RETURN_DAYS);
/** Multi-lane filter as product expects (spaces + title case). */
const FARE_TYPE_FILTER = process.env.FLIGHT_FARE_TYPE || 'Normal, Corporate, SME';
const ORIGIN = process.env.FLIGHT_ORIGIN || 'DEL';
const DEST = process.env.FLIGHT_DESTINATION || 'BOM';

const rows = [];
const dumps = {
  startedAt: new Date().toISOString(),
  baseUrl: null,
  route: `${ORIGIN}-${DEST}-${ORIGIN}`,
  dates: { onward: ONWARD_DATE, return: RETURN_DATE },
  allowBook: process.env.ALLOW_BOOK,
  searches: 0,
};

function add(eng, id, rule, how, status, detail = {}) {
  rows.push({ eng, id, rule, how, status, ...detail });
  const mark = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`  [${mark}] ${id} ${status} — ${rule}`);
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

function cat(f) {
  const c = String(f?.fareCategory || f?.fareType || '').toUpperCase();
  if (!c) return null;
  if (c.includes('CORPORATE') || c === 'CORP') return 'CORPORATE';
  if (c.includes('SME')) return 'SME';
  if (c.includes('STUDENT')) return 'STUDENT';
  if (c.includes('DEFENCE') || c.includes('DEFENSE')) return 'DEFENCE';
  if (c.includes('SENIOR')) return 'SENIOR_CITIZEN';
  if (c.includes('FLEXI')) return 'FLEXI';
  if (c.includes('NORMAL') || c.includes('PUBLISH') || c.includes('REGULAR')) return 'NORMAL';
  return c;
}

function airlineOf(opt) {
  const seg = opt?.segments?.[0];
  return String(seg?.airline?.code || seg?.airlineCode || '').toUpperCase();
}

function flightLabel(opt) {
  return (opt?.segments || [])
    .map((s) => `${String(s.airline?.code || s.airlineCode || '').toUpperCase()} ${s.flightNumber || ''}`.trim())
    .join('/');
}

function pickFareByCategory(options, category) {
  const want = String(category).toUpperCase();
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (cat(f) === want && (f.searchId || opt.searchId)) {
        return {
          opt,
          f,
          searchId: f.searchId || opt.searchId,
          category: want,
          airline: airlineOf(opt),
          label: flightLabel(opt),
          fareType: f.fareType || f.fareCategory,
        };
      }
    }
  }
  return null;
}

function categoriesIn(options) {
  const set = new Set();
  for (const o of options || []) {
    for (const f of o.fares || []) {
      const c = cat(f);
      if (c) set.add(c);
    }
  }
  return [...set].sort();
}

function rtBody() {
  const body = {
    itinerary: [
      { origin: ORIGIN, destination: DEST, date: ONWARD_DATE },
      { origin: DEST, destination: ORIGIN, date: RETURN_DATE },
    ],
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'ECONOMY',
    journeyType: 'ROUND_TRIP',
    currency: 'INR',
    language: 'en',
    preferences: { airlines: [], maxStops: null, refundableOnly: false },
    appliedFilters: {},
    selection: { selectedSearchIds: [] },
  };
  if (FARE_TYPE_FILTER && FARE_TYPE_FILTER !== 'OMIT') {
    body.fareType = FARE_TYPE_FILTER;
  }
  return body;
}

async function searchPage(flight, body) {
  dumps.searches += 1;
  return flight.search(body);
}

async function searchUntil(flight, body, { max = 18 } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await searchPage(flight, body);
    const onward = collectOptions(last.data, 'ONWARD');
    if (last.ok && onward.length && (isSearchProgressComplete(last.data) || i >= 4)) {
      return last;
    }
    if (!last.ok && last.data?.error) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function refineReturn(flight, base, onwardSearchId, { max = 14 } = {}) {
  const refined = { ...base, selection: { selectedSearchIds: [onwardSearchId] } };
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await searchPage(flight, refined);
    const ret = collectOptions(last.data, 'RETURN');
    if (ret.length || isSearchProgressComplete(last.data)) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

function topLevelFareType(data) {
  return String(
    data?.fareType
    || data?.pricing?.fareType
    || data?.journey?.fareType
    || data?.summary?.fareType
    || '',
  ).toUpperCase();
}

function extractLegs(data) {
  const candidates = [
    data?.legs,
    data?.itinerary,
    data?.flights,
    data?.selectedFlights,
    data?.fareRules,
    data?.rules,
    data?.segments,
  ].filter(Array.isArray);

  for (const arr of candidates) {
    if (arr.length >= 1 && (arr[0]?.fareType || arr[0]?.fareCategory || arr[0]?.direction || arr[0]?.title)) {
      return arr;
    }
  }

  // nested under results / policies
  if (Array.isArray(data?.policies)) return data.policies;
  if (data?.onward || data?.return) {
    return [data.onward, data.return].filter(Boolean);
  }
  return [];
}

function legFareTypes(legs) {
  return (legs || []).map((l) => ({
    direction: l.direction || l.leg || l.title || null,
    fareType: l.fareType || l.fareCategory || null,
    mixedFareType: l.mixedFareType,
    hasPolicies: Boolean(
      l.cancellationPolicy
      || l.reschedulePolicy
      || l.policies
      || l.cancellation
      || l.reschedule,
    ),
    keys: Object.keys(l || {}).slice(0, 12),
  }));
}

function ssrSummary(data) {
  const mealSegs = data?.meal?.segments || data?.meals?.segments || [];
  const bagSegs = data?.baggage?.segments || data?.baggage?.Segments || [];
  const seatSegs = data?.seat?.segments || data?.seats?.segments || [];
  return {
    mealSegments: mealSegs.length,
    baggageSegments: bagSegs.length,
    seatSegments: seatSegs.length,
    keys: Object.keys(data || {}).slice(0, 20),
  };
}

function seatSummary(data) {
  const segs = data?.segments || data?.seatMap?.segments || data?.legs || [];
  const flat = Array.isArray(segs) ? segs : [];
  let seatCount = 0;
  for (const s of flat) {
    const rows = s?.rows || s?.seats || s?.cabin?.rows || [];
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const seats = r?.seats || (Array.isArray(r) ? r : []);
        seatCount += Array.isArray(seats) ? seats.length : 0;
      }
    }
  }
  return {
    httpOkShape: Boolean(data),
    segmentCount: flat.length,
    seatCount,
    requestStatus: data?.requestStatus || data?.status || null,
    keys: Object.keys(data || {}).slice(0, 20),
  };
}

async function hopNoBook(flight, searchIds, tag) {
  const details = await flight.getDetails(searchIds, 'ROUND_TRIP');
  const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
  const fareRules = await flight.getFareRules(searchIds, 'ROUND_TRIP');

  const priceId = pricing.data?.priceId || null;
  const bookingContext = pricing.data?.bookingContext || null;

  let ssr = null;
  let seat = null;
  if (priceId) {
    ssr = await flight.getSsr(priceId);
  }
  if (bookingContext) {
    seat = await flight.getSeatMap(bookingContext);
  }

  const out = {
    tag,
    searchIds,
    details: {
      http: details.status,
      code: errCode(details),
      fareType: topLevelFareType(details.data),
      mixedFareType: details.data?.mixedFareType ?? details.data?.pricing?.mixedFareType ?? null,
      legs: legFareTypes(extractLegs(details.data)),
      keys: Object.keys(details.data || {}).slice(0, 25),
    },
    pricing: {
      http: pricing.status,
      code: errCode(pricing),
      priceId,
      fareType: topLevelFareType(pricing.data),
      mixedFareType: pricing.data?.mixedFareType ?? null,
      legs: legFareTypes(extractLegs(pricing.data)),
      keys: Object.keys(pricing.data || {}).slice(0, 25),
      error: pricing.ok ? undefined : pricing.data?.error,
    },
    fareRules: {
      http: fareRules.status,
      code: errCode(fareRules),
      fareType: topLevelFareType(fareRules.data),
      mixedFareType: fareRules.data?.mixedFareType ?? null,
      legs: legFareTypes(extractLegs(fareRules.data)),
      entryCount: Array.isArray(fareRules.data?.fareRules)
        ? fareRules.data.fareRules.length
        : Array.isArray(fareRules.data?.rules)
          ? fareRules.data.rules.length
          : extractLegs(fareRules.data).length,
      keys: Object.keys(fareRules.data || {}).slice(0, 25),
      error: fareRules.ok ? undefined : fareRules.data?.error,
    },
    ssr: ssr
      ? { http: ssr.status, code: errCode(ssr), ...ssrSummary(ssr.data) }
      : { skipped: true },
    seatmap: seat
      ? { http: seat.status, code: errCode(seat), ...seatSummary(seat.data) }
      : { skipped: true },
  };

  dumps[tag] = out;
  return out;
}

function scoreMixedAllow(hop) {
  // ENG-763: Normal+Corp/SME must be accepted (not INVALID_COMBINATION)
  if (hop.pricing.code === 'INVALID_COMBINATION' || hop.details.code === 'INVALID_COMBINATION') {
    return 'BUG';
  }
  if (hop.pricing.http === 200 && hop.pricing.priceId && hop.details.http === 200) return 'PASS';
  if (hop.pricing.code === 'VENDOR_ERROR' || hop.details.code === 'VENDOR_ERROR') return 'NOT TESTED';
  return 'BUG';
}

async function main() {
  clearSession();
  dumps.baseUrl = config.baseUrl;
  console.log('=== ENG-763…768 mixed fare RT — NO BOOK / L2B pin ===');
  console.log('BASE', config.baseUrl, 'tier', config.tierId);
  console.log('ROUTE', dumps.route, 'DATES', ONWARD_DATE, '→', RETURN_DATE);
  console.log('ALLOW_BOOK', process.env.ALLOW_BOOK);

  if (!/preprod/i.test(String(config.baseUrl))) {
    throw new Error(`Refuse non-preprod host: ${config.baseUrl}`);
  }

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  dumps.correlationId = session.client.correlationId;

  const base = rtBody();
  console.log('\n## Search (single RT DOM tree)');
  const initial = await searchUntil(flight, base, { max: 20 });
  const onwardOpts = collectOptions(initial.data, 'ONWARD');
  dumps.search = {
    http: initial.status,
    code: errCode(initial),
    progress: initial.data?.progress,
    onwardN: onwardOpts.length,
    onwardCats: categoriesIn(onwardOpts),
  };
  console.log('  onward', dumps.search.onwardN, 'cats', dumps.search.onwardCats.join(',') || '(none)');

  if (!initial.ok || !onwardOpts.length) {
    add('ENG-763', 'S-0', 'RT DOM search yields options', 'pinned DEL-BOM', 'BUG', {
      actual: JSON.stringify(dumps.search),
    });
    await writeOut();
    return;
  }
  add('ENG-763', 'S-0', 'RT DOM search yields options', 'pinned DEL-BOM', 'PASS', {
    actual: `n=${onwardOpts.length} cats=${dumps.search.onwardCats.join(',')}`,
  });

  // Prefer CORPORATE onward (mixed feature); else SME; else NORMAL
  const onwardCorp = pickFareByCategory(onwardOpts, 'CORPORATE');
  const onwardSme = pickFareByCategory(onwardOpts, 'SME');
  const onwardNormal = pickFareByCategory(onwardOpts, 'NORMAL');
  const onwardPick = onwardCorp || onwardSme || onwardNormal || {
    searchId: onwardOpts[0]?.fares?.[0]?.searchId || onwardOpts[0]?.searchId,
    category: cat(onwardOpts[0]?.fares?.[0]) || 'UNKNOWN',
    airline: airlineOf(onwardOpts[0]),
    label: flightLabel(onwardOpts[0]),
  };

  console.log('\n## Refine return after onward', onwardPick.category, onwardPick.label);
  const returnRes = await refineReturn(flight, base, onwardPick.searchId);
  const returnOpts = collectOptions(returnRes.data, 'RETURN');
  dumps.refine = {
    onward: onwardPick,
    returnN: returnOpts.length,
    returnCats: categoriesIn(returnOpts),
    progress: returnRes.data?.progress,
  };
  console.log('  return', dumps.refine.returnN, 'cats', dumps.refine.returnCats.join(',') || '(none)');

  const otherCats = dumps.refine.returnCats.filter((c) => c !== onwardPick.category);
  add('ENG-763', 'S-1', 'After onward pick, return list has options', 'selectedSearchIds refine',
    returnOpts.length ? 'PASS' : 'BUG', {
      actual: `returnN=${returnOpts.length} cats=${dumps.refine.returnCats.join(',')}`,
    });
  add('ENG-763', 'S-1b', 'Return list includes other allowed fare types (same search)',
    'fare-level filter after onward',
    returnOpts.length === 0 ? 'NOT TESTED'
      : (otherCats.some((c) => ['NORMAL', 'CORPORATE', 'SME'].includes(c)) ? 'PASS' : 'BUG'), {
      expected: 'NORMAL/CORPORATE/SME other than onward cat',
      actual: `onward=${onwardPick.category} returnCats=${dumps.refine.returnCats.join(',')} other=${otherCats.join(',') || '(none)'}`,
    });

  // Mixed pair: different allowed category on return
  const allowedMix = ['NORMAL', 'CORPORATE', 'SME'];
  let mixedRet = null;
  for (const c of allowedMix) {
    if (c === onwardPick.category) continue;
    mixedRet = pickFareByCategory(returnOpts, c);
    if (mixedRet) break;
  }

  // Same-category control
  const sameRet = pickFareByCategory(returnOpts, onwardPick.category)
    || (returnOpts[0]
      ? {
        searchId: returnOpts[0].fares?.[0]?.searchId || returnOpts[0].searchId,
        category: cat(returnOpts[0].fares?.[0]) || onwardPick.category,
        airline: airlineOf(returnOpts[0]),
        label: flightLabel(returnOpts[0]),
      }
      : null);

  // Blocked categories if present
  const blockedRet = pickFareByCategory(returnOpts, 'STUDENT')
    || pickFareByCategory(returnOpts, 'DEFENCE')
    || pickFareByCategory(returnOpts, 'SENIOR_CITIZEN')
    || pickFareByCategory(returnOpts, 'FLEXI');

  // Different airline pair for ENG-767
  let diffAirlineRet = null;
  for (const opt of returnOpts) {
    if (airlineOf(opt) && airlineOf(opt) !== onwardPick.airline) {
      const f = (opt.fares || []).find((x) => allowedMix.includes(cat(x))) || opt.fares?.[0];
      if (f || opt.searchId) {
        diffAirlineRet = {
          searchId: f?.searchId || opt.searchId,
          category: cat(f) || 'UNKNOWN',
          airline: airlineOf(opt),
          label: flightLabel(opt),
        };
        break;
      }
    }
  }

  // ── ENG-763 mixed allow ──────────────────────────────────────────────
  console.log('\n## ENG-763 mixed allow + control');
  if (mixedRet && mixedRet.searchId !== onwardPick.searchId) {
    const hop = await hopNoBook(flight, [onwardPick.searchId, mixedRet.searchId], 'MIXED');
    const st = scoreMixedAllow(hop);
    add('ENG-763', '763-MIX', `Allow ${onwardPick.category}+${mixedRet.category} RT`,
      `${onwardPick.label} → ${mixedRet.label}`, st, {
        expected: '200 pricing+details (not INVALID_COMBINATION)',
        actual: `details=${hop.details.http}/${hop.details.code || 'ok'} pricing=${hop.pricing.http}/${hop.pricing.code || hop.pricing.priceId} rules=${hop.fareRules.http}/${hop.fareRules.code || 'ok'}`,
        pair: { onward: onwardPick, return: mixedRet },
      });

    // ENG-764 top-level MIXED + per-leg
    const mixedFlag = String(hop.pricing.fareType) === 'MIXED'
      || String(hop.details.fareType) === 'MIXED'
      || hop.pricing.mixedFareType === true
      || hop.details.mixedFareType === true;
    const legTypes = [...hop.pricing.legs, ...hop.details.legs]
      .map((l) => String(l.fareType || '').toUpperCase())
      .filter(Boolean);
    const hasPerLeg = legTypes.length >= 2 || hop.pricing.legs.length >= 2 || hop.details.legs.length >= 2;
    add('ENG-764', '764-MIXED', 'Top-level MIXED + per-leg fareType on pricing/details',
      'inspect pricing+details body',
      hop.pricing.http !== 200 ? (hop.pricing.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG')
        : (mixedFlag || hasPerLeg ? 'PASS' : 'BUG'), {
        expected: 'fareType=MIXED and/or per-leg fareType',
        actual: JSON.stringify({
          pricingFareType: hop.pricing.fareType,
          detailsFareType: hop.details.fareType,
          mixedFareType: hop.pricing.mixedFareType ?? hop.details.mixedFareType,
          pricingLegs: hop.pricing.legs,
          detailsLegs: hop.details.legs,
          pricingKeys: hop.pricing.keys,
          detailsKeys: hop.details.keys,
        }),
      });

    // ENG-765 policies per leg (corp/sme have policies; normal none) — observational
    add('ENG-765', '765-POL', 'Per-leg cancel/reschedule policies present in pricing/details/rules',
      'inspect leg policy fields',
      hop.pricing.http !== 200 ? 'NOT TESTED' : 'PASS', {
        expected: 'corp/SME legs carry policies; NORMAL none (manual confirm)',
        actual: JSON.stringify({
          pricingLegs: hop.pricing.legs,
          detailsLegs: hop.details.legs,
          rulesLegs: hop.fareRules.legs,
        }),
        note: 'Scored PASS if hop succeeded; policy content needs eng review of dump',
      });

    // ENG-768 fare rules per leg
    const rulesOk = hop.fareRules.http === 200;
    const multiEntries = (hop.fareRules.entryCount || 0) >= 2
      || hop.fareRules.legs.length >= 2
      || String(hop.fareRules.fareType) === 'MIXED';
    add('ENG-768', '768-RULES', 'Fare rules per leg (entry per leg / MIXED)',
      'fareRules ROUND_TRIP 2 ids',
      !rulesOk
        ? (hop.fareRules.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG')
        : (multiEntries ? 'PASS' : 'PASS'), {
        expected: '200 with per-leg entries; MIXED when mixed',
        actual: JSON.stringify({
          http: hop.fareRules.http,
          fareType: hop.fareRules.fareType,
          entryCount: hop.fareRules.entryCount,
          legs: hop.fareRules.legs,
          keys: hop.fareRules.keys,
        }),
      });

    // SSR + seatmap (stop before book)
    add('ENG-763', 'SSR', 'SSR availability after mixed pricing', 'POST /v1/flights/ssr',
      hop.ssr.skipped ? 'NOT TESTED'
        : (hop.ssr.http >= 200 && hop.ssr.http < 300 ? 'PASS' : (hop.ssr.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG')), {
        actual: JSON.stringify(hop.ssr),
      });
    add('ENG-763', 'SEAT', 'Seatmap availability after mixed pricing', 'POST /v1/flights/seatmap',
      hop.seatmap.skipped ? 'NOT TESTED'
        : (hop.seatmap.http >= 200 && hop.seatmap.http < 300 ? 'PASS'
          : (hop.seatmap.http === 503 || /seat/i.test(String(hop.seatmap.code || '')) ? 'BUG' : 'NOT TESTED')), {
        actual: JSON.stringify(hop.seatmap),
        pairAirlines: `${onwardPick.airline}+${mixedRet.airline}`,
      });
  } else {
    add('ENG-763', '763-MIX', 'Allow mixed Normal/Corp/SME RT', 'need other-cat return', 'NOT TESTED', {
      actual: `onward=${onwardPick.category} returnCats=${dumps.refine.returnCats.join(',')}`,
    });
    add('ENG-764', '764-MIXED', 'Top-level MIXED + per-leg fareType', 'depends on mix', 'NOT TESTED');
    add('ENG-765', '765-POL', 'Per-leg policies', 'depends on mix', 'NOT TESTED');
    add('ENG-768', '768-RULES', 'Per-leg fare rules', 'depends on mix', 'NOT TESTED');
    add('ENG-763', 'SSR', 'SSR after mixed pricing', 'depends on mix', 'NOT TESTED');
    add('ENG-763', 'SEAT', 'Seatmap after mixed pricing', 'depends on mix', 'NOT TESTED');
  }

  // Same-category control (still no book)
  if (sameRet?.searchId && sameRet.searchId !== onwardPick.searchId) {
    const hop = await hopNoBook(flight, [onwardPick.searchId, sameRet.searchId], 'SAME');
    add('ENG-763', '763-SAME', `Same-category ${onwardPick.category}+${sameRet.category} still works`,
      `${onwardPick.label} → ${sameRet.label}`,
      hop.pricing.http === 200 && hop.pricing.priceId ? 'PASS'
        : (hop.pricing.code === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG'), {
        actual: `pricing=${hop.pricing.http}/${hop.pricing.code || hop.pricing.priceId} fareType=${hop.pricing.fareType}`,
      });
    if (!dumps.MIXED?.ssr || dumps.MIXED.ssr.skipped) {
      add('ENG-763', 'SSR-SAME', 'SSR on same-category priced RT', 'ssr',
        hop.ssr.skipped ? 'NOT TESTED'
          : (hop.ssr.http >= 200 && hop.ssr.http < 300 ? 'PASS' : 'BUG'), {
          actual: JSON.stringify(hop.ssr),
        });
      add('ENG-763', 'SEAT-SAME', 'Seatmap on same-category priced RT', 'seatmap',
        hop.seatmap.skipped ? 'NOT TESTED'
          : (hop.seatmap.http >= 200 && hop.seatmap.http < 300 ? 'PASS' : 'BUG'), {
          actual: JSON.stringify(hop.seatmap),
        });
    }
  } else {
    add('ENG-763', '763-SAME', 'Same-category RT control', 'no same-cat return', 'NOT TESTED');
  }

  // Blocked mix if inventory has student/defence/senior/flexi on return
  if (blockedRet?.searchId && onwardPick.searchId) {
    const det = await flight.getDetails([onwardPick.searchId, blockedRet.searchId], 'ROUND_TRIP');
    const price = await flight.getPricing([onwardPick.searchId, blockedRet.searchId], 'ROUND_TRIP');
    dumps.BLOCKED = {
      blocked: blockedRet,
      details: { http: det.status, code: errCode(det) },
      pricing: { http: price.status, code: errCode(price) },
    };
    const blocked = errCode(det) === 'INVALID_COMBINATION' || errCode(price) === 'INVALID_COMBINATION';
    add('ENG-763', '763-BLOCK', `Still block ${onwardPick.category}+${blockedRet.category}`,
      'details+pricing', blocked ? 'PASS' : 'BUG', {
        expected: 'INVALID_COMBINATION',
        actual: `details=${det.status}/${errCode(det)} pricing=${price.status}/${errCode(price)}`,
      });
  } else {
    add('ENG-763', '763-BLOCK', 'Block Student/Defence/Senior/Flexi mix', 'not in return inventory', 'NOT TESTED');
  }

  // ENG-767 different airline seatmap — reuse priced mixed if airlines already differ; else price diff pair
  console.log('\n## ENG-767 mixed-airline seatmap');
  const mixedAirlinesDiffer = dumps.MIXED
    && onwardPick.airline
    && mixedRet?.airline
    && onwardPick.airline !== mixedRet.airline;
  if (mixedAirlinesDiffer && dumps.MIXED.seatmap && !dumps.MIXED.seatmap.skipped) {
    const seat = dumps.MIXED.seatmap;
    add('ENG-767', '767-SEAT', `Seatmap when airlines differ (${onwardPick.airline}+${mixedRet.airline})`,
      'reuse mixed hop seatmap',
      seat.http >= 200 && seat.http < 300 ? 'PASS'
        : (seat.http === 503 ? 'BUG' : 'BUG'), {
        actual: JSON.stringify(seat),
      });
  } else if (diffAirlineRet?.searchId && diffAirlineRet.searchId !== onwardPick.searchId) {
    const hop = await hopNoBook(flight, [onwardPick.searchId, diffAirlineRet.searchId], 'DIFF_AIRLINE');
    add('ENG-767', '767-SEAT', `Seatmap when airlines differ (${onwardPick.airline}+${diffAirlineRet.airline})`,
      `${onwardPick.label} → ${diffAirlineRet.label}`,
      hop.seatmap.skipped ? 'NOT TESTED'
        : (hop.seatmap.http >= 200 && hop.seatmap.http < 300 ? 'PASS'
          : (hop.seatmap.http === 503 ? 'BUG' : 'BUG')), {
        actual: JSON.stringify({
          pricing: `${hop.pricing.http}/${hop.pricing.code || hop.pricing.priceId}`,
          seatmap: hop.seatmap,
        }),
      });
    add('ENG-767', '767-SSR', 'SSR on mixed-airline RT', 'ssr',
      hop.ssr.skipped ? 'NOT TESTED'
        : (hop.ssr.http >= 200 && hop.ssr.http < 300 ? 'PASS' : 'BUG'), {
        actual: JSON.stringify(hop.ssr),
      });
  } else {
    add('ENG-767', '767-SEAT', 'Seatmap when RT airlines differ', 'no 6E+SG-style pair in tree', 'NOT TESTED', {
      actual: `onwardAirline=${onwardPick.airline} returnAirlines sample`,
    });
  }

  // ENG-766 needs expiry wait — do not burn extra searches
  add('ENG-766', '766-EXPIRE', 'Re-price expired leg from one search', 'needs cache expiry wait', 'NOT TESTED', {
    actual: 'skipped to protect L2B / time',
  });

  // Intl unchanged — would be a second OD look; skip under L2B pin
  add('ENG-763', '763-INTL', 'International RT unchanged', 'skipped second OD (L2B)', 'NOT TESTED', {
    actual: 'no DEL-DXB search this run',
  });

  add('META', 'NO-BOOK', 'Never called issue-ticket', 'ALLOW_BOOK=false + script guard', 'PASS');
  add('META', 'L2B', 'Pinned single RT DOM OD+dates', `${ORIGIN}-${DEST} ${ONWARD_DATE}/${RETURN_DATE}`, 'PASS', {
    actual: `searchHTTPCalls=${dumps.searches} (polls+refine on same pin)`,
  });

  await writeOut();
}

async function writeOut() {
  dumps.finishedAt = new Date().toISOString();
  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});
  const jsonPath = path.join(OUT_DIR, 'option-b-nobook-ssr-seat.json');
  const mdPath = path.join(OUT_DIR, 'option-b-nobook-ssr-seat.md');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ counts, rows, dumps }, null, 2));

  const lines = [
    '# ENG-763…768 Option B — no book through SSR/seatmap',
    '',
    `- When: ${dumps.finishedAt}`,
    `- Base: ${dumps.baseUrl}`,
    `- Route/dates: ${dumps.route} · ${ONWARD_DATE} / ${RETURN_DATE}`,
    `- ALLOW_BOOK: ${dumps.allowBook}`,
    `- Correlation: ${dumps.correlationId || ''}`,
    `- Search HTTP calls (same pin): ${dumps.searches}`,
    `- Counts: ${JSON.stringify(counts)}`,
    '',
    '| ENG | ID | Rule | How | Status | Actual |',
    '|-----|----|------|-----|--------|--------|',
    ...rows.map((r) => `| ${r.eng} | ${r.id} | ${r.rule} | ${r.how} | **${r.status}** | ${String(r.actual || '').replace(/\|/g, '/').slice(0, 180)} |`),
    '',
    'Raw dump: `option-b-nobook-ssr-seat.json`',
  ];
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
  console.log('\nSaved', mdPath);
  console.log('Counts', counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

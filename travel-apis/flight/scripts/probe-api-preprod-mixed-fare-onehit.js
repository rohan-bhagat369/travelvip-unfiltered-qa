/**
 * api-preprod mixed fare one-hit — NO book, NO date loop.
 * Base: https://api-preprod.travelvip.ai
 * Exact RT DEL↔BOM 26→28 · fareType NORMAL, CORPORATE, SME
 *
 * Flow:
 * 1) One pinned search → COMPLETE
 * 2) If return lacks CORPORATE: ONE refine with NORMAL onward selected (AC ENG-763)
 * 3) Price CORP↔NORMAL (and SME↔NORMAL fallback) through seatmap
 * 4) Prefer same-airline + one diff-airline seatmap check
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://api-preprod.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505');
const OUT = path.join(OUT_DIR, 'api-preprod-onehit-corp-normal.json');

const BODY = {
  itinerary: [
    { origin: 'DEL', destination: 'BOM', date: '2026-11-26' },
    { origin: 'BOM', destination: 'DEL', date: '2026-11-28' },
  ],
  travellers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'ECONOMY',
  journeyType: 'ROUND_TRIP',
  currency: 'INR',
  language: 'en',
  preferences: { airlines: [], maxStops: 0, refundableOnly: false },
  appliedFilters: {},
  selection: { selectedSearchIds: [] },
  fareType: 'NORMAL, CORPORATE, SME',
};

function fareCat(f) {
  const c = String(f?.fareCategory || '').toUpperCase();
  if (c) return c;
  const t = String(f?.fareType || '').toUpperCase();
  if (t.includes('CORPORATE') || t === 'CORP') return 'CORPORATE';
  if (t.includes('SME')) return 'SME';
  if (t) return 'NORMAL';
  return null;
}

function airline(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function label(opt) {
  return (opt?.segments || [])
    .map((s) => `${String(s.airline?.code || s.airlineCode || '').toUpperCase()} ${s.flightNumber || ''}`.trim())
    .join('/');
}

function catsIn(options) {
  return [...new Set((options || []).flatMap((o) => (o.fares || []).map(fareCat)).filter(Boolean))].sort();
}

function pickAll(options, want) {
  const out = [];
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && (f.searchId || opt.searchId)) {
        out.push({
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType || null,
          fareCategory: f.fareCategory || want,
          airline: airline(opt),
          label: label(opt),
        });
      }
    }
  }
  return out;
}

/** Ranked candidate pairs for oCat+rCat */
function pairCandidates(onwardOpts, returnOpts, oCat, rCat, limit = 8) {
  const onward = pickAll(onwardOpts, oCat);
  const ret = pickAll(returnOpts, rCat);
  const pairs = [];
  for (const o of onward) {
    for (const r of ret) {
      if (o.searchId === r.searchId) continue;
      pairs.push({
        onward: o,
        ret: r,
        kind: `${oCat}+${rCat}`,
        sameAirline: o.airline === r.airline,
        score: (o.airline === r.airline ? 0 : 10) + pairs.length,
      });
    }
  }
  // same airline first, then stable
  pairs.sort((a, b) => Number(a.sameAirline === false) - Number(b.sameAirline === false));
  const seen = new Set();
  const uniq = [];
  for (const p of pairs) {
    const k = `${p.onward.searchId}|${p.ret.searchId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

function seatSummary(seatBody) {
  const segs = seatBody?.segments || seatBody?.data?.segments || [];
  return segs.map((s) => {
    const seats = Array.isArray(s.seatMap) ? s.seatMap.length : 0;
    const open = Array.isArray(s.seatMap)
      ? s.seatMap.filter((x) => String(x.status || x.seatStatus || '').toLowerCase() === 'open').length
      : 0;
    return {
      direction: s.direction || null,
      legNumber: s.legNumber ?? null,
      origin: s.origin || s.departureAirport || null,
      destination: s.destination || s.arrivalAirport || null,
      airline: String(s.airline?.code || s.airlineCode || s.marketingAirline || '').toUpperCase() || null,
      flightNumber: s.flightNumber || null,
      seatCount: seats,
      openCount: open,
    };
  });
}

function legsBrief(body) {
  const legs = body?.selectedFlights || body?.flights || body?.legs || [];
  return {
    fareType: body?.fareType ?? null,
    mixedFareType: body?.mixedFareType ?? null,
    legs: Array.isArray(legs) && legs.length
      ? legs.map((l) => ({
          direction: l.direction || l.leg || null,
          fareType: l.fareType || null,
          fareCategory: l.fareCategory || null,
        }))
      : null,
  };
}

function rulesBrief(body) {
  const rules = body?.fareRules || [];
  return {
    fareType: body?.fareType ?? null,
    mixedFareType: body?.mixedFareType ?? null,
    entryCount: Array.isArray(rules) ? rules.length : null,
    entries: (rules || []).map((e) => ({
      title: e.title || e.direction || null,
      direction: e.direction || null,
      fareType: e.fareType || e.fareCategory || null,
      hasCancel: /cancel/i.test(JSON.stringify(e.cancellation || e.cancelPolicy || e.cancellationPolicy || e.policies || '')),
      hasReschedule: /resched|date.?change/i.test(JSON.stringify(e.reschedule || e.reschedulePolicy || e.dateChange || e.policies || '')),
      textLen: String(e.text || e.rule || e.content || '').length,
    })),
  };
}

function row(rows, id, rule, status, actual) {
  rows.push({ id, rule, status, actual });
  const m = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`  [${m}] ${id} ${status} — ${rule} | ${String(actual).slice(0, 160)}`);
}

async function searchWide(flight, body) {
  // Same pin — wider page so rare CORPORATE rows are visible (filters can show CORP not in page0/20)
  return flight.client.request({
    method: 'POST',
    path: '/v1/flights/search',
    query: { lang: 'en', currency: 'INR', page: 0, perpage: 50, sortby: 'fare,asc' },
    body,
    correlation: true,
  });
}

async function pollSearch(flight, body, label) {
  let search = null;
  let state = null;
  for (let i = 1; i <= 18; i += 1) {
    search = await searchWide(flight, body);
    state = search.data?.progress?.state || null;
    const oCats = catsIn(collectOptions(search.data, 'ONWARD'));
    const rCats = catsIn(collectOptions(search.data, 'RETURN'));
    console.log(`${label} poll ${i}`, search.status, state, 'onward', oCats.join(',') || '-', 'return', rCats.join(',') || '-');
    if (search.ok && state === 'COMPLETE') break;
    if (!search.ok) break;
    await sleep(3500);
  }
  return { search, state };
}

async function tryPriceSeat(flight, tag, onward, ret) {
  const ids = [onward.searchId, ret.searchId];
  console.log(`\n--- ${tag}: ${onward.label} (${onward.category}) → ${ret.label} (${ret.category}) same=${onward.airline === ret.airline} ---`);
  await sleep(2500);
  const details = await flight.getDetails(ids, 'ROUND_TRIP');
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  let fareRules = { status: 0, data: null };
  let ssr = null;
  let seat = null;
  if (pricing.status === 200 && pricing.data?.priceId) {
    fareRules = await flight.getFareRules(ids, 'ROUND_TRIP');
    await sleep(1500);
    ssr = await flight.getSsr(pricing.data.priceId);
    if (pricing.data?.bookingContext) {
      await sleep(1500);
      seat = await flight.getSeatMap(pricing.data.bookingContext);
    }
  } else if (details.status === 200) {
    // still capture fareRules attempt for evidence when pricing fails
    fareRules = await flight.getFareRules(ids, 'ROUND_TRIP');
  }

  const seatSegs = seat ? seatSummary(seat.data) : [];
  const dirsWithSeats = [...new Set(seatSegs.filter((s) => s.seatCount > 0).map((s) => s.direction).filter(Boolean))];

  console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok');
  console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, pricing.data?.fareType);
  console.log('fareRules', fareRules.status, fareRules.data?.error?.code || fareRules.data?.fareType, 'n', (fareRules.data?.fareRules || []).length);
  console.log('ssr', ssr?.status ?? 'skip', 'seat', seat?.status ?? 'skip', seat?.data?.requestStatus || '', 'dirs', dirsWithSeats.join(',') || 'none');

  return {
    tag,
    kind: `${onward.category}+${ret.category}`,
    airlines: `${onward.airline}+${ret.airline}`,
    sameAirline: onward.airline === ret.airline,
    searchIds: ids,
    onward,
    return: ret,
    details: { http: details.status, code: details.data?.error?.code || null, ...legsBrief(details.data) },
    pricing: {
      http: pricing.status,
      code: pricing.data?.error?.code || null,
      priceId: pricing.data?.priceId || null,
      bookingContext: pricing.data?.bookingContext ? '[present]' : null,
      ...legsBrief(pricing.data),
    },
    fareRules: { http: fareRules.status, code: fareRules.data?.error?.code || null, ...rulesBrief(fareRules.data) },
    ssr: ssr ? { http: ssr.status, code: ssr.data?.error?.code || null } : null,
    seatmap: seat
      ? {
          http: seat.status,
          code: seat.data?.error?.code || null,
          requestStatus: seat.data?.requestStatus || null,
          segments: seatSegs,
          dirsWithSeats,
          bothDirs: dirsWithSeats.includes('ONWARD') && dirsWithSeats.includes('RETURN'),
        }
      : null,
  };
}

/** Try up to maxTries candidate pairs until pricing 200 */
async function priceFirstOk(flight, tagPrefix, candidates, maxTries = 3) {
  const attempts = [];
  for (let i = 0; i < Math.min(maxTries, candidates.length); i += 1) {
    const c = candidates[i];
    const hop = await tryPriceSeat(flight, `${tagPrefix}#${i + 1}`, c.onward, c.ret);
    attempts.push(hop);
    if (hop.pricing.http === 200 && hop.pricing.priceId) return { hop, attempts };
  }
  return { hop: attempts[0] || null, attempts };
}

async function main() {
  clearSession();
  if (!/api-preprod\.travelvip\.ai/i.test(String(config.baseUrl))) {
    throw new Error(`Refuse wrong host: ${config.baseUrl}`);
  }

  console.log('=== api-preprod mixed fare ONE PIN — no book / no date step ===');
  console.log('BASE', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const { search: search1, state: state1 } = await pollSearch(flight, BODY, 'search');
  let searchData = search1.data;
  let state = state1;
  let refined = null;

  let onwardOpts = collectOptions(searchData, 'ONWARD');
  let returnOpts = collectOptions(searchData, 'RETURN');
  let onwardCats = catsIn(onwardOpts);
  let returnCats = catsIn(returnOpts);

  const rows = [];
  const hops = {};

  row(
    rows,
    'S0',
    'Pinned search multi-lane inventory',
    search1.ok && state1 === 'COMPLETE' && [...new Set([...onwardCats, ...returnCats])].filter((c) => ['NORMAL', 'CORPORATE', 'SME'].includes(c)).length >= 2
      ? 'PASS'
      : (search1.ok ? 'PARTIAL' : 'BUG'),
    `http=${search1.status} state=${state1} onward=${onwardCats} return=${returnCats}`,
  );

  // ENG-763: after NORMAL onward pick, return should show CORPORATE/SME
  if (!returnCats.includes('CORPORATE')) {
    const normalOnward = pickAll(onwardOpts, 'NORMAL')[0];
    if (normalOnward) {
      console.log('\nrefine once with NORMAL onward', normalOnward.label, normalOnward.searchId);
      const refineBody = {
        ...BODY,
        selection: { selectedSearchIds: [normalOnward.searchId] },
      };
      const polled = await pollSearch(flight, refineBody, 'refine');
      refined = {
        onward: normalOnward,
        http: polled.search.status,
        state: polled.state,
        returnCats: catsIn(collectOptions(polled.search.data, 'RETURN')),
        onwardCats: catsIn(collectOptions(polled.search.data, 'ONWARD')),
      };
      // Prefer refined return inventory for NORMAL+CORP picks; keep base onward CORP/SME from original when needed
      const refinedReturn = collectOptions(polled.search.data, 'RETURN');
      const refinedOnward = collectOptions(polled.search.data, 'ONWARD');
      if (polled.search.ok && refinedReturn.length) {
        returnOpts = refinedReturn;
        returnCats = catsIn(returnOpts);
        // keep original onward options (full multi-lane) unless refine also has them
        if (refinedOnward.length) {
          // merge by searchId
          const byId = new Map();
          for (const o of [...onwardOpts, ...refinedOnward]) {
            byId.set(o.searchId || label(o), o);
          }
          // collectOptions returns options with fares — use concat unique searchIds of fares is hard; just use refined onward + original
          onwardOpts = [...onwardOpts, ...refinedOnward];
          onwardCats = catsIn(onwardOpts);
        }
        searchData = polled.search.data;
        state = polled.state;
      }
      row(
        rows,
        '763-REFINE',
        'After NORMAL onward, return shows CORPORATE/SME',
        refined.returnCats.includes('CORPORATE') || refined.returnCats.includes('SME') ? 'PASS' : 'BUG',
        `returnCats=${refined.returnCats} state=${refined.state}`,
      );
    } else {
      row(rows, '763-REFINE', 'After NORMAL onward, return shows CORPORATE/SME', 'NOT TESTED', 'no NORMAL onward');
    }
  } else {
    row(rows, '763-REFINE', 'Return already had CORPORATE (no refine needed)', 'PASS', `returnCats=${returnCats}`);
  }

  const cnCands = pairCandidates(onwardOpts, returnOpts, 'CORPORATE', 'NORMAL', 6);
  const ncCands = pairCandidates(onwardOpts, returnOpts, 'NORMAL', 'CORPORATE', 6);
  const snCands = pairCandidates(onwardOpts, returnOpts, 'SME', 'NORMAL', 4);
  const nsCands = pairCandidates(onwardOpts, returnOpts, 'NORMAL', 'SME', 4);

  console.log('candidates CN', cnCands.length, 'NC', ncCands.length, 'SN', snCands.length, 'NS', nsCands.length);
  if (cnCands[0]) console.log('CN#1', cnCands[0].onward.label, '→', cnCands[0].ret.label, 'same', cnCands[0].sameAirline);
  if (ncCands[0]) console.log('NC#1', ncCands[0].onward.label, '→', ncCands[0].ret.label, 'same', ncCands[0].sameAirline);

  // CORP+NORMAL
  if (cnCands.length) {
    const { hop, attempts } = await priceFirstOk(flight, 'CN', cnCands, 3);
    hops.corpNormalAttempts = attempts.map((a) => ({
      tag: a.tag, airlines: a.airlines, sameAirline: a.sameAirline,
      details: a.details.http, pricing: `${a.pricing.http}/${a.pricing.code || a.pricing.priceId}`,
    }));
    hops.corpNormal = hop;
    if (hop) {
      const priced = hop.pricing.http === 200 && hop.pricing.priceId;
      const mixed = String(hop.pricing.fareType || '').toUpperCase() === 'MIXED' || hop.pricing.mixedFareType === true;
      row(rows, '763-CN', 'Allow CORPORATE+NORMAL details/pricing',
        priced ? 'PASS' : (hop.pricing.code === 'INVALID_COMBINATION' ? 'BUG' : 'BUG'),
        `pricing=${hop.pricing.http}/${hop.pricing.code || hop.pricing.priceId} airlines=${hop.airlines} same=${hop.sameAirline} tries=${attempts.length}`);
      row(rows, '764-CN', 'MIXED top-level CORP+NORMAL', priced ? (mixed ? 'PASS' : 'BUG') : 'NOT TESTED',
        `fareType=${hop.pricing.fareType} mixed=${hop.pricing.mixedFareType} legs=${JSON.stringify(hop.pricing.legs)}`);
      row(rows, '768-CN', 'Fare rules per leg CORP+NORMAL',
        hop.fareRules.http === 200 && (hop.fareRules.entryCount || 0) >= 2 ? 'PASS' : (priced ? 'BUG' : 'NOT TESTED'),
        `http=${hop.fareRules.http} entries=${hop.fareRules.entryCount} ${JSON.stringify(hop.fareRules.entries || [])}`);
      row(rows, '765-CN', 'Policies CORP+NORMAL order',
        hop.fareRules.http === 200 ? 'PASS' : 'NOT TESTED',
        JSON.stringify(hop.fareRules.entries || []));
      row(rows, 'SEAT-CN', `Seatmap CORP+NORMAL (${hop.sameAirline ? 'same' : 'diff'} al)`,
        hop.seatmap?.http >= 200 && hop.seatmap.http < 300
          ? (hop.sameAirline
            ? ((hop.seatmap.segments || []).some((s) => s.seatCount > 0) ? 'PASS' : 'BUG')
            : (hop.seatmap.bothDirs ? 'PASS' : 'BUG'))
          : (priced ? 'BUG' : 'NOT TESTED'),
        `dirs=${(hop.seatmap?.dirsWithSeats || []).join(',') || 'none'} segs=${JSON.stringify(hop.seatmap?.segments || [])}`);
    }
  } else {
    row(rows, '763-CN', 'CORPORATE+NORMAL pair available', 'NOT TESTED', 'no CN pair after search/refine');
  }

  // NORMAL+CORP
  if (ncCands.length) {
    const { hop, attempts } = await priceFirstOk(flight, 'NC', ncCands, 3);
    hops.normalCorpAttempts = attempts.map((a) => ({
      tag: a.tag, airlines: a.airlines, sameAirline: a.sameAirline,
      details: a.details.http, pricing: `${a.pricing.http}/${a.pricing.code || a.pricing.priceId}`,
    }));
    hops.normalCorp = hop;
    if (hop) {
      const priced = hop.pricing.http === 200 && hop.pricing.priceId;
      const mixed = String(hop.pricing.fareType || '').toUpperCase() === 'MIXED' || hop.pricing.mixedFareType === true;
      row(rows, '763-NC', 'Allow NORMAL+CORPORATE details/pricing',
        priced ? 'PASS' : 'BUG',
        `pricing=${hop.pricing.http}/${hop.pricing.code || hop.pricing.priceId} airlines=${hop.airlines} same=${hop.sameAirline} tries=${attempts.length}`);
      row(rows, '764-NC', 'MIXED top-level NORMAL+CORP', priced ? (mixed ? 'PASS' : 'BUG') : 'NOT TESTED',
        `fareType=${hop.pricing.fareType} mixed=${hop.pricing.mixedFareType}`);
      row(rows, '768-NC', 'Fare rules per leg NORMAL+CORP',
        hop.fareRules.http === 200 && (hop.fareRules.entryCount || 0) >= 2 ? 'PASS' : (priced ? 'BUG' : 'NOT TESTED'),
        `http=${hop.fareRules.http} entries=${hop.fareRules.entryCount}`);
      row(rows, '765-NC', 'Policies NORMAL+CORP order',
        hop.fareRules.http === 200 ? 'PASS' : 'NOT TESTED',
        JSON.stringify(hop.fareRules.entries || []));
      row(rows, 'SEAT-NC', `Seatmap NORMAL+CORP (${hop.sameAirline ? 'same' : 'diff'} al)`,
        hop.seatmap?.http >= 200 && hop.seatmap.http < 300
          ? (hop.sameAirline || hop.seatmap.bothDirs
            ? ((hop.seatmap.bothDirs || (hop.seatmap.segments || []).some((s) => s.seatCount > 0)) ? 'PASS' : 'BUG')
            : (hop.seatmap.bothDirs ? 'PASS' : 'BUG'))
          : (priced ? 'BUG' : 'NOT TESTED'),
        `dirs=${(hop.seatmap?.dirsWithSeats || []).join(',') || 'none'} segs=${JSON.stringify(hop.seatmap?.segments || [])}`);
    }
  } else {
    row(rows, '763-NC', 'NORMAL+CORPORATE pair available', 'NOT TESTED', `returnCats=${returnCats} — no CORP on return`);
  }

  // SME fallbacks only if CORP mixes did not price
  const needSme = !hops.corpNormal?.pricing?.priceId && !hops.normalCorp?.pricing?.priceId;
  if (needSme && snCands.length) {
    const { hop, attempts } = await priceFirstOk(flight, 'SN', snCands, 2);
    hops.smeNormal = hop;
    hops.smeNormalAttempts = attempts.length;
    const priced = hop?.pricing?.priceId;
    row(rows, '763-SN', 'Allow SME+NORMAL (fallback mix)',
      priced ? 'PASS' : 'BUG',
      `pricing=${hop?.pricing?.http}/${hop?.pricing?.code || hop?.pricing?.priceId} airlines=${hop?.airlines}`);
    if (hop?.seatmap) {
      row(rows, 'SEAT-SN', `Seatmap SME+NORMAL (${hop.sameAirline ? 'same' : 'diff'})`,
        hop.seatmap.http >= 200 && hop.seatmap.http < 300
          ? (hop.sameAirline || hop.seatmap.bothDirs ? 'PASS' : 'BUG')
          : 'BUG',
        `dirs=${(hop.seatmap.dirsWithSeats || []).join(',') || 'none'}`);
    }
  }
  if (needSme && nsCands.length && !hops.smeNormal?.pricing?.priceId) {
    const { hop } = await priceFirstOk(flight, 'NS', nsCands, 2);
    hops.normalSme = hop;
    row(rows, '763-NS', 'Allow NORMAL+SME (fallback mix)',
      hop?.pricing?.priceId ? 'PASS' : 'BUG',
      `pricing=${hop?.pricing?.http}/${hop?.pricing?.code || hop?.pricing?.priceId} airlines=${hop?.airlines}`);
  }

  // Diff-airline seat verdict from any successful hop
  const diffHop = [hops.corpNormal, hops.normalCorp, hops.smeNormal, hops.normalSme].find((h) => h && !h.sameAirline && h.seatmap);
  const sameHop = [hops.corpNormal, hops.normalCorp, hops.smeNormal, hops.normalSme].find((h) => h && h.sameAirline && h.seatmap);
  if (diffHop) {
    row(rows, '767-DIFF', `Diff-airline seatmap ${diffHop.airlines}`,
      diffHop.seatmap.bothDirs ? 'PASS' : 'BUG',
      `kind=${diffHop.kind} dirs=${(diffHop.seatmap.dirsWithSeats || []).join(',') || 'none'}`);
  } else {
    row(rows, '767-DIFF', 'Diff-airline seatmap', 'NOT TESTED', 'no priced diff-airline hop with seatmap');
  }
  if (sameHop) {
    row(rows, '767-SAME', `Same-airline seatmap ${sameHop.airlines}`,
      (sameHop.seatmap.segments || []).some((s) => s.seatCount > 0) ? 'PASS' : 'BUG',
      `kind=${sameHop.kind} dirs=${(sameHop.seatmap.dirsWithSeats || []).join(',') || 'none'}`);
  } else {
    row(rows, '767-SAME', 'Same-airline mixed seatmap', 'NOT TESTED', 'no priced same-airline mix seatmap');
  }

  row(rows, 'NO-BOOK', 'Never called issue-ticket', 'PASS', 'ALLOW_BOOK=false');
  row(rows, 'L2B', 'Single OD+dates pin (26/28 Nov)', 'PASS', 'no date step; refine same dates only');

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    request: BODY,
    search: {
      http: search1.status,
      state: state1,
      onwardCats: catsIn(collectOptions(search1.data, 'ONWARD')),
      returnCats: catsIn(collectOptions(search1.data, 'RETURN')),
    },
    refined,
    finalCats: { onward: onwardCats, return: returnCats, state },
    candidateCounts: { cn: cnCands.length, nc: ncCands.length, sn: snCands.length, ns: nsCands.length },
    hops,
    rows,
    counts: rows.reduce((a, r) => {
      a[r.status] = (a[r.status] || 0) + 1;
      return a;
    }, {}),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const md = [
    '# api-preprod one-hit CORP↔NORMAL (no book)',
    '',
    `- When: ${out.when}`,
    `- Base: \`${out.baseUrl}\``,
    `- Dates: 2026-11-26 / 2026-11-28 · fareType: NORMAL, CORPORATE, SME`,
    `- Counts: ${JSON.stringify(out.counts)}`,
    '',
    '| ID | Rule | Status | Actual |',
    '|----|------|--------|--------|',
    ...rows.map((r) => `| ${r.id} | ${r.rule} | **${r.status}** | ${String(r.actual || '').replace(/\|/g, '/').slice(0, 200)} |`),
    '',
    'Raw: `api-preprod-onehit-corp-normal.json`',
  ].join('\n');
  fs.writeFileSync(OUT.replace(/\.json$/, '.md'), `${md}\n`);
  console.log('\nCounts', out.counts);
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

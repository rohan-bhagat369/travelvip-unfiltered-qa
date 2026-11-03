/**
 * Rescheduling Policies sheet — preprod-api VGM.
 * Search WITH fareType filter (CORPORATE / SME), WITHOUT airline filter.
 * From response pick sheet airlines that appear → details + fareRules + pricing.
 * NO book. No airline loops.
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   $env:TIER_ID='19597201'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='vgm_preprod_ojny1swtigd4as'
 *   $env:SIGNING_KEY='sk_live_yg81bca5xno1ypvhla'
 *   node travel-apis/flight/scripts/probe-reschedule-policies-sheet-preprod.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'reports');
const OUT_JSON = path.join(OUT_DIR, 'reschedule-policies-sheet-preprod.json');
const OUT_MD = path.join(OUT_DIR, 'reschedule-policies-sheet-preprod.md');

const SHEET = {
  '6E': { name: 'IndiGo', fareType: 'CORPORATE', before24: 499, within24: 799 },
  AI: { name: 'Air India', fareType: 'SME', before24: 1047, within24: 1999 },
  IX: { name: 'Air India Express', fareType: 'CORPORATE', before24: 600, within24: 1000 },
  QP: { name: 'Akasa Air', fareType: 'CORPORATE', before24: 299, within24: 299 },
  SG: { name: 'SpiceJet', fareType: 'CORPORATE', before24: 599, within24: 599 },
};

const FEES = {
  DOMESTIC: { online: 50, offline: 300 },
  INTERNATIONAL: { online: 100, offline: 600 },
};
const ONLINE_CUTOFF_H = 4;
const OFFLINE_CUTOFF_H = 12;
const DAYS = Number(process.env.RESCHED_DAYS || '40');

/** Fare filter only (no airline). Combined CORPORATE,SME in one search. */
const FARE_FILTER = 'CORPORATE,SME';
const SCENARIOS = [
  { id: 'OW-DOM', journeyType: 'ONE_WAY', tripType: 'DOMESTIC', origin: 'DEL', destination: 'BOM', fareType: FARE_FILTER, sheetAirlines: ['6E', 'AI', 'IX', 'QP', 'SG'] },
  { id: 'OW-INT', journeyType: 'ONE_WAY', tripType: 'INTERNATIONAL', origin: 'BOM', destination: 'DXB', fareType: FARE_FILTER, sheetAirlines: ['6E', 'AI', 'IX', 'QP', 'SG'] },
  { id: 'RT-DOM', journeyType: 'ROUND_TRIP', tripType: 'DOMESTIC', origin: 'DEL', destination: 'BOM', fareType: FARE_FILTER, sheetAirlines: ['6E', 'AI', 'IX', 'QP', 'SG'] },
  { id: 'RT-INT', journeyType: 'ROUND_TRIP', tripType: 'INTERNATIONAL', origin: 'BOM', destination: 'DXB', fareType: FARE_FILTER, sheetAirlines: ['6E', 'AI', 'IX', 'QP', 'SG'] },
];

function airlineOf(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function cat(f) {
  return String(f?.fareCategory || f?.fareType || '').toUpperCase();
}

function allFares(options) {
  const out = [];
  for (const opt of options || []) {
    const code = airlineOf(opt);
    const fares = Array.isArray(opt.fares) && opt.fares.length ? opt.fares : [null];
    for (const f of fares) {
      out.push({
        airline: code,
        category: f ? cat(f) : null,
        searchId: f?.searchId || opt.searchId,
      });
    }
  }
  return out;
}

function pickSheetAirlines(options, { fareType, sheetAirlines } = {}) {
  const allow = new Set((sheetAirlines || Object.keys(SHEET)).map((c) => String(c).toUpperCase()));
  const wantFare = String(fareType || '').toUpperCase();
  const byAirline = new Map();
  for (const row of allFares(options)) {
    if (!allow.has(row.airline)) continue;
    const cfg = SHEET[row.airline];
    if (!cfg || !row.searchId) continue;
    // Prefer fareCategory matching the search fareType / sheet fareType
    const exactSheet = row.category === cfg.fareType;
    const exactSearch = wantFare && row.category === wantFare;
    const score = exactSheet ? 3 : exactSearch ? 2 : row.category ? 1 : 0;
    const prev = byAirline.get(row.airline);
    if (!prev || score > prev.score) {
      byAirline.set(row.airline, { ...row, score, expectedFareType: cfg.fareType, sheetName: cfg.name });
    }
  }
  return [...byAirline.values()].sort((a, b) => a.airline.localeCompare(b.airline));
}

function chargeByWindow(charges = []) {
  const before = charges.find((c) => String(c.window || '').toUpperCase() === 'BEFORE'
    || /more than 24/i.test(String(c.label || '')));
  const within = charges.find((c) => String(c.window || '').toUpperCase() === 'WITHIN'
    || /within 24/i.test(String(c.label || '')));
  return { before, within };
}

/**
 * Shapes seen in dumps:
 *  - fareRules: top-level reschedulePolicies[] = [{ direction, reschedulePolicies: { charges, online, offline } }]
 *  - details/pricing: itinerary[i].reschedulePolicies = { charges, online, offline } (object, not array)
 */
function normalizePolicyObject(rp, direction = 'ONWARD') {
  if (!rp || typeof rp !== 'object' || Array.isArray(rp)) return null;
  const charges = rp.charges || [];
  const online = rp.online || null;
  const offline = rp.offline || null;
  if (!charges.length && !online && !offline) return null;
  return { direction, charges, online, offline };
}

function extractRescheduleBlocks(data) {
  const found = [];
  const visit = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const rp = node.reschedulePolicies;
    if (rp != null) {
      if (Array.isArray(rp)) {
        // fareRules shape
        for (const block of rp) {
          const nested = block?.reschedulePolicies
            && typeof block.reschedulePolicies === 'object'
            && !Array.isArray(block.reschedulePolicies)
            ? block.reschedulePolicies
            : block;
          const norm = normalizePolicyObject(nested, block.direction || node.direction || 'ONWARD');
          if (norm) found.push(norm);
        }
      } else if (typeof rp === 'object') {
        // details/pricing itinerary shape
        const norm = normalizePolicyObject(rp, node.direction || 'ONWARD');
        if (norm) found.push(norm);
      }
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === 'reschedulePolicies') continue;
      visit(v, depth + 1);
    }
  };
  visit(data);

  const seen = new Set();
  return found.filter((b) => {
    const k = `${b.direction}|${b.charges?.[0]?.rescheduleCharge}|${b.online?.serviceFee}|${b.offline?.serviceFee}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function verifyBlock(block, { airline, tripType }) {
  const cfg = SHEET[airline];
  const fees = FEES[tripType];
  const issues = [];
  const { before, within } = chargeByWindow(block.charges || []);
  const beforeAmt = before?.rescheduleCharge;
  const withinAmt = within?.rescheduleCharge;

  if (beforeAmt == null) issues.push('missing BEFORE rescheduleCharge');
  else if (Number(beforeAmt) !== cfg.before24) issues.push(`BEFORE ${beforeAmt} ≠ ${cfg.before24}`);

  if (withinAmt == null) issues.push('missing WITHIN rescheduleCharge');
  else if (Number(withinAmt) !== cfg.within24) issues.push(`WITHIN ${withinAmt} ≠ ${cfg.within24}`);

  const onlineFee = block.online?.serviceFee;
  const offlineFee = block.offline?.serviceFee;
  if (onlineFee == null) issues.push('missing online.serviceFee');
  else if (Number(onlineFee) !== fees.online) issues.push(`onlineFee ${onlineFee} ≠ ${fees.online}`);
  if (offlineFee == null) issues.push('missing offline.serviceFee');
  else if (Number(offlineFee) !== fees.offline) issues.push(`offlineFee ${offlineFee} ≠ ${fees.offline}`);

  const onCut = block.online?.cutoffHoursBeforeDeparture;
  const offCut = block.offline?.cutoffHoursBeforeDeparture;
  if (onCut == null) issues.push('missing online.cutoffHours');
  else if (Number(onCut) !== ONLINE_CUTOFF_H) issues.push(`onlineCutoff ${onCut} ≠ ${ONLINE_CUTOFF_H}`);
  if (offCut == null) issues.push('missing offline.cutoffHours');
  else if (Number(offCut) !== OFFLINE_CUTOFF_H) issues.push(`offlineCutoff ${offCut} ≠ ${OFFLINE_CUTOFF_H}`);

  return {
    status: issues.length ? 'BUG' : 'PASS',
    issues,
    observed: {
      before: beforeAmt,
      within: withinAmt,
      onlineFee,
      offlineFee,
      onlineCutoffH: onCut,
      offlineCutoffH: offCut,
    },
  };
}

function scoreEndpoint(label, res, airline, tripType, { scoreAmounts }) {
  const blocks = extractRescheduleBlocks(res?.data);
  const topKeys = res?.data && typeof res.data === 'object'
    ? Object.keys(res.data).filter((k) => k !== '_meta')
    : [];
  const rawHasKey = JSON.stringify(res?.data || {}).includes('reschedulePolicies');

  if (!res?.ok) {
    return {
      endpoint: label,
      http: res?.status,
      status: 'BUG',
      issues: [`HTTP ${res?.status} ${res?.data?.error?.code || ''}`],
      blockCount: 0,
      topKeys,
      hasReschedulePoliciesKey: rawHasKey,
    };
  }
  if (!blocks.length) {
    return {
      endpoint: label,
      http: res.status,
      status: 'BUG',
      issues: ['reschedulePolicies missing/empty'],
      blockCount: 0,
      topKeys,
      hasReschedulePoliciesKey: rawHasKey,
    };
  }

  if (!scoreAmounts) {
    return {
      endpoint: label,
      http: res.status,
      status: 'PASS',
      issues: ['policies present; amounts not scored (fare lane ≠ sheet)'],
      blockCount: blocks.length,
      topKeys,
      hasReschedulePoliciesKey: true,
      checks: blocks.map((b) => ({
        direction: b.direction,
        observed: {
          before: chargeByWindow(b.charges).before?.rescheduleCharge,
          within: chargeByWindow(b.charges).within?.rescheduleCharge,
          onlineFee: b.online?.serviceFee,
          offlineFee: b.offline?.serviceFee,
        },
      })),
    };
  }

  const checks = blocks.map((b) => ({
    direction: b.direction,
    ...verifyBlock(b, { airline, tripType }),
  }));
  const bad = checks.filter((c) => c.status === 'BUG');
  return {
    endpoint: label,
    http: res.status,
    status: bad.length ? 'BUG' : 'PASS',
    issues: bad.flatMap((c) => (c.issues || []).map((i) => `${c.direction}: ${i}`)),
    blockCount: blocks.length,
    checks,
    topKeys,
    hasReschedulePoliciesKey: true,
  };
}

/** Fare filter kept; airline filter always cleared. */
async function searchOnce(client, body, { fareType, max = 12 } = {}) {
  if (fareType) body.fareType = fareType;
  if (!body.preferences) body.preferences = {};
  body.preferences.airlines = []; // never filter airlines in search
  body.preferences.maxStops = null;
  body.appliedFilters = {};

  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 50, sortby: 'fare,asc' },
      body,
      correlation: true,
    });
    if (!last.ok) {
      if (last.data?.error?.code === 'NO_FLIGHTS_FOUND' && i < max - 1) {
        await sleep(2500);
        continue;
      }
      return last;
    }
    const opts = collectOptions(last.data, 'ONWARD');
    const st = last.data?.progress || {};
    const done = isSearchProgressComplete(last.data)
      || st.state === 'COMPLETE'
      || st.complete === true;
    if (opts.length && (done || i >= 5)) return last;
    if (done) return last;
    await sleep(st.pollAfterMs || 2500);
  }
  return last;
}

async function main() {
  clearSession();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('=== Reschedule sheet (preprod-api) — fare filter only, no airline filter, no book ===');
  console.log('BASE', config.baseUrl, 'tier', config.tierId, 'days', DAYS);
  if (!/preprod-api\.travelvip\.ai/i.test(String(config.baseUrl))) {
    throw new Error(`Wrong host: ${config.baseUrl} — set BASE_URL=https://preprod-api.travelvip.ai`);
  }

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    tierId: config.tierId,
    correlationId: client.correlationId,
    note: 'Search with fareType only (no airline filter); pick available sheet airlines from response; check details+fareRules+pricing; no book',
    sheet: SHEET,
    fees: FEES,
    searches: 0,
    hopCalls: 0,
    rows: [],
    inventorySeen: {},
  };

  for (const sc of SCENARIOS) {
    console.log(`\n## ${sc.id} ${sc.origin}-${sc.destination} ${sc.journeyType} fareType=${sc.fareType}`);

    let searchRes;
    let onwardOptions = [];
    let sharedReturnId = null;

    if (sc.journeyType === 'ONE_WAY') {
      const body = buildOneWaySearchBody(DAYS, {
        origin: sc.origin,
        destination: sc.destination,
        maxStops: null,
        fareType: sc.fareType,
      });
      searchRes = await searchOnce(client, body, { fareType: sc.fareType });
      report.searches += 1;
      onwardOptions = collectOptions(searchRes?.data, 'ONWARD');
    } else {
      const body = buildRoundTripSearchBody(DAYS, DAYS + 5, {
        origin: sc.origin,
        destination: sc.destination,
        maxStops: null,
        fareType: sc.fareType,
      });
      searchRes = await searchOnce(client, body, { fareType: sc.fareType });
      report.searches += 1;
      onwardOptions = collectOptions(searchRes?.data, 'ONWARD');
      const firstId = onwardOptions[0]?.fares?.[0]?.searchId || onwardOptions[0]?.searchId;
      if (searchRes?.ok && firstId) {
        try {
          const refined = { ...body, fareType: sc.fareType, selection: { selectedSearchIds: [firstId] } };
          const ret = await flight.pollReturnSearch(body, refined);
          const retOpts = collectOptions(ret.data, 'RETURN');
          sharedReturnId = retOpts[0]?.fares?.[0]?.searchId || retOpts[0]?.searchId || null;
          report.inventorySeen[`${sc.id}-RETURN`] = [...new Set(retOpts.map(airlineOf).filter(Boolean))];
        } catch (e) {
          console.log(`  return refine: ${e.message || e}`);
        }
      }
    }

    const airlinesInSearch = [...new Set(onwardOptions.map(airlineOf).filter(Boolean))];
    const catsInSearch = [...new Set(allFares(onwardOptions).map((x) => `${x.airline}:${x.category || '?'}`))];
    report.inventorySeen[sc.id] = {
      fareType: sc.fareType,
      airlines: airlinesInSearch,
      fareSamples: catsInSearch.slice(0, 40),
    };
    console.log(`  search http=${searchRes?.status} n=${onwardOptions.length} airlines=${airlinesInSearch.join(',') || 'none'}`);
    console.log(`  fares: ${catsInSearch.slice(0, 20).join(', ') || 'none'}`);

    if (!searchRes?.ok || !onwardOptions.length) {
      report.rows.push({
        scenario: sc.id,
        fareType: sc.fareType,
        status: 'NOT TESTED',
        how: 'fare-filtered search (no airline filter)',
        detail: `http=${searchRes?.status} ${searchRes?.data?.error?.code || 'no options'}`,
      });
      continue;
    }

    const picks = pickSheetAirlines(onwardOptions, {
      fareType: sc.fareType,
      sheetAirlines: sc.sheetAirlines,
    });
    console.log(`  sheet picks: ${picks.map((p) => `${p.airline}:${p.category || '?'}`).join(', ') || 'none'}`);

    if (!picks.length) {
      report.rows.push({
        scenario: sc.id,
        fareType: sc.fareType,
        status: 'NOT TESTED',
        detail: `target airlines absent; saw ${airlinesInSearch.join(',')}`,
      });
      continue;
    }

    for (const pick of picks) {
      const cfg = SHEET[pick.airline];
      let ids = [pick.searchId];
      let journey = 'ONE_WAY';

      if (sc.journeyType === 'ROUND_TRIP') {
        journey = 'ROUND_TRIP';
        if (!sharedReturnId) {
          report.rows.push({
            scenario: sc.id,
            airline: pick.airline,
            name: cfg.name,
            status: 'NOT TESTED',
            detail: 'no shared return searchId',
          });
          continue;
        }
        ids = [pick.searchId, sharedReturnId];
      }

      // Score sheet amounts when fare lane matches sheet (CORPORATE/SME)
      const scoreAmounts = pick.category === cfg.fareType;
      console.log(`  → ${pick.airline} ${cfg.name} act=${pick.category} sheet=${cfg.fareType} scoreAmounts=${scoreAmounts}`);

      const details = await flight.getDetails(ids, journey);
      const rules = await flight.getFareRules(ids, journey);
      const pricing = await flight.getPricing(ids, journey);
      report.hopCalls += 3;

      const endpoints = [
        scoreEndpoint('details', details, pick.airline, sc.tripType, { scoreAmounts }),
        scoreEndpoint('fareRules', rules, pick.airline, sc.tripType, { scoreAmounts }),
        scoreEndpoint('pricing', pricing, pick.airline, sc.tripType, { scoreAmounts }),
      ];

      const anyBug = endpoints.some((e) => e.status === 'BUG');
      const status = anyBug ? 'BUG' : (scoreAmounts ? 'PASS' : 'NOTE');

      report.rows.push({
        scenario: sc.id,
        tripType: sc.tripType,
        searchFareType: sc.fareType,
        airline: pick.airline,
        name: cfg.name,
        expectedFareType: cfg.fareType,
        fareCategory: pick.category,
        fareTypeMatch: scoreAmounts ? 'PASS' : 'NOTE',
        status,
        endpoints,
        searchIds: ids,
      });

      for (const e of endpoints) {
        const mark = e.status === 'PASS' ? '✓' : '✗';
        console.log(`    [${mark}] ${e.endpoint} http=${e.http} policies=${e.blockCount} ${e.status}${e.issues?.length ? ` — ${e.issues.join('; ')}` : ''}`);
      }
    }

    for (const code of sc.sheetAirlines) {
      if (picks.some((p) => p.airline === code)) continue;
      report.rows.push({
        scenario: sc.id,
        searchFareType: sc.fareType,
        airline: code,
        name: SHEET[code].name,
        expectedFareType: SHEET[code].fareType,
        status: 'NOT TESTED',
        detail: `not in fareType=${sc.fareType} search (saw ${airlinesInSearch.join(',') || 'empty'})`,
      });
    }
  }

  const summary = {
    PASS: report.rows.filter((r) => r.status === 'PASS').length,
    BUG: report.rows.filter((r) => r.status === 'BUG').length,
    NOTE: report.rows.filter((r) => r.status === 'NOTE').length,
    NOT_TESTED: report.rows.filter((r) => r.status === 'NOT TESTED').length,
    searches: report.searches,
    hopCalls: report.hopCalls,
  };
  report.summary = summary;

  const md = [
    '# Reschedule policies vs sheet — preprod-api (fare filter, no airline filter)',
    '',
    `- Ran: ${report.ranAt}`,
    `- Base: ${report.baseUrl} · tier ${report.tierId}`,
    `- ${report.note}`,
    `- Searches: ${summary.searches} · hop calls: ${summary.hopCalls} · **no books**`,
    `- **${summary.PASS} PASS** / **${summary.BUG} BUG** / **${summary.NOTE} NOTE** / **${summary.NOT_TESTED} NOT TESTED**`,
    '',
    '| Scenario | Airline | Fare exp/act | details | fareRules | pricing | Status | Issues |',
    '|---|---|---|---|---|---|---|---|',
    ...report.rows.map((r) => {
      const ep = Object.fromEntries((r.endpoints || []).map((e) => [e.endpoint, e]));
      const issues = [];
      if (r.detail) issues.push(r.detail);
      for (const e of r.endpoints || []) for (const i of e.issues || []) issues.push(`${e.endpoint}: ${i}`);
      return `| ${r.scenario} | ${r.airline || '-'} ${r.name || ''} | ${r.expectedFareType || ''}/${r.fareCategory || '-'} | ${ep.details?.status || '-'} | ${ep.fareRules?.status || '-'} | ${ep.pricing?.status || '-'} | ${r.status} | ${issues.join('; ') || '—'} |`;
    }),
    '',
    '## Inventory',
    '```json',
    JSON.stringify(report.inventorySeen, null, 2),
    '```',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, md);
  console.log(`\n=== DONE ${summary.PASS} PASS / ${summary.BUG} BUG / ${summary.NOTE} NOTE / ${summary.NOT_TESTED} NT ===`);
  console.log('Wrote', OUT_MD);
  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

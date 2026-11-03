/**
 * Same as preprod reschedule sheet check, against production.
 * fareType=CORPORATE,SME · DEL-BOM DOM + BOM-DXB INT · details+fareRules+pricing · NO book.
 *
 *   $env:BASE_URL='https://api.travelvip.ai'
 *   $env:TIER_ID='19597201'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='vgm_preprod_ojny1swtigd4as'
 *   $env:SIGNING_KEY='sk_live_yg81bca5xno1ypvhla'
 *   node travel-apis/flight/scripts/probe-reschedule-policies-sheet-prod.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, isSearchProgressComplete } from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'reports');
const OUT_JSON = path.join(OUT_DIR, 'reschedule-policies-corp-sme-dom-int-ow-prod.json');
const OUT_MD = path.join(OUT_DIR, 'reschedule-policies-corp-sme-dom-int-ow-prod.md');

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
const CUT = { online: 4, offline: 12 };
const FARE_FILTER = 'CORPORATE,SME';

function airlineOf(o) {
  return String(o?.segments?.[0]?.airline?.code || '').toUpperCase();
}
function cat(f) {
  return String(f?.fareCategory || f?.fareType || '').toUpperCase();
}
function normalizePolicyObject(rp, direction = 'ONWARD') {
  if (!rp || typeof rp !== 'object' || Array.isArray(rp)) return null;
  if (!(rp.charges || []).length && !rp.online && !rp.offline) return null;
  return { direction, charges: rp.charges || [], online: rp.online || null, offline: rp.offline || null };
}
function extractBlocks(data) {
  const found = [];
  const visit = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) {
      node.forEach((x) => visit(x, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const rp = node.reschedulePolicies;
    if (Array.isArray(rp)) {
      for (const block of rp) {
        const nested = block?.reschedulePolicies && !Array.isArray(block.reschedulePolicies)
          ? block.reschedulePolicies
          : block;
        const n = normalizePolicyObject(nested, block.direction || 'ONWARD');
        if (n) found.push(n);
      }
    } else if (rp && typeof rp === 'object') {
      const n = normalizePolicyObject(rp, node.direction || 'ONWARD');
      if (n) found.push(n);
    }
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'reschedulePolicies') visit(v, depth + 1);
    }
  };
  visit(data);
  const seen = new Set();
  return found.filter((b) => {
    const k = `${b.direction}|${b.charges?.[0]?.rescheduleCharge}|${b.online?.serviceFee}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function verify(block, cfg, tripType) {
  const fees = FEES[tripType];
  const issues = [];
  const before = block.charges.find((c) => c.window === 'BEFORE');
  const within = block.charges.find((c) => c.window === 'WITHIN');
  if (Number(before?.rescheduleCharge) !== cfg.before24) issues.push(`BEFORE ${before?.rescheduleCharge}≠${cfg.before24}`);
  if (Number(within?.rescheduleCharge) !== cfg.within24) issues.push(`WITHIN ${within?.rescheduleCharge}≠${cfg.within24}`);
  if (Number(block.online?.serviceFee) !== fees.online) issues.push(`onlineFee ${block.online?.serviceFee}≠${fees.online}`);
  if (Number(block.offline?.serviceFee) !== fees.offline) issues.push(`offlineFee ${block.offline?.serviceFee}≠${fees.offline}`);
  if (Number(block.online?.cutoffHoursBeforeDeparture) !== CUT.online) issues.push('onlineCut');
  if (Number(block.offline?.cutoffHoursBeforeDeparture) !== CUT.offline) issues.push('offlineCut');
  return {
    status: issues.length ? 'BUG' : 'PASS',
    issues,
    observed: {
      before: before?.rescheduleCharge,
      within: within?.rescheduleCharge,
      onlineFee: block.online?.serviceFee,
      offlineFee: block.offline?.serviceFee,
      onlineCut: block.online?.cutoffHoursBeforeDeparture,
      offlineCut: block.offline?.cutoffHoursBeforeDeparture,
    },
  };
}

async function runScenario(sess, flight, { id, origin, destination, tripType, days }) {
  const body = buildOneWaySearchBody(days, {
    origin,
    destination,
    maxStops: null,
    fareType: FARE_FILTER,
  });
  body.fareType = FARE_FILTER;
  body.preferences.airlines = [];
  body.appliedFilters = {};
  console.log(`\n## ${id} ${origin}-${destination} fareType=${FARE_FILTER} date=${body.itinerary[0].date}`);

  let last;
  for (let i = 0; i < 18; i += 1) {
    last = await sess.client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 50, sortby: 'fare,asc' },
      body,
      correlation: true,
    });
    const opts = collectOptions(last.data, 'ONWARD');
    const air = [...new Set(opts.map(airlineOf))];
    console.log(`  poll ${i} http=${last.status} state=${last.data?.progress?.state} n=${opts.length} air=${air.join(',') || 'none'} ${last.data?.error?.code || ''}`);
    if (!last.ok) {
      if (last.data?.error?.code === 'NO_FLIGHTS_FOUND' && i < 10) {
        await sleep(2500);
        continue;
      }
      break;
    }
    if (isSearchProgressComplete(last.data) || last.data?.progress?.state === 'COMPLETE') break;
    await sleep(last.data?.progress?.pollAfterMs || 3000);
  }

  if (!last?.ok) {
    return {
      id,
      origin,
      destination,
      tripType,
      date: body.itinerary[0].date,
      http: last?.status,
      error: last?.data?.error?.code,
      airlines: [],
      samples: [],
      rows: Object.keys(SHEET).map((code) => ({
        airline: code,
        name: SHEET[code].name,
        expectedFareType: SHEET[code].fareType,
        status: 'NOT TESTED',
        detail: `search http=${last?.status} ${last?.data?.error?.code || ''}`,
      })),
    };
  }

  let allOpts = collectOptions(last.data, 'ONWARD');
  for (let page = 1; page < 4; page += 1) {
    const p = await sess.client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page, perpage: 50, sortby: 'fare,asc' },
      body,
      correlation: true,
    });
    if (!p.ok) break;
    const more = collectOptions(p.data, 'ONWARD');
    if (!more.length) break;
    allOpts = allOpts.concat(more);
    if (more.length < 50) break;
  }

  const airlines = [...new Set(allOpts.map(airlineOf).filter(Boolean))];
  const samples = [...new Set(allOpts.flatMap((o) => (o.fares || []).map((f) => `${airlineOf(o)}:${cat(f)}`)))];
  console.log(`  TOTAL n=${allOpts.length} airlines=${airlines.join(',')}`);
  console.log(`  fares: ${samples.join(', ')}`);

  const picks = new Map();
  for (const opt of allOpts) {
    const code = airlineOf(opt);
    const cfg = SHEET[code];
    if (!cfg) continue;
    for (const f of (opt.fares || [{ searchId: opt.searchId }])) {
      const c = f ? cat(f) : null;
      const sid = f?.searchId || opt.searchId;
      if (!sid) continue;
      const exact = c === cfg.fareType ? 3 : (c === 'CORPORATE' || c === 'SME') ? 2 : 1;
      const prev = picks.get(code);
      if (!prev || exact > prev.score) picks.set(code, { airline: code, category: c, searchId: sid, score: exact });
    }
  }

  const rows = [];
  for (const code of Object.keys(SHEET)) {
    const cfg = SHEET[code];
    const pick = picks.get(code);
    if (!pick) {
      rows.push({
        airline: code,
        name: cfg.name,
        expectedFareType: cfg.fareType,
        status: 'NOT TESTED',
        detail: 'not in search',
      });
      console.log(`  ${code} NT`);
      continue;
    }
    const fareMatch = pick.category === cfg.fareType;
    console.log(`  → ${code} ${cfg.name} act=${pick.category} sheet=${cfg.fareType}`);
    const details = await flight.getDetails([pick.searchId], 'ONE_WAY');
    const rules = await flight.getFareRules([pick.searchId], 'ONE_WAY');
    const pricing = await flight.getPricing([pick.searchId], 'ONE_WAY');
    const endpoints = [details, rules, pricing].map((res, i) => {
      const label = ['details', 'fareRules', 'pricing'][i];
      const blocks = extractBlocks(res?.data);
      if (!res?.ok) {
        return {
          endpoint: label,
          status: 'BUG',
          issues: [`HTTP ${res?.status} ${res?.data?.error?.code || ''}`],
          blockCount: 0,
        };
      }
      if (!blocks.length) {
        return {
          endpoint: label,
          status: 'BUG',
          issues: ['reschedulePolicies missing'],
          blockCount: 0,
        };
      }
      const checks = blocks.map((b) => ({
        direction: b.direction,
        ...verify(b, cfg, tripType),
      }));
      const bad = checks.filter((c) => c.status === 'BUG');
      const issues = bad.flatMap((c) => c.issues.map((x) => `${c.direction}: ${x}`));
      if (!fareMatch && !bad.length) {
        issues.push(`fareCategory ${pick.category} (sheet ${cfg.fareType}); amounts matched sheet`);
      }
      return {
        endpoint: label,
        status: bad.length ? 'BUG' : 'PASS',
        issues,
        blockCount: blocks.length,
        checks,
      };
    });
    const status = endpoints.some((e) => e.status === 'BUG') ? 'BUG' : 'PASS';
    rows.push({
      airline: code,
      name: cfg.name,
      expectedFareType: cfg.fareType,
      fareCategory: pick.category,
      status,
      endpoints,
      searchId: pick.searchId,
    });
    for (const e of endpoints) {
      const mark = e.status === 'PASS' ? '✓' : '✗';
      console.log(`    [${mark}] ${e.endpoint} ${e.status} ${e.issues.join('; ') || JSON.stringify(e.checks?.[0]?.observed || '')}`);
    }
  }
  return {
    id, origin, destination, tripType, date: body.itinerary[0].date, airlines, samples, rows,
  };
}

async function main() {
  clearSession();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== PROD reschedule sheet — CORPORATE,SME — no book ===');
  console.log('BASE', config.baseUrl, 'tier', config.tierId);
  if (!String(config.baseUrl).includes('api.travelvip.ai') || String(config.baseUrl).includes('preprod') || String(config.baseUrl).includes('staging')) {
    throw new Error(`Wrong host for prod probe: ${config.baseUrl}`);
  }

  const sess = await authenticate(true);
  sess.client.setPartnerKey(sess.accessToken);
  const flight = new FlightService(sess.client);

  const dom = await runScenario(sess, flight, {
    id: 'OW-DOM', origin: 'DEL', destination: 'BOM', tripType: 'DOMESTIC', days: 25,
  });
  const intl = await runScenario(sess, flight, {
    id: 'OW-INT', origin: 'BOM', destination: 'DXB', tripType: 'INTERNATIONAL', days: 25,
  });

  const allRows = [
    ...dom.rows.map((r) => ({ scenario: 'OW-DOM', tripType: 'DOMESTIC', route: 'DEL-BOM', ...r })),
    ...intl.rows.map((r) => ({ scenario: 'OW-INT', tripType: 'INTERNATIONAL', route: 'BOM-DXB', ...r })),
  ];
  const summary = {
    PASS: allRows.filter((r) => r.status === 'PASS').length,
    BUG: allRows.filter((r) => r.status === 'BUG').length,
    NT: allRows.filter((r) => r.status === 'NOT TESTED').length,
  };
  const out = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    tierId: config.tierId,
    correlationId: sess.client.correlationId,
    fareType: FARE_FILTER,
    note: 'PROD OW DOM DEL-BOM + OW INT BOM-DXB; details+fareRules+pricing; no book',
    domestic: { date: dom.date, airlines: dom.airlines, samples: dom.samples, error: dom.error },
    international: { date: intl.date, airlines: intl.airlines, samples: intl.samples, error: intl.error },
    summary,
    rows: allRows,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  fs.writeFileSync(OUT_MD, [
    '# Reschedule policies — PROD OW DOM + INT (fareType=CORPORATE,SME)',
    '',
    `- Ran: ${out.ranAt}`,
    `- Base: ${out.baseUrl} · tier ${out.tierId}`,
    `- Correlation: ${out.correlationId}`,
    '- **no books**',
    `- **${summary.PASS} PASS** / **${summary.BUG} BUG** / **${summary.NT} NT**`,
    '',
    '| Scenario | Airline | Fare exp/act | details | fareRules | pricing | Status | Issues |',
    '|---|---|---|---|---|---|---|---|',
    ...allRows.map((r) => {
      const ep = Object.fromEntries((r.endpoints || []).map((e) => [e.endpoint, e]));
      const issues = [];
      if (r.detail) issues.push(r.detail);
      for (const e of r.endpoints || []) for (const i of e.issues || []) issues.push(`${e.endpoint}: ${i}`);
      return `| ${r.scenario} | ${r.airline || ''} ${r.name || ''} | ${r.expectedFareType || ''}/${r.fareCategory || '-'} | ${ep.details?.status || '-'} | ${ep.fareRules?.status || '-'} | ${ep.pricing?.status || '-'} | ${r.status} | ${issues.join('; ') || '—'} |`;
    }),
    '',
    '## Inventory',
    `- DOM: ${(dom.airlines || []).join(', ')} · ${(dom.samples || []).join(', ')}`,
    `- INT: ${(intl.airlines || []).join(', ')} · ${(intl.samples || []).join(', ')}`,
    '',
  ].join('\n'));

  console.log(`\n=== PROD DONE ${summary.PASS} PASS / ${summary.BUG} BUG / ${summary.NT} NT ===`);
  console.log('Wrote', OUT_MD);
  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

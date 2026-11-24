/**
 * ENG-765 reverse order — ONE hit: NORMAL onward + CORPORATE return.
 * Expect: structured cancel/reschedule on RETURN (corp) only; NORMAL onward none.
 * No book. No date loop.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { isSearchProgressComplete } from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.ALLOW_BOOK = 'false';
process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  __dirname,
  '../reports/preprod-mixed-fare-pr1505/eng765-normal-corp-order.json',
);

function fareCat(f) {
  return String(f?.fareCategory || '').toUpperCase() || null;
}

function airline(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function label(opt) {
  return (opt?.segments || [])
    .map((s) => `${String(s.airline?.code || s.airlineCode || '').toUpperCase()} ${s.flightNumber || ''}`.trim())
    .join('/');
}

function pick(options, want) {
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && (f.searchId || opt.searchId)) {
        return {
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          airline: airline(opt),
          label: label(opt),
        };
      }
    }
  }
  return null;
}

function catsIn(options) {
  return [...new Set((options || []).flatMap((o) => (o.fares || []).map(fareCat)).filter(Boolean))].sort();
}

function policyDirs(arr, key = 'direction') {
  return (arr || []).map((x) => x?.[key]).filter(Boolean);
}

function summarizePolicies(body) {
  const cancelDirs = policyDirs(body?.cancellationPolicies);
  const reschedDirs = policyDirs(body?.reschedulePolicies);
  const legs = (body?.legs || []).map((l) => ({
    direction: l.direction,
    fareType: l.fareType,
    fareCategory: l.fareCategory,
    cancelN: Array.isArray(l.cancellationPolicies) ? l.cancellationPolicies.length : (l.cancellationPolicies ? 1 : 0),
    hasReschedule: Boolean(l.reschedulePolicies),
  }));
  return {
    fareType: body?.fareType || null,
    mixedFareType: body?.mixedFareType ?? null,
    cancelDirs,
    reschedDirs,
    legs,
    fareRuleEntries: (body?.fareRules || []).map((r) => ({
      title: r.title,
      fareType: r.fareType,
    })),
  };
}

async function searchUntil(flight, body, max = 16) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    const opts = collectOptions(last.data, 'ONWARD');
    if (last.ok && opts.length && (isSearchProgressComplete(last.data) || i >= 4)) return last;
    if (!last.ok && last.data?.error) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function refineReturn(flight, body, onwardId, max = 12) {
  const refined = { ...body, selection: { selectedSearchIds: [onwardId] } };
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(refined);
    if (collectOptions(last.data, 'RETURN').length || isSearchProgressComplete(last.data)) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function main() {
  clearSession();
  if (!/preprod/i.test(String(config.baseUrl))) {
    throw new Error(`Refuse non-preprod: ${config.baseUrl}`);
  }

  // Same working DOM mix pin as prior CORP+NORMAL success
  const body = {
    itinerary: [
      { origin: 'DEL', destination: 'BOM', date: '2026-11-22' },
      { origin: 'BOM', destination: 'DEL', date: '2026-11-24' },
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

  console.log('=== ENG-765 NORMAL+CORPORATE order — one hit, no book ===');
  console.log('BASE', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const initial = await searchUntil(flight, body);
  let onwardOpts = collectOptions(initial.data, 'ONWARD');
  let returnOpts = collectOptions(initial.data, 'RETURN');
  let onwardCats = catsIn(onwardOpts);
  let returnCats = catsIn(returnOpts);
  console.log('search', initial.status, 'onward', onwardOpts.length, onwardCats.join(','), 'return', returnOpts.length, returnCats.join(','));

  // Must refine after NORMAL onward — dual-list CORP id without refine → INVALID_COMBINATION.
  const normalOnwards = [];
  for (const opt of onwardOpts) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === 'NORMAL' && (f.searchId || opt.searchId)) {
        normalOnwards.push({
          searchId: f.searchId || opt.searchId,
          category: 'NORMAL',
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          airline: airline(opt),
          label: label(opt),
        });
      }
    }
  }
  // de-dupe by searchId, cap attempts (same pin — find inventory, then one price)
  const seen = new Set();
  const candidates = [];
  for (const n of normalOnwards) {
    if (seen.has(n.searchId)) continue;
    seen.add(n.searchId);
    candidates.push(n);
    if (candidates.length >= 6) break;
  }

  let onward = null;
  let ret = null;
  for (const cand of candidates) {
    const retRes = await refineReturn(flight, body, cand.searchId);
    const rOpts = collectOptions(retRes.data, 'RETURN');
    const rCats = catsIn(rOpts);
    const rPick = pick(rOpts, 'CORPORATE');
    console.log('refine NORMAL', cand.label, '→', rOpts.length, rCats.join(',') || '(none)');
    if (rPick && rPick.searchId !== cand.searchId) {
      onward = cand;
      ret = rPick;
      returnOpts = rOpts;
      returnCats = rCats;
      break;
    }
  }

  if (!candidates.length) {
    const out = {
      when: new Date().toISOString(),
      status: 'NOT TESTED',
      reason: 'no NORMAL onward in inventory',
      onwardCats,
      returnCats,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('saved', OUT);
    return;
  }
  if (!onward || !ret) {
    const out = {
      when: new Date().toISOString(),
      status: 'NOT TESTED',
      reason: 'after NORMAL refine, CORPORATE never on return (same pin)',
      tried: candidates.map((c) => c.label),
      onwardCats,
      returnCats,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('saved', OUT);
    return;
  }
  console.log('onward NORMAL', onward.label, onward.searchId);
  console.log('return CORPORATE', ret.label, ret.searchId);
  console.log('cooldown 4s — one pricing/rules hit');
  await sleep(4000);

  const searchIds = [onward.searchId, ret.searchId];
  const details = await flight.getDetails(searchIds, 'ROUND_TRIP');
  const pricing = await flight.getPricing(searchIds, 'ROUND_TRIP');
  const fareRules = await flight.getFareRules(searchIds, 'ROUND_TRIP');

  const dSum = summarizePolicies(details.data);
  const pSum = summarizePolicies(pricing.data);
  const rSum = summarizePolicies(fareRules.data);

  console.log('details', details.status, details.data?.error?.code || details.data?.fareType, 'cancel', dSum.cancelDirs, 'resched', dSum.reschedDirs);
  console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, 'fareType', pricing.data?.fareType, 'cancel', pSum.cancelDirs, 'resched', pSum.reschedDirs);
  console.log('fareRules', fareRules.status, fareRules.data?.error?.code || fareRules.data?.fareType, 'cancel', rSum.cancelDirs, 'resched', rSum.reschedDirs);

  // PASS: MIXED + cancel/reschedule only on RETURN (corp); not on ONWARD (normal)
  const mixedOk = pricing.status === 200
    && (pricing.data?.fareType === 'MIXED' || pricing.data?.mixedFareType === true);
  const rulesOk = fareRules.status === 200 && fareRules.data?.fareType === 'MIXED';
  const corpOnlyCancel = rSum.cancelDirs.length === 1 && rSum.cancelDirs[0] === 'RETURN';
  const corpOnlyResched = rSum.reschedDirs.length === 1 && rSum.reschedDirs[0] === 'RETURN';
  const noOnwardStructured = !rSum.cancelDirs.includes('ONWARD') && !rSum.reschedDirs.includes('ONWARD');

  const status = (!mixedOk || !rulesOk)
    ? (pricing.data?.error?.code || fareRules.data?.error?.code ? 'BUG' : 'BUG')
    : (corpOnlyCancel && corpOnlyResched && noOnwardStructured ? 'PASS' : 'BUG');

  const rows = [
    {
      id: '765-ORDER-MIX',
      rule: 'NORMAL+CORPORATE prices as MIXED',
      status: mixedOk ? 'PASS' : 'BUG',
      actual: `pricing=${pricing.status}/${pricing.data?.error?.code || pricing.data?.priceId} fareType=${pricing.data?.fareType} mixed=${pricing.data?.mixedFareType}`,
    },
    {
      id: '765-ORDER-RULES',
      rule: 'Fare rules MIXED with 2 entries',
      status: rulesOk && (fareRules.data?.fareRules || []).length === 2 ? 'PASS' : 'BUG',
      actual: `http=${fareRules.status} fareType=${fareRules.data?.fareType} entries=${(fareRules.data?.fareRules || []).length}`,
    },
    {
      id: '765-ORDER-POL',
      rule: 'Structured policies on CORPORATE return only; NORMAL onward none',
      status: (corpOnlyCancel && corpOnlyResched && noOnwardStructured) ? 'PASS' : 'BUG',
      expected: 'cancellationPolicies/reschedulePolicies direction=RETURN only',
      actual: `cancelDirs=${rSum.cancelDirs.join(',') || '(none)'} reschedDirs=${rSum.reschedDirs.join(',') || '(none)'}`,
    },
    { id: 'NO-BOOK', rule: 'No issue-ticket', status: 'PASS' },
  ];

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    pairKind: 'NORMAL+CORPORATE',
    onward,
    return: ret,
    searchIds,
    status,
    details: { http: details.status, code: details.data?.error?.code || null, ...dSum, error: details.data?.error || null },
    pricing: {
      http: pricing.status,
      code: pricing.data?.error?.code || null,
      priceId: pricing.data?.priceId || null,
      ...pSum,
      error: pricing.data?.error || null,
    },
    fareRules: {
      http: fareRules.status,
      code: fareRules.data?.error?.code || null,
      ...rSum,
      cancellationPolicies: fareRules.data?.cancellationPolicies || null,
      reschedulePolicies: fareRules.data?.reschedulePolicies || null,
      fareTypes: fareRules.data?.fareTypes || null,
      error: fareRules.data?.error || null,
    },
    rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  const md = [
    '# ENG-765 — Normal + Corporate order',
    '',
    `- When: ${out.when}`,
    `- Pair: NORMAL (${onward.label}) → CORPORATE (${ret.label})`,
    `- Status: **${status}**`,
    '',
    '| ID | Rule | Status | Actual |',
    '|----|------|--------|--------|',
    ...rows.map((r) => `| ${r.id} | ${r.rule} | **${r.status}** | ${String(r.actual || '').replace(/\|/g, '/').slice(0, 180)} |`),
    '',
    'Raw: `eng765-normal-corp-order.json`',
  ].join('\n');
  fs.writeFileSync(OUT.replace(/\.json$/, '.md'), `${md}\n`);
  console.log('STATUS', status);
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

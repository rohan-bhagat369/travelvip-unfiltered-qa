/**
 * Same search tree: (1) Flexi blocked mix (2) single-id fareRules.
 * No book. One search HTTP. No date loop.
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
process.env.BASE_URL = process.env.BASE_URL || 'https://preprod-api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../reports/preprod-mixed-fare-pr1505/blocked-mix-and-single-farerules.json',
);

function fareCat(f) {
  return String(f?.fareCategory || '').toUpperCase();
}

function fareTypeRaw(f) {
  return String(f?.fareType || '');
}

function isFlexi(f) {
  return /flexi/i.test(fareTypeRaw(f)) && !/stretch/i.test(fareTypeRaw(f));
}

function isBlockedSpecial(f) {
  const t = fareTypeRaw(f).toUpperCase();
  const c = fareCat(f);
  return (
    isFlexi(f)
    || /STUDENT/.test(t) || c === 'STUDENT'
    || /DEFENCE|DEFENSE/.test(t) || c === 'DEFENCE'
    || /SENIOR/.test(t) || c === 'SENIOR_CITIZEN'
  );
}

function label(opt) {
  return (opt?.segments || [])
    .map((s) => `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim())
    .join('/');
}

function pickByCat(opts, want) {
  for (const opt of opts || []) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && f.searchId && !isFlexi(f)) {
        return {
          searchId: f.searchId,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          label: label(opt),
          airline: opt.segments?.[0]?.airline?.code,
        };
      }
    }
  }
  return null;
}

function pickFlexi(opts) {
  for (const opt of opts || []) {
    for (const f of opt.fares || []) {
      if (isFlexi(f) && f.searchId) {
        return {
          searchId: f.searchId,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          label: label(opt),
          airline: opt.segments?.[0]?.airline?.code,
          blockedKind: 'FLEXI',
        };
      }
    }
  }
  return null;
}

function pickSpecial(opts) {
  for (const opt of opts || []) {
    for (const f of opt.fares || []) {
      if (isBlockedSpecial(f) && f.searchId) {
        return {
          searchId: f.searchId,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          label: label(opt),
          airline: opt.segments?.[0]?.airline?.code,
          blockedKind: isFlexi(f) ? 'FLEXI' : fareCat(f) || fareTypeRaw(f),
        };
      }
    }
  }
  return null;
}

function errCode(res) {
  return res?.data?.error?.code || null;
}

clearSession();
if (!/preprod/i.test(String(config.baseUrl))) throw new Error(config.baseUrl);

const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const flight = new FlightService(session.client);

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

console.log('=== Same search: blocked mix + single-id fareRules ===');
const search = await flight.search(body);
const onward = collectOptions(search.data, 'ONWARD');
const ret = collectOptions(search.data, 'RETURN');
console.log('search', search.status, search.data?.progress?.state, 'onward', onward.length, 'return', ret.length);

const corpOn = pickByCat(onward, 'CORPORATE');
const smeOn = pickByCat(onward, 'SME');
const normalOn = pickByCat(onward, 'NORMAL');
const onwardAllowed = corpOn || smeOn || normalOn;

const flexiRet = pickFlexi(ret) || pickFlexi(onward);
const specialRet = pickSpecial(ret) || pickSpecial(onward);
const blockedRet = flexiRet || specialRet;

const normalRet = pickByCat(ret, 'NORMAL');
const corpRet = pickByCat(ret, 'CORPORATE');

const rows = [];
const dumps = {
  when: new Date().toISOString(),
  correlationId: session.client.correlationId,
  search: {
    http: search.status,
    progress: search.data?.progress,
    onwardN: onward.length,
    returnN: ret.length,
  },
  picks: { onwardAllowed, blockedRet, normalRet, corpOn, smeOn },
};

function row(id, rule, status, actual) {
  rows.push({ id, rule, status, actual });
  const m = status === 'PASS' ? '✓' : status === 'BUG' ? '✗' : '·';
  console.log(`  [${m}] ${id} ${status} — ${rule}`);
}

row(
  'S0',
  'Same search available',
  search.ok && onward.length ? 'PASS' : 'BUG',
  `http=${search.status} state=${search.data?.progress?.state}`,
);

// ─── 1) Blocked mix: allowed onward + Flexi return ─────────────────────
if (onwardAllowed && blockedRet && onwardAllowed.searchId !== blockedRet.searchId) {
  console.log('blocked pair', onwardAllowed.fareCategory, onwardAllowed.label, '+', blockedRet.blockedKind, blockedRet.fareType, blockedRet.label);
  await sleep(3000);
  const ids = [onwardAllowed.searchId, blockedRet.searchId];
  // If flexi is on onward list only, use as return slot still (pairing check)
  const details = await flight.getDetails(ids, 'ROUND_TRIP');
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  dumps.blocked = {
    searchIds: ids,
    onward: onwardAllowed,
    blocked: blockedRet,
    details: { http: details.status, code: errCode(details), error: details.data?.error || null, fareType: details.data?.fareType },
    pricing: {
      http: pricing.status,
      code: errCode(pricing),
      priceId: pricing.data?.priceId || null,
      fareType: pricing.data?.fareType || null,
      error: pricing.data?.error || null,
    },
  };
  console.log('blocked details', details.status, errCode(details) || 'ok');
  console.log('blocked pricing', pricing.status, errCode(pricing) || pricing.data?.priceId);

  const blockedOk = errCode(details) === 'INVALID_COMBINATION' || errCode(pricing) === 'INVALID_COMBINATION';
  const accepted = pricing.status === 200 && pricing.data?.priceId;
  row(
    '763-BLOCK-FLEXI',
    `Block ${onwardAllowed.fareCategory}+${blockedRet.blockedKind} (${blockedRet.fareType})`,
    blockedOk ? 'PASS' : (accepted ? 'BUG' : (errCode(pricing) === 'VENDOR_ERROR' ? 'NOT TESTED' : 'BUG')),
    `details=${details.status}/${errCode(details) || 'ok'} pricing=${pricing.status}/${errCode(pricing) || pricing.data?.priceId || 'ok'} note=${accepted ? 'ACCEPTED as combinable — Flexi may be treated as NORMAL' : ''}`,
  );
} else {
  row('763-BLOCK-FLEXI', 'Block Flexi/Student/Defence/Senior mix', 'NOT TESTED', 'no flexi/special fare searchId in this page');
}

// ─── 2) Single-id fareRules (corp onward alone, normal return alone) ───
const singleOn = corpOn || smeOn || normalOn;
const singleRet = normalRet || corpRet || pickByCat(ret, 'SME');

if (singleOn) {
  await sleep(2500);
  const rulesOn = await flight.getFareRules([singleOn.searchId], 'ROUND_TRIP');
  const entriesOn = rulesOn.data?.fareRules || rulesOn.data?.rules || [];
  dumps.singleOnward = {
    searchId: singleOn.searchId,
    pick: singleOn,
    http: rulesOn.status,
    code: errCode(rulesOn),
    fareType: rulesOn.data?.fareType,
    mixedFareType: rulesOn.data?.mixedFareType,
    entryCount: Array.isArray(entriesOn) ? entriesOn.length : null,
    titles: Array.isArray(entriesOn) ? entriesOn.map((e) => e.title) : [],
    entryFareTypes: Array.isArray(entriesOn) ? entriesOn.map((e) => e.fareType) : [],
    error: rulesOn.data?.error || null,
  };
  console.log('single onward fareRules', rulesOn.status, 'entries', dumps.singleOnward.entryCount, dumps.singleOnward.titles);
  row(
    '768-SINGLE-ONWARD',
    'RT fareRules with only onward searchId → that leg only',
    rulesOn.status === 200 && dumps.singleOnward.entryCount === 1
      ? 'PASS'
      : (rulesOn.status === 200 && dumps.singleOnward.entryCount === 2
        ? 'BUG'
        : (errCode(rulesOn) ? 'BUG' : 'NOT TESTED')),
    `http=${rulesOn.status} entries=${dumps.singleOnward.entryCount} titles=${dumps.singleOnward.titles.join(' | ')} fareType=${rulesOn.data?.fareType}`,
  );
} else {
  row('768-SINGLE-ONWARD', 'RT fareRules single onward id', 'NOT TESTED', 'no onward id');
}

if (singleRet) {
  await sleep(2500);
  const rulesRet = await flight.getFareRules([singleRet.searchId], 'ROUND_TRIP');
  const entriesRet = rulesRet.data?.fareRules || rulesRet.data?.rules || [];
  dumps.singleReturn = {
    searchId: singleRet.searchId,
    pick: singleRet,
    http: rulesRet.status,
    code: errCode(rulesRet),
    fareType: rulesRet.data?.fareType,
    mixedFareType: rulesRet.data?.mixedFareType,
    entryCount: Array.isArray(entriesRet) ? entriesRet.length : null,
    titles: Array.isArray(entriesRet) ? entriesRet.map((e) => e.title) : [],
    entryFareTypes: Array.isArray(entriesRet) ? entriesRet.map((e) => e.fareType) : [],
    error: rulesRet.data?.error || null,
  };
  console.log('single return fareRules', rulesRet.status, 'entries', dumps.singleReturn.entryCount, dumps.singleReturn.titles);
  row(
    '768-SINGLE-RETURN',
    'RT fareRules with only return searchId → that leg only',
    rulesRet.status === 200 && dumps.singleReturn.entryCount === 1
      ? 'PASS'
      : (rulesRet.status === 200 && dumps.singleReturn.entryCount === 2
        ? 'BUG'
        : (errCode(rulesRet) ? 'BUG' : 'NOT TESTED')),
    `http=${rulesRet.status} entries=${dumps.singleReturn.entryCount} titles=${dumps.singleReturn.titles.join(' | ')} fareType=${rulesRet.data?.fareType}`,
  );
} else {
  row('768-SINGLE-RETURN', 'RT fareRules single return id', 'NOT TESTED', 'no return id');
}

row('NO-BOOK', 'No issue-ticket', 'PASS', '');

const counts = rows.reduce((a, r) => {
  a[r.status] = (a[r.status] || 0) + 1;
  return a;
}, {});

const out = { counts, rows, dumps };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
const md = [
  '# Blocked mix + single-id fareRules (same search)',
  '',
  `- When: ${dumps.when}`,
  `- Dates: 2026-11-22 / 2026-11-24`,
  `- Counts: ${JSON.stringify(counts)}`,
  '',
  '| ID | Rule | Status | Actual |',
  '|----|------|--------|--------|',
  ...rows.map((r) => `| ${r.id} | ${r.rule} | **${r.status}** | ${String(r.actual || '').replace(/\|/g, '/').slice(0, 200)} |`),
  '',
  'Raw: `blocked-mix-and-single-farerules.json`',
].join('\n');
fs.writeFileSync(OUT.replace(/\.json$/, '.md'), `${md}\n`);
console.log('Counts', counts);
console.log('saved', OUT);

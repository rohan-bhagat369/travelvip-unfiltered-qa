/**
 * Morning mix fareRules, correct RT steps (fixes dual-list INVALID_COMBINATION):
 * search → COMPLETE → pick onward cat → refine return → pick return cat
 * → details + pricing + fareRules once. No book.
 *
 * ORDER=corp-normal (default) | normal-corp
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

const ORDER = String(process.env.MIX_ORDER || 'normal-corp').toLowerCase();
const onwardWant = ORDER === 'corp-normal' ? 'CORPORATE' : 'NORMAL';
const returnWant = ORDER === 'corp-normal' ? 'NORMAL' : 'CORPORATE';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  __dirname,
  `../reports/preprod-mixed-fare-pr1505/farerules-${ORDER}.json`,
);

function fareCat(f) {
  return String(f?.fareCategory || '').toUpperCase();
}

function pick(opts, want) {
  for (const opt of opts || []) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && f.searchId) {
        return {
          searchId: f.searchId,
          fareType: f.fareType,
          fareCategory: f.fareCategory,
          airline: opt.segments?.[0]?.airline?.code,
          label: (opt.segments || [])
            .map((s) => `${s.airline?.code || ''} ${s.flightNumber || ''}`.trim())
            .join('/'),
        };
      }
    }
  }
  return null;
}

async function searchUntil(flight, body, max = 14) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await flight.search(body);
    const n = collectOptions(last.data, 'ONWARD').length;
    console.log('search', last.status, last.data?.progress?.state, 'onward', n);
    if (last.ok && n && (isSearchProgressComplete(last.data) || i >= 5)) return last;
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
    const n = collectOptions(last.data, 'RETURN').length;
    console.log('refine', last.status, last.data?.progress?.state, 'return', n);
    if (n || isSearchProgressComplete(last.data)) return last;
    await sleep(last.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

clearSession();
if (!/preprod/i.test(String(config.baseUrl))) throw new Error(config.baseUrl);

console.log('=== mix fareRules', ORDER, `(${onwardWant} → ${returnWant}) ===`);

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

const initial = await searchUntil(flight, body);
const o = pick(collectOptions(initial.data, 'ONWARD'), onwardWant);
if (!o) {
  console.log('no onward', onwardWant);
  process.exit(1);
}
console.log('onward', o.label, o.fareCategory, o.searchId);

const retRes = await refineReturn(flight, body, o.searchId);
const returnCats = [...new Set(collectOptions(retRes.data, 'RETURN').flatMap((x) => (x.fares || []).map(fareCat)))];
console.log('return cats', returnCats.join(',') || '(none)');
const r = pick(collectOptions(retRes.data, 'RETURN'), returnWant);
if (!r) {
  const out = {
    when: new Date().toISOString(),
    pairKind: `${onwardWant}+${returnWant}`,
    status: 'NOT TESTED',
    reason: `no ${returnWant} on return after ${onwardWant} refine`,
    onward: o,
    returnCats,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('NOT TESTED — saved', OUT);
  process.exit(0);
}
console.log('return', r.label, r.fareCategory, r.searchId);

await sleep(3000);
const ids = [o.searchId, r.searchId];
const details = await flight.getDetails(ids, 'ROUND_TRIP');
const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
const rules = await flight.getFareRules(ids, 'ROUND_TRIP');

const out = {
  when: new Date().toISOString(),
  pairKind: `${onwardWant}+${returnWant}`,
  pair: { onward: o, return: r },
  searchIds: ids,
  details: {
    http: details.status,
    code: details.data?.error?.code || null,
    message: details.data?.error?.message || null,
    fareType: details.data?.fareType || null,
    mixedFareType: details.data?.mixedFareType ?? null,
  },
  pricing: {
    http: pricing.status,
    code: pricing.data?.error?.code || null,
    message: pricing.data?.error?.message || null,
    priceId: pricing.data?.priceId || null,
    fareType: pricing.data?.fareType || null,
    mixedFareType: pricing.data?.mixedFareType ?? null,
  },
  http: rules.status,
  fareRules: rules.data,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok');
console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, pricing.data?.fareType);
console.log('fareRules', rules.status, rules.data?.error?.code || rules.data?.fareType);
console.log('cancelDirs', (rules.data?.cancellationPolicies || []).map((x) => x.direction));
console.log('reschedDirs', (rules.data?.reschedulePolicies || []).map((x) => x.direction));
const fr = rules.data?.fareRules || [];
console.log('entries', fr.length);
for (const e of fr) {
  console.log('-', e.title, '|', e.fareType, '| textLen', String(e.text || '').length);
}
console.log('saved', OUT);

/**
 * Same steps as morning dump-farerules-once-preprod.js / user-flow:
 * DEL-BOM 22→24 · fareType NORMAL,CORPORATE,SME · one search (to COMPLETE)
 * → pick NORMAL onward + CORPORATE return from same response
 * → details + pricing + fareRules once. No book.
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

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../reports/preprod-mixed-fare-pr1505/farerules-normal-corp-order.json',
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

let search = null;
for (let i = 0; i < 14; i += 1) {
  search = await flight.search(body);
  const n = collectOptions(search.data, 'ONWARD').length;
  console.log('search', search.status, search.data?.progress?.state, 'onward', n);
  if (search.ok && n && (isSearchProgressComplete(search.data) || i >= 5)) break;
  if (!search.ok && search.data?.error) break;
  await sleep(search.data?.progress?.pollAfterMs || 2500);
}

const o = pick(collectOptions(search.data, 'ONWARD'), 'NORMAL');
const r = pick(collectOptions(search.data, 'RETURN'), 'CORPORATE');
if (!o || !r) {
  console.log('no pair');
  process.exit(1);
}
console.log('pair', o.label, o.fareCategory, '→', r.label, r.fareCategory);

await sleep(3000);
const ids = [o.searchId, r.searchId];
const details = await flight.getDetails(ids, 'ROUND_TRIP');
const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
const rules = await flight.getFareRules(ids, 'ROUND_TRIP');

const out = {
  when: new Date().toISOString(),
  pairKind: 'NORMAL+CORPORATE',
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
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok');
console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId);
console.log('fareRules', rules.status, rules.data?.error?.code || rules.data?.fareType);
console.log('cancelDirs', (rules.data?.cancellationPolicies || []).map((x) => x.direction));
console.log('reschedDirs', (rules.data?.reschedulePolicies || []).map((x) => x.direction));
console.log('saved', OUT);

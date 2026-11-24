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
  '../reports/preprod-mixed-fare-pr1505/seatmap-full-response.json',
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

const search = await flight.search(body);
const o = pick(collectOptions(search.data, 'ONWARD'), 'CORPORATE');
const r = pick(collectOptions(search.data, 'RETURN'), 'NORMAL');
if (!o || !r) {
  console.log('no pair');
  process.exit(1);
}
console.log('pair', o.label, '→', r.label);

await sleep(3000);
const pricing = await flight.getPricing([o.searchId, r.searchId], 'ROUND_TRIP');
console.log('pricing', pricing.status, pricing.data?.priceId, pricing.data?.fareType);

if (!pricing.data?.bookingContext) {
  fs.writeFileSync(OUT, JSON.stringify({ pricing: pricing.data }, null, 2));
  console.log('no bookingContext');
  process.exit(0);
}

await sleep(2000);
const seat = await flight.getSeatMap(pricing.data.bookingContext);
const out = {
  when: new Date().toISOString(),
  pair: { onward: o, return: r },
  priceId: pricing.data.priceId,
  fareType: pricing.data.fareType,
  mixedFareType: pricing.data.mixedFareType,
  seatmapHttp: seat.status,
  seatmap: seat.data,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('seatmap http', seat.status, 'requestStatus', seat.data?.requestStatus);
console.log('top keys', Object.keys(seat.data || {}));
console.log('saved', OUT, 'bytes', fs.statSync(OUT).size);

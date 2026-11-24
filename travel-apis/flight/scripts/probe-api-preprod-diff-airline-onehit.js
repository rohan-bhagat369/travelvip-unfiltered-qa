/**
 * One pinned search on api-preprod → one DIFF-airline mixed fare → seatmap.
 * No book. Same dates as CORP↔NORMAL probe.
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
const OUT = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505/api-preprod-onehit-diff-airline.json');

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
  if (t.includes('CORPORATE')) return 'CORPORATE';
  if (t.includes('SME')) return 'SME';
  return t ? 'NORMAL' : null;
}
function airline(o) {
  return String(o?.segments?.[0]?.airline?.code || o?.segments?.[0]?.airlineCode || '').toUpperCase();
}
function label(o) {
  return (o?.segments || [])
    .map((s) => `${String(s.airline?.code || s.airlineCode || '').toUpperCase()} ${s.flightNumber || ''}`.trim())
    .join('/');
}
function pick(options, want) {
  const out = [];
  for (const opt of options || []) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && (f.searchId || opt.searchId)) {
        out.push({
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType,
          airline: airline(opt),
          label: label(opt),
        });
      }
    }
  }
  return out;
}

async function main() {
  clearSession();
  if (!/api-preprod\.travelvip\.ai/i.test(String(config.baseUrl))) {
    throw new Error(`Wrong host ${config.baseUrl}`);
  }
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  console.log('=== DIFF-AIRLINE onehit ===', config.baseUrl);

  let search;
  for (let i = 1; i <= 12; i += 1) {
    search = await flight.client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 50, sortby: 'fare,asc' },
      body: BODY,
      correlation: true,
    });
    console.log('poll', i, search.status, search.data?.progress?.state);
    if (search.ok && search.data?.progress?.state === 'COMPLETE') break;
    await sleep(3500);
  }

  const onward = collectOptions(search.data, 'ONWARD');
  const ret = collectOptions(search.data, 'RETURN');
  const combos = [
    ['CORPORATE', 'NORMAL'],
    ['NORMAL', 'CORPORATE'],
    ['SME', 'NORMAL'],
    ['NORMAL', 'SME'],
  ];

  let pair = null;
  const attempts = [];
  for (const [oc, rc] of combos) {
    for (const o of pick(onward, oc)) {
      for (const r of pick(ret, rc)) {
        if (o.searchId === r.searchId || o.airline === r.airline) continue;
        attempts.push({ o, r, kind: `${oc}+${rc}` });
      }
    }
  }
  // Prefer CORP mixes first (already ordered by combos)
  pair = attempts[0] || null;
  if (!pair) {
    console.log('NO DIFF PAIR');
    fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), verdict: 'NOT TESTED', reason: 'no diff-airline mix' }, null, 2));
    return;
  }

  // Try up to 3 diff pairs until pricing succeeds
  let hop = null;
  for (let i = 0; i < Math.min(3, attempts.length); i += 1) {
    const p = attempts[i];
    console.log(`try ${i + 1}`, p.kind, p.o.label, '->', p.r.label);
    await sleep(2500);
    const ids = [p.o.searchId, p.r.searchId];
    const details = await flight.getDetails(ids, 'ROUND_TRIP');
    const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
    console.log(' details', details.status, details.data?.error?.code || details.data?.fareType, 'mixed', details.data?.mixedFareType);
    console.log(' pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, pricing.data?.fareType);
    if (!(pricing.status === 200 && pricing.data?.priceId)) {
      hop = {
        pair: p,
        details: { http: details.status, code: details.data?.error?.code, fareType: details.data?.fareType, mixed: details.data?.mixedFareType },
        pricing: { http: pricing.status, code: pricing.data?.error?.code },
      };
      continue;
    }
    const rules = await flight.getFareRules(ids, 'ROUND_TRIP');
    await sleep(1500);
    const ssr = await flight.getSsr(pricing.data.priceId);
    let seat = null;
    if (pricing.data.bookingContext) {
      await sleep(1500);
      seat = await flight.getSeatMap(pricing.data.bookingContext);
    }
    const segs = (seat?.data?.segments || []).map((s) => ({
      leg: s.legNumber,
      dir: s.direction,
      o: s.origin,
      d: s.destination,
      n: (s.seatMap || []).length,
    }));
    const both = segs.filter((s) => s.n > 0).length >= 2;
    hop = {
      pair: { kind: p.kind, onward: p.o, return: p.r, airlines: `${p.o.airline}+${p.r.airline}` },
      details: { http: details.status, fareType: details.data?.fareType, mixed: details.data?.mixedFareType },
      pricing: {
        http: pricing.status,
        priceId: pricing.data.priceId,
        fareType: pricing.data.fareType,
        mixed: pricing.data.mixedFareType,
      },
      fareRules: {
        http: rules.status,
        fareType: rules.data?.fareType,
        entries: (rules.data?.fareRules || []).map((e) => ({ title: e.title, fareType: e.fareType || e.fareCategory })),
      },
      ssr: { http: ssr.status },
      seatmap: { http: seat?.status, requestStatus: seat?.data?.requestStatus, segments: segs, bothLegsSeats: both },
      verdict: seat?.status === 200 && both ? 'PASS' : 'BUG',
    };
    break;
  }

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    request: BODY,
    candidates: attempts.slice(0, 5).map((a) => `${a.kind} ${a.o.label}->${a.r.label}`),
    hop,
    verdict: hop?.verdict || hop?.pricing?.code || 'NOT TESTED',
    noBook: true,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('VERDICT', out.verdict);
  console.log('saved', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

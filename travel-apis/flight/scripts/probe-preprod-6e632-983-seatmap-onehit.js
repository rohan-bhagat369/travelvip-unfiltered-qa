/**
 * One-hit: DEL↔BOM 26→28 · find return 6E 632 + 6E 983 · price + seatmap.
 * No book. No date step.
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   node travel-apis/flight/scripts/probe-preprod-6e632-983-seatmap-onehit.js
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
// Prefer api-preprod (PR #1505 QA host); allow override via BASE_URL
process.env.BASE_URL = process.env.BASE_URL || 'https://api-preprod.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.TIER_ID = process.env.TIER_ID || '19597201';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505/preprod-6e632-983-seatmap-onehit.json');
const OUT_POSTMAN = path.join(__dirname, '../reports/preprod-mixed-fare-pr1505/preprod-6e632-983-seatmap-postman.json');

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

function segFlightKey(s) {
  const code = String(s.airline?.code || s.airlineCode || '').toUpperCase();
  // Prefer raw flightNumber digits; strip leading airline code if embedded ("6E632" / "632")
  let raw = String(s.flightNumber || '').toUpperCase().replace(/\s+/g, '');
  if (code && raw.startsWith(code)) raw = raw.slice(code.length);
  const num = raw.replace(/\D/g, '');
  return { code, num, label: `${code} ${num}`.trim() };
}

function flightNums(opt) {
  return (opt?.segments || []).map((s) => segFlightKey(s).label);
}

function label(opt) {
  return flightNums(opt).join('/');
}

function matchesReturn6E(opt) {
  const segs = opt?.segments || [];
  if (segs.length < 2) return false;
  const keys = segs.map(segFlightKey);
  // Exact 6E 632 then 6E 983 (BOM-AMD / AMD-DEL) — do NOT match 6632/6983
  const has632 = keys.some((k) => k.code === '6E' && k.num === '632');
  const has983 = keys.some((k) => k.code === '6E' && k.num === '983');
  if (!(has632 && has983)) return false;
  const routes = segs.map((s) => `${String(s.origin || s.departureAirport || '').toUpperCase()}-${String(s.destination || s.arrivalAirport || '').toUpperCase()}`);
  // If route fields present, require BOM-AMD + AMD-DEL
  if (routes.some(Boolean) && routes.join('').length > 2) {
    return routes.includes('BOM-AMD') && routes.includes('AMD-DEL');
  }
  return true;
}

function pickFare(opt, prefer = ['NORMAL', 'SME', 'CORPORATE']) {
  for (const want of prefer) {
    for (const f of opt.fares || []) {
      if (fareCat(f) === want && (f.searchId || opt.searchId)) {
        return {
          searchId: f.searchId || opt.searchId,
          category: want,
          fareType: f.fareType || null,
          fareCategory: f.fareCategory || want,
          label: label(opt),
          flights: flightNums(opt),
        };
      }
    }
  }
  return null;
}

function seatSummary(data) {
  const segs = data?.segments || [];
  return segs.map((s) => {
    const seats = Array.isArray(s.seatMap) ? s.seatMap : [];
    const open = seats.filter((x) => String(x.status || x.seatStatus || '').toLowerCase() === 'open').length;
    const closed = seats.filter((x) => String(x.status || x.seatStatus || '').toLowerCase() === 'closed').length;
    return {
      direction: s.direction || null,
      legNumber: s.legNumber ?? null,
      origin: s.origin || s.departureAirport || null,
      destination: s.destination || s.arrivalAirport || null,
      airline: String(s.airline?.code || s.airlineCode || '').toUpperCase() || null,
      flightNumber: s.flightNumber || null,
      seatCount: seats.length,
      openCount: open,
      closedCount: closed,
    };
  });
}

async function main() {
  clearSession();
  if (!/preprod/i.test(String(config.baseUrl))) {
    throw new Error(`Refuse non-preprod: ${config.baseUrl}`);
  }

  console.log('=== 6E 632 + 6E 983 seatmap onehit — no book ===');
  console.log('BASE', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  // One pinned search — poll same body until COMPLETE (not a new OD)
  let search;
  let state;
  for (let i = 1; i <= 18; i += 1) {
    search = await flight.client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 50, sortby: 'fare,asc' },
      body: BODY,
      correlation: true,
    });
    state = search.data?.progress?.state || null;
    console.log('search poll', i, search.status, state);
    if (search.ok && state === 'COMPLETE') break;
    if (!search.ok) break;
    await sleep(3500);
  }

  const onwardOpts = collectOptions(search.data, 'ONWARD');
  const returnOpts = collectOptions(search.data, 'RETURN');
  console.log('onward', onwardOpts.length, 'return', returnOpts.length);

  const targetReturns = returnOpts.filter(matchesReturn6E);
  console.log('return matches 6E632+6E983:', targetReturns.length);
  for (const o of targetReturns.slice(0, 5)) {
    console.log(' -', label(o), 'cats', [...new Set((o.fares || []).map(fareCat))].join(','));
  }

  if (!targetReturns.length) {
    // dump nearby 6E return labels for debug
    const e6 = returnOpts.filter((o) => flightNums(o).some((n) => n.startsWith('6E')));
    console.log('sample 6E returns:', e6.slice(0, 15).map(label));
    const out = {
      when: new Date().toISOString(),
      baseUrl: config.baseUrl,
      verdict: 'NOT TESTED',
      reason: '6E 632 / 6E 983 return not found in this search page',
      sample6EReturns: e6.slice(0, 25).map(label),
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('saved', OUT);
    return;
  }

  const retPick = pickFare(targetReturns[0], ['NORMAL', 'SME', 'CORPORATE']);
  // Prefer same-airline 6E onward NORMAL for clean same-airline seatmap; else any
  let onwardPick = null;
  for (const opt of onwardOpts) {
    const nums = flightNums(opt);
    if (!nums.some((n) => n.startsWith('6E'))) continue;
    onwardPick = pickFare(opt, ['NORMAL', 'SME', 'CORPORATE']);
    if (onwardPick) break;
  }
  if (!onwardPick) {
    for (const opt of onwardOpts) {
      onwardPick = pickFare(opt, ['NORMAL', 'SME', 'CORPORATE']);
      if (onwardPick) break;
    }
  }

  if (!onwardPick || !retPick) {
    const out = { when: new Date().toISOString(), verdict: 'NOT TESTED', reason: 'could not pick fares', onwardPick, retPick };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('saved', OUT);
    return;
  }

  console.log('onward', onwardPick.label, onwardPick.category, onwardPick.searchId);
  console.log('return', retPick.label, retPick.category, retPick.searchId);

  await sleep(3000);
  const ids = [onwardPick.searchId, retPick.searchId];
  const details = await flight.getDetails(ids, 'ROUND_TRIP');
  const pricing = await flight.getPricing(ids, 'ROUND_TRIP');
  console.log('details', details.status, details.data?.error?.code || details.data?.fareType || 'ok', 'mixed', details.data?.mixedFareType);
  console.log('pricing', pricing.status, pricing.data?.error?.code || pricing.data?.priceId, pricing.data?.fareType);

  let ssr = null;
  let seat = null;
  let fareRules = null;
  if (pricing.status === 200 && pricing.data?.priceId) {
    fareRules = await flight.getFareRules(ids, 'ROUND_TRIP');
    await sleep(1500);
    ssr = await flight.getSsr(pricing.data.priceId);
    if (pricing.data.bookingContext) {
      await sleep(1500);
      seat = await flight.getSeatMap(pricing.data.bookingContext);
    }
  }

  const segs = seat ? seatSummary(seat.data) : [];
  const targetSegs = segs.filter((s) => {
    const fn = String(s.flightNumber || '').replace(/\D/g, '');
    return fn === '632' || fn === '983' || `${s.origin}-${s.destination}` === 'BOM-AMD' || `${s.origin}-${s.destination}` === 'AMD-DEL';
  });
  const bothReturnHops = segs.filter((s) => (s.origin === 'BOM' && s.destination === 'AMD') || (s.origin === 'AMD' && s.destination === 'DEL') || String(s.flightNumber || '').includes('632') || String(s.flightNumber || '').includes('983'));
  const seatsOk = segs.filter((s) => s.seatCount > 0).length >= 2
    || (bothReturnHops.length >= 2 && bothReturnHops.every((s) => s.seatCount > 0));

  console.log('ssr', ssr?.status ?? 'skip');
  console.log('seatmap', seat?.status ?? 'skip', seat?.data?.requestStatus, 'segs', JSON.stringify(segs));

  const verdict = pricing.data?.priceId
    ? (seat?.status === 200 && seatsOk ? 'PASS' : (seat?.status === 200 ? 'BUG' : 'BUG'))
    : `FAIL:${pricing.data?.error?.code || pricing.status}`;

  const out = {
    when: new Date().toISOString(),
    baseUrl: config.baseUrl,
    correlationId: session.client.correlationId,
    request: BODY,
    targetFlights: ['6E 632 BOM-AMD', '6E 983 AMD-DEL'],
    search: { http: search.status, state },
    pair: { onward: onwardPick, return: retPick },
    details: {
      http: details.status,
      code: details.data?.error?.code || null,
      fareType: details.data?.fareType ?? null,
      mixedFareType: details.data?.mixedFareType ?? null,
    },
    pricing: {
      http: pricing.status,
      code: pricing.data?.error?.code || null,
      priceId: pricing.data?.priceId || null,
      fareType: pricing.data?.fareType ?? null,
      mixedFareType: pricing.data?.mixedFareType ?? null,
      bookingContext: pricing.data?.bookingContext || null,
    },
    fareRules: fareRules
      ? { http: fareRules.status, fareType: fareRules.data?.fareType, entries: (fareRules.data?.fareRules || []).length }
      : null,
    ssr: ssr ? { http: ssr.status } : null,
    seatmap: seat
      ? {
          http: seat.status,
          code: seat.data?.error?.code || null,
          requestStatus: seat.data?.requestStatus || null,
          status: seat.data?.status ?? null,
          segments: segs,
          targetRelated: targetSegs,
          seatsOnMultipleSegments: seatsOk,
        }
      : null,
    verdict,
    noBook: true,
  };

  const postman = {
    note: 'Set flight_pricing_booking_reference = pricing.bookingContext. Seatmap body uses requestReference.',
    baseUrl: config.baseUrl,
    priceId: pricing.data?.priceId || null,
    flight_pricing_booking_reference: pricing.data?.bookingContext || null,
    endpoint: 'POST /v1/flights/seatmap?lang=en&currency=INR',
    seatmapBody: pricing.data?.bookingContext
      ? {
          currency: 'INR',
          requestReference: pricing.data.bookingContext,
          passengers: [
            {
              paxRefNumber: '1',
              passengerType: 1,
              gender: 'Male',
              title: 'Mr',
              firstName: 'Rohan',
              lastName: 'Bhagat',
            },
          ],
        }
      : null,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  fs.writeFileSync(OUT_POSTMAN, JSON.stringify(postman, null, 2));
  console.log('VERDICT', verdict);
  console.log('saved', OUT);
  console.log('postman', OUT_POSTMAN);
  if (postman.flight_pricing_booking_reference) {
    console.log('flight_pricing_booking_reference length', postman.flight_pricing_booking_reference.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

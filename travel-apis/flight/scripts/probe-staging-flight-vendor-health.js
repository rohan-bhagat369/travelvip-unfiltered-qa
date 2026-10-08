/**
 * Staging flight health check — search (+ one pricing sample) for
 * domestic/intl × OW/RT. No booking. Flags VENDOR_ERROR / empty inventory.
 *
 * Run: node scripts/probe-staging-flight-vendor-health.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions, pickRoundTripPairs } from '../src/searchPicker.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';

const DAYS = Number(process.env.FLIGHT_DAYS || 45);
const RETURN_OFFSET = Number(process.env.FLIGHT_RETURN_DAYS || 7);
const OUT = path.join('reports', `staging-flight-vendor-health-${Date.now()}.json`);

const CASES = [
  { id: 'DOM-OW', journey: 'ONE_WAY', origin: 'DEL', destination: 'BOM', label: 'Domestic OW DEL→BOM' },
  { id: 'DOM-RT', journey: 'ROUND_TRIP', origin: 'DEL', destination: 'BOM', label: 'Domestic RT DEL↔BOM' },
  { id: 'INTL-OW', journey: 'ONE_WAY', origin: 'DEL', destination: 'DXB', label: 'Intl OW DEL→DXB' },
  { id: 'INTL-RT', journey: 'ROUND_TRIP', origin: 'DEL', destination: 'DXB', label: 'Intl RT DEL↔DXB' },
  { id: 'DOM-OW-2', journey: 'ONE_WAY', origin: 'BOM', destination: 'BLR', label: 'Domestic OW BOM→BLR' },
  { id: 'INTL-OW-2', journey: 'ONE_WAY', origin: 'BOM', destination: 'DXB', label: 'Intl OW BOM→DXB' },
];

function errOf(data) {
  const e = data?.error;
  if (!e) return null;
  return {
    code: e.code || null,
    message: String(e.message || '').slice(0, 200),
  };
}

function airlinesFromOptions(options) {
  const set = new Set();
  for (const opt of options || []) {
    for (const s of opt.segments || []) {
      const c = String(s?.airline?.code || s?.airlineCode || '').toUpperCase();
      if (c) set.add(c);
    }
  }
  return [...set].sort();
}

function scanVendorNoise(data) {
  const blob = JSON.stringify(data || {});
  const hits = [];
  if (/VENDOR_ERROR/i.test(blob)) hits.push('VENDOR_ERROR');
  if (/Unable to fetch the flight results/i.test(blob)) hits.push('Unable to fetch the flight results');
  if (/@23\.3/i.test(blob)) hits.push('@23.3');
  if (/NO_FLIGHTS_FOUND/i.test(blob)) hits.push('NO_FLIGHTS_FOUND');
  if (/Riya/i.test(blob) && !/riya/i.test('')) hits.push('Riya');
  // Riya vendor leak
  if (/\bRiya\b/i.test(blob)) hits.push('RiyaLeak');
  return [...new Set(hits)];
}

async function pollSearch(flight, body, { maxPolls = 14 } = {}) {
  let last = null;
  for (let i = 0; i < maxPolls; i += 1) {
    const res = await flight.search(body);
    last = res;
    const onward = collectOptions(res.data, 'ONWARD');
    const ret = body.journeyType === 'ROUND_TRIP' ? collectOptions(res.data, 'RETURN') : [];
    const err = errOf(res.data);
    if (err?.code === 'VENDOR_ERROR' || err?.code === 'NO_FLIGHTS_FOUND') {
      return { response: res, data: res.data, onward, ret, polls: i + 1 };
    }
    if (onward.length && (body.journeyType !== 'ROUND_TRIP' || ret.length)) {
      return { response: res, data: res.data, onward, ret, polls: i + 1 };
    }
    if (isSearchProgressComplete(res.data)) break;
    const wait = res.data?.progress?.pollAfterMs || 2500;
    await new Promise((r) => setTimeout(r, wait));
  }
  return {
    response: last,
    data: last?.data,
    onward: collectOptions(last?.data, 'ONWARD'),
    ret: body.journeyType === 'ROUND_TRIP' ? collectOptions(last?.data, 'RETURN') : [],
    polls: maxPolls,
  };
}

function verdict(row) {
  if (row.searchHttp >= 500) return 'BUG';
  if (row.errorCode === 'VENDOR_ERROR') return 'BUG';
  if (row.vendorNoise.includes('VENDOR_ERROR') && !row.onwardCount) return 'BUG';
  if (row.onwardCount > 0 && (row.journey !== 'ROUND_TRIP' || row.returnCount > 0)) {
    if (row.pricingOk === false && row.pricingCode === 'VENDOR_ERROR') return 'PARTIAL';
    if (row.pricingOk === true || row.pricingOk === null) return 'PASS';
    return 'PARTIAL';
  }
  if (row.errorCode === 'NO_FLIGHTS_FOUND') return 'NOT TESTED';
  if (!row.onwardCount) return 'BUG';
  return 'NOT TESTED';
}

async function runCase(flight, c) {
  const body = c.journey === 'ROUND_TRIP'
    ? buildRoundTripSearchBody(DAYS, DAYS + RETURN_OFFSET, {
      origin: c.origin,
      destination: c.destination,
      fareType: 'NORMAL',
      maxStops: null,
    })
    : buildOneWaySearchBody(DAYS, {
      origin: c.origin,
      destination: c.destination,
      fareType: 'NORMAL',
      maxStops: null,
    });
  body.travellers = { adults: 1, children: 0, infants: 0 };

  console.log(`\n=== ${c.id} ${c.label} ===`);
  const started = Date.now();
  const { response, data, onward, ret, polls } = await pollSearch(flight, body);
  const err = errOf(data);
  const noise = scanVendorNoise(data);
  const airlines = airlinesFromOptions(onward);
  const retAirlines = airlinesFromOptions(ret);

  const row = {
    id: c.id,
    label: c.label,
    journey: c.journey,
    route: `${c.origin}-${c.destination}${c.journey === 'ROUND_TRIP' ? `-${c.origin}` : ''}`,
    dateOnward: body.itinerary[0]?.date,
    dateReturn: body.itinerary[1]?.date || null,
    searchHttp: response?.status ?? null,
    searchOk: Boolean(response?.ok),
    polls,
    elapsedMs: Date.now() - started,
    onwardCount: onward.length,
    returnCount: ret.length,
    airlines,
    returnAirlines: retAirlines,
    errorCode: err?.code || null,
    errorMessage: err?.message || null,
    vendorNoise: noise,
    sampleFlights: onward.slice(0, 3).map((o) =>
      (o.segments || []).map((s) => `${s.airline?.code || s.airlineCode} ${s.flightNumber}`).join(' / ')),
    pricingOk: null,
    pricingCode: null,
    pricingMessage: null,
    priceId: null,
  };

  console.log(
    `  search http=${row.searchHttp} onward=${row.onwardCount} return=${row.returnCount}`
    + ` airlines=${airlines.join(',') || '-'} err=${row.errorCode || '-'} noise=${noise.join(',') || '-'}`,
  );

  // One pricing sample when we have inventory
  if (c.journey === 'ONE_WAY' && onward[0]?.searchId) {
    const fareId = onward[0].fares?.[0]?.searchId || onward[0].searchId;
    const pricing = await flight.getPricing([fareId], 'ONE_WAY');
    const pe = errOf(pricing.data);
    row.pricingOk = Boolean(pricing.ok && pricing.data?.priceId);
    row.pricingCode = pe?.code || null;
    row.pricingMessage = pe?.message || null;
    row.priceId = pricing.data?.priceId || null;
    console.log(`  pricing http=${pricing.status} ok=${row.pricingOk} code=${row.pricingCode || '-'} priceId=${row.priceId || '-'}`);
  } else if (c.journey === 'ROUND_TRIP') {
    const pairs = pickRoundTripPairs(data, { maxStops: null });
    const pair = pairs[0];
    if (pair?.searchIds?.length === 2) {
      const pricing = await flight.getPricing(pair.searchIds, 'ROUND_TRIP');
      const pe = errOf(pricing.data);
      row.pricingOk = Boolean(pricing.ok && pricing.data?.priceId);
      row.pricingCode = pe?.code || null;
      row.pricingMessage = pe?.message || null;
      row.priceId = pricing.data?.priceId || null;
      row.pricedPair = `${pair.onward?.label} + ${pair.ret?.label}`;
      console.log(`  pricing http=${pricing.status} ok=${row.pricingOk} code=${row.pricingCode || '-'} pair=${row.pricedPair}`);
    } else {
      console.log('  pricing skipped (no RT pair)');
    }
  }

  row.status = verdict(row);
  console.log(`  → ${row.status}`);
  return row;
}

async function main() {
  clearSession();
  console.log('BASE', process.env.BASE_URL);
  console.log(`Flight vendor health — OW/RT × domestic/intl  d+${DAYS}/+${RETURN_OFFSET}`);
  console.log('Search + one pricing sample. No book.\n');

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const rows = [];
  for (const c of CASES) {
    try {
      rows.push(await runCase(flight, c));
    } catch (e) {
      rows.push({
        id: c.id,
        label: c.label,
        status: 'BUG',
        errorCode: 'CRASH',
        errorMessage: String(e?.message || e),
      });
      console.log(`  → BUG crash: ${e?.message || e}`);
    }
  }

  const summary = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    PARTIAL: rows.filter((r) => r.status === 'PARTIAL').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
  };

  const report = {
    at: new Date().toISOString(),
    base: process.env.BASE_URL,
    days: DAYS,
    returnOffset: RETURN_OFFSET,
    summary,
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(summary));
  console.log('\n| # | Case | How tested | Status |');
  console.log('|---|---|---|---|');
  rows.forEach((r, i) => {
    const how = `search→${r.onwardCount || 0} opts`
      + (r.journey === 'ROUND_TRIP' ? `/${r.returnCount || 0} ret` : '')
      + (r.pricingOk != null ? `; price ${r.pricingOk ? 'ok' : r.pricingCode || 'fail'}` : '')
      + (r.errorCode ? `; err ${r.errorCode}` : '')
      + (r.vendorNoise?.length ? `; noise ${r.vendorNoise.join(',')}` : '');
    console.log(`| ${i + 1} | ${r.id} ${r.label} | ${how} | ${r.status} |`);
  });
  console.log('\nReport:', OUT);

  process.exit(summary.BUG > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('CRASH', e);
  process.exit(2);
});

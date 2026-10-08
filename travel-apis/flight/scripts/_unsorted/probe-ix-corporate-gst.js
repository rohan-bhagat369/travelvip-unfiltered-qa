/**
 * Check whether IX (Air India Express) CORPORATE fare pricing returns gstBreakup.
 * Pricing only — does not book.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-ix-corporate-gst.js
 */
import fs from 'fs';
import { authenticate } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { buildOneWaySearchBody, extractSearchIds } from '../../src/helpers.js';
import { config } from '../../../../shared/config/env.js';
import { sleep } from '../../../../shared/lib/testUtils.js';

function findAirlineOptions(searchData, airline = 'IX') {
  const matches = [];
  for (const result of searchData?.results || []) {
    for (const opt of result?.options || []) {
      const codes = (opt.segments || [])
        .map((s) => s.airline?.code || s.airlineCode)
        .filter(Boolean)
        .map((c) => String(c).toUpperCase());
      if (codes.length && codes.every((c) => c === airline)) {
        matches.push({
          searchId: opt.searchId,
          fareType: opt.fareType || opt.fareFamily || null,
          fareName: opt.fareName || opt.brandName || null,
          segments: codes.map((c, i) => `${c} ${opt.segments[i]?.flightNumber || ''}`).join(','),
          totalAmount: opt.pricing?.totalAmount ?? opt.totalAmount ?? null,
        });
      }
    }
  }
  return matches;
}

async function searchWithRetries(flight, body, { maxAttempts = 40, intervalMs = 4000 } = {}) {
  let last = null;
  for (let i = 1; i <= maxAttempts; i += 1) {
    last = await flight.search(body);
    const state = last.data?.progress?.state;
    const ids = extractSearchIds(last.data, 50);
    console.log(`  poll ${i}/${maxAttempts} ok=${last.ok} state=${state} options=${ids.length}`);
    if (last.ok && state === 'COMPLETE' && ids.length) return last;
    if (last.ok && state === 'COMPLETE' && !ids.length) return last;
    await sleep(intervalMs);
  }
  return last;
}

function summarizePricing(pricingData, fareType, meta = {}) {
  const d = pricingData || {};
  const seg = d.itinerary?.[0]?.segments?.[0];
  const gst = Array.isArray(d.gstBreakup) ? d.gstBreakup : [];
  return {
    fareType,
    ...meta,
    airline: seg?.airline?.code,
    airlineName: seg?.airline?.name,
    flight: seg?.flightNumber,
    priceId: d.priceId,
    pricing: d.pricing,
    gstBreakup: gst,
    hasGstBreakup: gst.length > 0,
    gstCodes: gst.map((x) => ({ code: x.code, amount: x.amount, type: x.type })),
    // also surface any nested GST-looking keys
    passengerGst: d.passengerOptions?.[0]?.gstBreakup || null,
  };
}

async function priceIx(flight, searchData, fareType) {
  const ix = findAirlineOptions(searchData, 'IX');
  console.log(`  IX options in ${fareType}:`, ix.length, ix.slice(0, 3).map((x) => x.segments));
  if (!ix.length) return { found: false, samples: [] };

  const samples = [];
  for (const opt of ix.slice(0, 3)) {
    const pricing = await flight.getPricing([opt.searchId], 'ONE_WAY');
    if (!pricing.ok) {
      samples.push({ searchId: opt.searchId, pricingOk: false, error: pricing.data });
      continue;
    }
    samples.push(summarizePricing(pricing.data, fareType, { searchId: opt.searchId, searchMeta: opt }));
  }
  return { found: true, samples };
}

const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const flight = new FlightService(session.client);
console.log('Base URL:', config.baseUrl);

const dayOffsets = [40, 50, 60];
const corporateSamples = [];
const normalSamples = [];
let corporateSearchNote = null;
let normalSearchNote = null;

for (const day of dayOffsets) {
  // CORPORATE — no airline filter (IX-only filter was hanging / empty); filter client-side
  const corpBody = buildOneWaySearchBody(day, {
    origin: 'DEL',
    destination: 'BOM',
    fareType: 'CORPORATE',
    maxStops: 0,
  });
  // Prefer IX but also allow empty if vendor struggles; try IX first then open
  for (const airlines of [['IX'], []]) {
    corpBody.preferences.airlines = airlines;
    console.log(`\nCORPORATE +${day} airlines=${JSON.stringify(airlines)} date=${corpBody.itinerary[0].date}`);
    const res = await searchWithRetries(flight, corpBody, { maxAttempts: 30 });
    if (!res?.ok) {
      corporateSearchNote = `CORPORATE search not ok: ${JSON.stringify(res?.data).slice(0, 200)}`;
      console.log(corporateSearchNote);
      continue;
    }
    if (res.data?.progress?.state !== 'COMPLETE') {
      corporateSearchNote = 'CORPORATE search did not complete';
      continue;
    }
    const priced = await priceIx(flight, res.data, 'CORPORATE');
    if (priced.found) {
      corporateSamples.push(...priced.samples);
      break;
    }
    corporateSearchNote = `No IX in CORPORATE results for +${day} airlines=${JSON.stringify(airlines)}`;
  }
  if (corporateSamples.length) break;
}

// NORMAL IX compare on first successful day or +40
{
  const day = dayOffsets[0];
  const body = buildOneWaySearchBody(day, {
    origin: 'DEL',
    destination: 'BOM',
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.preferences.airlines = ['IX'];
  console.log(`\nNORMAL +${day} IX date=${body.itinerary[0].date}`);
  const res = await searchWithRetries(flight, body, { maxAttempts: 30 });
  if (res?.ok && res.data?.progress?.state === 'COMPLETE') {
    const priced = await priceIx(flight, res.data, 'NORMAL');
    normalSamples.push(...priced.samples);
    if (!priced.found) normalSearchNote = 'No IX in NORMAL results';
  } else {
    normalSearchNote = 'NORMAL search did not complete';
  }
}

const report = {
  ranAt: new Date().toISOString(),
  env: config.baseUrl,
  question: 'Does IX CORPORATE fare pricing return GST breakup/codes?',
  corporateSamples,
  normalSamples,
  corporateSearchNote,
  normalSearchNote,
  verdict: {
    ixCorporateFound: corporateSamples.some((s) => s.airline === 'IX'),
    ixCorporateHasGstBreakup: corporateSamples.some((s) => s.hasGstBreakup),
    corporateGstCodes: corporateSamples.find((s) => s.hasGstBreakup)?.gstCodes
      || corporateSamples[0]?.gstCodes
      || [],
    ixNormalHasGstBreakup: normalSamples.some((s) => s.hasGstBreakup),
    normalGstCodes: normalSamples.find((s) => s.hasGstBreakup)?.gstCodes
      || normalSamples[0]?.gstCodes
      || [],
  },
};

fs.mkdirSync('reports/flight', { recursive: true });
const out = 'reports/flight/ix-corporate-gst-breakup.json';
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('\nVERDICT', JSON.stringify(report.verdict, null, 2));
console.log('Wrote', out);

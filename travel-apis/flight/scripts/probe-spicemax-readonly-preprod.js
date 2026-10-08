/**
 * Preprod read-only: search SG SpiceMax → pricing mandatorySsr. No issue-ticket.
 *
 *   $env:BASE_URL='https://preprod-api.travelvip.ai'
 *   $env:PARTNER_ID='vgm'
 *   $env:PARTNER_SECRET='vgm_preprod_ojny1swtigd4as'
 *   $env:TIER_ID='19597201'
 *   $env:SIGNING_KEY='sk_live_yg81bca5xno1ypvhla'
 *   node scripts/probe-spicemax-readonly-preprod.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import { buildOneWaySearchBody, isSearchProgressComplete } from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'spicemax-preprod-readonly.json');

function fareLabel(f) {
  return String(f?.fareName || f?.brandName || f?.name || f?.fareType || '');
}

function isSpiceMax(f, opt) {
  return /spice\s*max/i.test([fareLabel(f), f?.fareType, opt?.fareType].join(' '));
}

function airlineCode(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function flightLabel(opt) {
  return (opt?.segments || [])
    .map((s) => `${s.airline?.code || s.airlineCode || ''} ${s.flightNumber || ''}`)
    .join(' / ');
}

function findSpiceMax(options) {
  for (const opt of options) {
    if (airlineCode(opt) !== 'SG') continue;
    const fares = opt.fares?.length ? opt.fares : [opt];
    for (const f of fares) {
      if (!isSpiceMax(f, opt)) continue;
      return {
        searchId: f.searchId || opt.searchId,
        label: fareLabel(f) || 'SpiceMax',
        fareType: f.fareType,
        flight: flightLabel(opt),
        total: f?.pricing?.totalAmount ?? null,
      };
    }
  }
  return null;
}

const ROUTES = [
  { origin: 'DEL', destination: 'BOM', label: 'DEL→BOM' },
  { origin: 'BOM', destination: 'DEL', label: 'BOM→DEL' },
  { origin: 'BLR', destination: 'HYD', label: 'BLR→HYD' },
];
const DAYS_LIST = String(process.env.DAYS || '14,20,28,35,42,45,48,51')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter(Boolean);

async function searchRoute(flight, route, days) {
  const body = buildOneWaySearchBody(days, {
    origin: route.origin,
    destination: route.destination,
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.preferences = { airlines: ['SG'], maxStops: 0, refundableOnly: false };

  let res = null;
  for (let i = 0; i < 12; i += 1) {
    res = await flight.search(body);
    const opts = collectOptions(res?.data, 'ONWARD');
    if (res?.ok && (isSearchProgressComplete(res.data) || opts.length)) {
      if (isSearchProgressComplete(res.data) || i >= 3) break;
    }
    await sleep(res?.data?.progress?.pollAfterMs || 2500);
  }

  const options = collectOptions(res?.data, 'ONWARD');
  const sg = options.filter((o) => airlineCode(o) === 'SG');
  const brands = [...new Set(sg.flatMap((o) => (o.fares || []).map((f) => fareLabel(f) || f.fareType).filter(Boolean)))];
  const spice = findSpiceMax(options);
  const departureDate = body.itinerary?.[0]?.date;

  return { http: res?.status, departureDate, optionCount: options.length, sgCount: sg.length, brands, spice, searchBody: body };
}

async function main() {
  clearSession();
  console.log('=== SpiceMax read-only preprod (search + pricing only) ===');
  console.log('BASE', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);

  const routeResults = [];

  for (const route of ROUTES) {
    let hit = null;
    const attempts = [];
    for (const days of DAYS_LIST) {
      console.log(`search ${route.label} SG d+${days}`);
      const row = await searchRoute(flight, route, days);
      attempts.push({ days, departureDate: row.departureDate, sgCount: row.sgCount, brands: row.brands, spiceMax: Boolean(row.spice) });
      console.log('  SG', row.sgCount, 'brands', row.brands.slice(0, 8).join(', ') || '(none)');

      if (row.spice?.searchId) {
        const pricing = await flight.getPricing([row.spice.searchId], 'ONE_WAY');
        const mandatorySsr = (pricing.data?.itinerary || []).map((leg) => ({
          legId: leg.legId,
          direction: leg.direction,
          mandatorySsr: leg.mandatorySsr || null,
        }));
        hit = {
          route: route.label,
          searchCriteria: row.searchBody,
          daysFromNow: days,
          departureDate: row.departureDate,
          spice: row.spice,
          pricingHttp: pricing.status,
          priceId: pricing.data?.priceId || null,
          mandatorySsr,
        };
        console.log('  SpiceMax', row.spice.flight, row.spice.searchId);
        console.log('  mandatorySsr', JSON.stringify(mandatorySsr));
        break;
      }
    }
    routeResults.push(hit || { route: route.label, spiceMaxFound: false, attempts });
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    readOnly: true,
    noBook: true,
    recommendedSearchCriteria: {
      endpoint: 'POST /v1/flights/search',
      journeyType: 'ONE_WAY',
      cabinClass: 'ECONOMY',
      travellers: { adults: 1, children: 0, infants: 0 },
      fareType: 'NORMAL',
      preferences: { airlines: ['SG'], maxStops: 0, refundableOnly: false },
      routesTried: ROUTES.map((r) => r.label),
      daysScanned: DAYS_LIST,
    },
    routeResults,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nReport', OUT);
  console.log(JSON.stringify(routeResults, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});

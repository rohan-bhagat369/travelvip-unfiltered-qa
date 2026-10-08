/**
 * One-shot on api-staging:
 *  search SG DEL→BOM → pick SpiceMax fare → confirm mandatorySsr true
 *  → issue-ticket with empty passenger SSR (no meal/seat/baggage)
 *  → dump issue-ticket HTTP + body (bookingReference if accepted)
 *
 * Does not retry issue-ticket. Extra search days are only used if SpiceMax is missing.
 *
 *   $env:BASE_URL='https://api-staging.travelvip.ai'; node scripts/probe-spicemax-no-ssr-staging.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { collectOptions } from '../src/searchPicker.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'spicemax-no-ssr-issue-staging.json');

function fareLabel(f) {
  return String(f?.fareName || f?.brandName || f?.name || f?.fareType || f?.fareFamily || '');
}

function isSpiceMax(f, opt) {
  const blob = [
    fareLabel(f),
    f?.fareType,
    f?.cabin,
    f?.brand,
    opt?.fareType,
    opt?.fareFamily,
    opt?.fareName,
    opt?.brandName,
  ].map((x) => String(x || '')).join(' ');
  return /spice\s*max/i.test(blob);
}

function airlineCode(opt) {
  return String(opt?.segments?.[0]?.airline?.code || opt?.segments?.[0]?.airlineCode || '').toUpperCase();
}

function flightLabel(opt) {
  const segs = opt?.segments || [];
  return segs.map((s) => `${s.airline?.code || s.airlineCode || ''} ${s.flightNumber || ''}`).join(' / ').trim();
}

function findSpiceMax(options) {
  for (const opt of options) {
    if (airlineCode(opt) !== 'SG') continue;
    const fares = opt.fares?.length ? opt.fares : [opt];
    for (const f of fares) {
      if (!isSpiceMax(f, opt)) continue;
      return {
        opt,
        fare: f,
        searchId: f.searchId || opt.searchId,
        label: fareLabel(f) || 'SpiceMax',
        total: f?.pricing?.totalAmount ?? f?.totalAmount ?? opt?.displayPricing?.pricing?.totalAmount ?? null,
        flight: flightLabel(opt),
      };
    }
  }
  return null;
}

function mandatoryFromPricing(pricingData) {
  const itin = pricingData?.itinerary || [];
  return itin.map((leg) => ({
    legId: leg.legId,
    direction: leg.direction,
    mandatorySsr: leg.mandatorySsr || null,
  }));
}

function hasMandatorySsr(legs) {
  return legs.some((l) => {
    const m = l.mandatorySsr;
    if (!m) return false;
    return Boolean(m.meal || m.seat || m.baggage)
      || (Array.isArray(m.types) && m.types.length > 0);
  });
}

async function searchOnce(flight, days) {
  const body = buildOneWaySearchBody(days, {
    origin: 'DEL',
    destination: 'BOM',
    fareType: 'NORMAL',
    maxStops: 0,
  });
  body.preferences = { ...body.preferences, airlines: ['SG'], maxStops: 0 };

  let last = null;
  for (let i = 0; i < 12; i += 1) {
    last = await flight.search(body);
    const opts = collectOptions(last?.data, 'ONWARD');
    if (last?.ok && (isSearchProgressComplete(last.data) || opts.length)) {
      if (isSearchProgressComplete(last.data) || i >= 3) break;
    }
    await sleep(last?.data?.progress?.pollAfterMs || 2500);
  }
  return last;
}

async function main() {
  clearSession();
  process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  console.log('Base:', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;
  const flight = new FlightService(client);

  const daysList = String(process.env.DAYS || '20').split(',').map((n) => Number(n.trim())).filter(Boolean);
  let spice = null;
  let searchDay = null;
  const searchNotes = [];

  for (const days of daysList) {
    console.log(`search SG DEL→BOM d+${days}`);
    const res = await searchOnce(flight, days);
    const options = collectOptions(res?.data, 'ONWARD');
    const sg = options.filter((o) => airlineCode(o) === 'SG');
    const brands = sg.flatMap((o) => (o.fares || []).map((f) => fareLabel(f) || o.fareType || o.fareFamily)).filter(Boolean);
    searchNotes.push({ days, optionCount: options.length, sgCount: sg.length, brands: [...new Set(brands)].slice(0, 20) });
    console.log('  options', options.length, 'SG', sg.length, 'brands', brands.slice(0, 8).join(', ') || '(none)');
    spice = findSpiceMax(options);
    if (spice) {
      searchDay = days;
      break;
    }
  }

  if (!spice?.searchId) {
    const report = {
      ranAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      error: 'No SpiceJet SpiceMax fare in this search',
      searchNotes,
    };
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('picked', spice.label, spice.flight, spice.searchId, spice.total);

  const pricing = await flight.getPricing([spice.searchId], 'ONE_WAY');
  const legs = mandatoryFromPricing(pricing.data);
  const mandatory = hasMandatorySsr(legs);
  console.log('pricing', pricing.status, 'priceId', pricing.data?.priceId, 'mandatorySsr', JSON.stringify(legs));

  if (!pricing.data?.priceId || !pricing.data?.bookingContext) {
    const report = {
      ranAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      spice,
      searchDay,
      pricingHttp: pricing.status,
      pricingData: pricing.data,
      error: 'pricing failed',
    };
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ error: 'pricing failed', http: pricing.status, data: pricing.data }, null, 2));
    return;
  }

  if (!mandatory) {
    console.log('WARNING: SpiceMax priced but mandatorySsr is not true on itinerary — still issuing without SSR as requested');
  }

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [spice.searchId],
    journeyType: 'ONE_WAY',
    passengerProfile: {
      title: 'Mr',
      firstName: 'Rohan',
      lastName: `Bhagat${String(Date.now()).slice(-4)}`,
      gender: 'Male',
      dob: '1988-05-12',
    },
  });
  payload.data.passengers[0].ssr = { baggage: [], meals: [], seats: [] };

  const issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...FLIGHT_QUERY, ...config.flight.issueTicketQuery, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });

  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId || issue.data?.bookingRefId || null;

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    searchDay,
    spice,
    pricingMandatorySsr: legs,
    mandatorySsrTrue: mandatory,
    passengerSsr: payload.data.passengers.map((p) => ({ paxId: p.paxId, ssr: p.ssr })),
    issueHttp: issue.status,
    issueOk: Boolean(issue.ok),
    bookingReference: br,
    issueTicketResponse: issue.data,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== ISSUE-TICKET (no SSR) ===');
  console.log(JSON.stringify({
    http: issue.status,
    bookingReference: br,
    response: issue.data,
  }, null, 2));
  console.log('Report:', OUT);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  process.exit(1);
});

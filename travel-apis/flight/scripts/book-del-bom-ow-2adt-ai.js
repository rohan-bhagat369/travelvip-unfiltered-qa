/**
 * Book DEL-BOM ONE_WAY, 2 adults, Air India (AI) on staging.
 * Run: node scripts/book-del-bom-ow-2adt-ai.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { FlightService } from '../src/service.js';
import {
  FLIGHT_QUERY,
  buildOneWaySearchBody,
  buildIssueTicketPayload,
  extractFirstSearchId,
  extractSearchIds,
  isSearchProgressComplete,
  isTerminalBookingStatus,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'book-del-bom-ow-2adt-ai-staging.json');

function ok(r) {
  return Boolean(r?.ok || (r?.status >= 200 && r?.status < 300));
}
function brief(d, n = 800) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function isAirIndiaOption(opt) {
  const raw = JSON.stringify(opt || {}).toLowerCase();
  if (/\bai\b|"ai"|air india/.test(raw)) return true;
  const segs = opt?.segments || [];
  return segs.some((s) => {
    const code = String(s?.airline?.code || s?.marketingCarrier || s?.operatingCarrier || '').toUpperCase();
    const name = String(s?.airline?.name || '').toLowerCase();
    return code === 'AI' || name.includes('air india');
  });
}

function pickAiSearchIds(searchData, limit = 8) {
  const ids = [];
  for (const block of searchData?.results || []) {
    for (const opt of block?.options || []) {
      if (isAirIndiaOption(opt) && opt.searchId) {
        ids.push(opt.searchId);
        if (ids.length >= limit) return ids;
      }
    }
  }
  return ids;
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Booking: DEL-BOM OW | 2 Adults | Air India (AI)');
  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);

  let lastSearch = null;
  let searchId = null;
  let usedDays = null;

  for (const days of [10, 14, 18, 21, 28, 35]) {
    const body = buildOneWaySearchBody(days, {
      origin: 'DEL',
      destination: 'BOM',
      maxStops: 0,
      fareType: 'NORMAL',
    });
    body.travellers = { adults: 2, children: 0, infants: 0 };
    body.preferences = {
      airlines: ['AI'],
      maxStops: 0,
      refundableOnly: false,
    };

    console.log('\nSearch days=', days, 'date=', body.itinerary[0].date);
    for (let i = 0; i < 10; i += 1) {
      lastSearch = await flight.search(body);
      const aiIds = pickAiSearchIds(lastSearch.data);
      const anyIds = extractSearchIds(lastSearch.data, 5);
      console.log(
        ' poll', i + 1,
        'HTTP', lastSearch.status,
        'progress', lastSearch.data?.progress?.state,
        'AI options', aiIds.length,
        'any', anyIds.length,
      );
      if (!ok(lastSearch)) {
        console.log(' search fail', brief(lastSearch.data, 200));
        break;
      }
      if (aiIds.length) {
        searchId = aiIds[0];
        usedDays = days;
        break;
      }
      if (isSearchProgressComplete(lastSearch.data) && !aiIds.length) break;
      await sleep(3500);
    }
    if (searchId) break;
  }

  if (!searchId) {
    // fallback: any DEL-BOM without airline filter, then filter AI from results
    console.log('\nNo AI with preference — retry without airline filter, pick AI from results');
    for (const days of [12, 16, 22, 30]) {
      const body = buildOneWaySearchBody(days, {
        origin: 'DEL',
        destination: 'BOM',
        maxStops: null,
        fareType: 'NORMAL',
      });
      body.travellers = { adults: 2, children: 0, infants: 0 };
      body.preferences = { airlines: [], maxStops: null, refundableOnly: false };
      for (let i = 0; i < 8; i += 1) {
        lastSearch = await flight.search(body);
        const aiIds = pickAiSearchIds(lastSearch.data);
        console.log(' poll', i + 1, 'AI', aiIds.length, 'progress', lastSearch.data?.progress?.state);
        if (aiIds.length) {
          searchId = aiIds[0];
          usedDays = days;
          break;
        }
        if (isSearchProgressComplete(lastSearch.data)) break;
        await sleep(3500);
      }
      if (searchId) break;
    }
  }

  if (!searchId) {
    const out = { error: 'No Air India option found DEL-BOM', lastSearch: brief(lastSearch?.data) };
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    throw new Error(out.error);
  }

  console.log('\nSelected searchId', searchId, 'days', usedDays);

  // Try selected AI ids until pricing works
  const aiIds = pickAiSearchIds(lastSearch.data, 10);
  const tryIds = aiIds.length ? aiIds : [searchId];
  let pricing = null;
  let pricedId = null;
  for (const sid of tryIds) {
    pricing = await flight.getPricing([sid], 'ONE_WAY');
    console.log('Pricing', sid, 'HTTP', pricing.status, ok(pricing));
    if (ok(pricing) && pricing.data?.bookingContext && pricing.data?.priceId) {
      pricedId = sid;
      break;
    }
    console.log(' pricing fail', brief(pricing.data, 250));
  }
  if (!pricedId) throw new Error('Pricing failed for AI options');

  const payload = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [pricedId],
    journeyType: 'ONE_WAY',
  });
  payload.data.passengers = [
    {
      paxId: 'PAX1',
      type: 'adult',
      isLead: true,
      profile: {
        title: 'Mr',
        firstName: config.flight.passengerFirstName || 'Rohan',
        lastName: config.flight.passengerLastName || 'Bhagat',
        gender: 'Male',
        dob: config.flight.passengerDob || '2001-05-29',
        nationality: 'IN',
      },
      city: { cityCode: 'Delhi', cityName: 'Delhi' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
    {
      paxId: 'PAX2',
      type: 'adult',
      isLead: false,
      profile: {
        title: 'Mr',
        firstName: 'Amit',
        lastName: 'Sharma',
        gender: 'Male',
        dob: '1995-08-15',
        nationality: 'IN',
      },
      city: { cityCode: 'Delhi', cityName: 'Delhi' },
      passport: { number: null, expiry: null, issuedDate: null, issuedCountryCode: null },
      ssr: { baggage: [], meals: [], seats: [] },
    },
  ];

  console.log('\nIssuing ticket (2 adults)...');
  let issue = await client.request({
    method: 'POST',
    path: '/api/v2/flights/booking/issue-ticket',
    query: { ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
    body: payload,
    correlation: true,
    partnerKey: client.partnerKey,
  });
  console.log('Issue v2 HTTP', issue.status, brief(issue.data, 300));

  if (!ok(issue) || !issue.data?.bookingReference) {
    // fallback v1
    issue = await client.request({
      method: 'POST',
      path: '/v1/flights/booking/issue-ticket',
      query: { ...config.flight.issueTicketQuery, ...FLIGHT_QUERY, count: 10, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });
    console.log('Issue v1 HTTP', issue.status, brief(issue.data, 300));
  }

  const br = issue.data?.bookingReference || issue.data?.bookingReferenceId;
  let status = issue.data?.status || null;
  let statusRes = null;
  if (br) {
    for (let i = 0; i < 36; i += 1) {
      statusRes = await flight.getBookingStatus(br);
      status = statusRes.data?.status;
      console.log('Status poll', i + 1, status);
      if (ok(statusRes) && isTerminalBookingStatus(status)) break;
      await sleep(5000);
    }
  }

  const detail = br ? await flight.getBookingDetail(br) : null;
  const summary = {
    baseUrl: config.baseUrl,
    request: {
      route: 'DEL-BOM',
      journeyType: 'ONE_WAY',
      adults: 2,
      airline: 'AI',
      days: usedDays,
      searchId: pricedId,
    },
    issue: { http: issue.status, data: issue.data },
    bookingReference: br,
    finalStatus: status,
    detailSnippet: detail ? brief(detail.data, 1000) : null,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  console.log('\n=== BOOKING RESULT ===');
  console.log(JSON.stringify({
    bookingReference: br,
    status,
    http: issue.status,
    report: OUT,
  }, null, 2));

  if (!br || !/confirm/i.test(String(status))) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});

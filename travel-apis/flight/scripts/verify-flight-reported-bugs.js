/**
 * Re-verify reported Flight/Auth bugs against staging.
 * Usage: node scripts/verify-flight-reported-bugs.js
 */
import { config } from '../../../shared/config/env.js';
import { authenticate } from '../../../shared/lib/authService.js';
import {
  obtainValidPartnerTokens,
  requestPartnerToken,
  requestPartnerRefresh,
  requestUserSession,
} from '../../../shared/lib/authApi.js';
import { TravelVipClient } from '../../../shared/lib/TravelVipClient.js';
import { createSignature, createTimestamp, createRequestId } from '../../../shared/lib/signature.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  isSearchProgressComplete,
  extractOnwardSearchId,
  extractReturnSearchId,
  canSelectSeats,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const results = [];

function record(id, area, status, expected, actual, notes = '') {
  results.push({ id, area, status, expected, actual, notes });
  const mark = status === 'FIXED' ? 'FIXED' : status === 'STILL OPEN' ? 'OPEN ' : status;
  console.log(`[${mark}] ${id} — ${actual}`);
}

function isRejected(res) {
  if (!res) return false;
  if (!res.ok) return true;
  if (typeof res.data?.status === 'number' && res.data.status >= 400) return true;
  return false;
}

function httpInfo(res) {
  return `HTTP ${res.status} ok=${res.ok} bodyStatus=${res.data?.status ?? '-'} msg=${res.data?.message || res.data?.error?.message || res.data?.error?.code || ''}`;
}

async function rawFetch({ method = 'POST', path, query = {}, body, headers = {} }) {
  const url = new URL(`${config.baseUrl}${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log('\n=== Flight/Auth bug re-verification ===\n');

  // ---------- Auth / Security ----------
  const tokenRes = await obtainValidPartnerTokens();
  if (!tokenRes.ok) throw new Error(`Partner token failed: ${JSON.stringify(tokenRes.data)}`);
  const accessToken = tokenRes.data.access_token;
  const refreshToken = tokenRes.data.refresh_token;

  const session = await authenticate(true);
  const client = session.client;
  const flight = new FlightService(client);
  const searchBody = buildOneWaySearchBody(45);

  // 1. Invalid X-Signature
  {
    const body = searchBody;
    const bodyString = JSON.stringify(body);
    const ts = createTimestamp();
    const res = await client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 5 },
      body,
      signed: false,
      auth: true,
      correlation: true,
      extraHeaders: { 'X-Timestamp': ts, 'X-Signature': 'deadbeef'.repeat(8) },
    });
    record(
      'SEC-001 invalid X-Signature',
      'Auth/Security',
      isRejected(res) ? 'FIXED' : 'STILL OPEN',
      'HTTP 401/403',
      httpInfo(res),
      `validSig!=${createSignature(bodyString, ts, config.signingKey).slice(0, 12)}...`,
    );
  }

  // 2. Expired timestamp (1h old)
  {
    const body = searchBody;
    const bodyString = JSON.stringify(body);
    const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 5 },
      body,
      signed: false,
      auth: true,
      correlation: true,
      extraHeaders: {
        'X-Timestamp': oldTs,
        'X-Signature': createSignature(bodyString, oldTs, config.signingKey),
      },
    });
    record(
      'SEC-002 expired X-Timestamp (1h)',
      'Auth/Security',
      isRejected(res) ? 'FIXED' : 'STILL OPEN',
      'HTTP 401/403',
      httpInfo(res),
    );
  }

  // 3. Session invalid tierId type
  {
    const res = await requestUserSession(accessToken, { tierId: 'not-a-number' });
    record(
      'AUTH-001 tierId string "not-a-number"',
      'Auth',
      isRejected(res) ? 'FIXED' : 'STILL OPEN',
      'HTTP 400',
      httpInfo(res),
    );
  }

  // 4. Session nonexistent tierId
  {
    const res = await requestUserSession(accessToken, { tierId: 999999999 });
    record(
      'AUTH-002 nonexistent tierId 999999999',
      'Auth',
      isRejected(res) ? 'FIXED' : 'STILL OPEN',
      'HTTP 400/404',
      httpInfo(res),
    );
  }

  // 5. Invalid Content-Type
  {
    const body = searchBody;
    const bodyString = JSON.stringify(body);
    const ts = createTimestamp();
    const res = await rawFetch({
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'INR', page: 0, perpage: 5 },
      body: bodyString,
      headers: {
        'Content-Type': 'text/plain',
        Accept: 'application/xml',
        Authorization: `Bearer ${session.authToken}`,
        'X-Request-Id': createRequestId(),
        'X-Timestamp': ts,
        'X-Signature': createSignature(bodyString, ts, config.signingKey),
        'X-Correlation-ID': crypto.randomUUID(),
      },
    });
    record(
      'HDR-001 invalid Content-Type/Accept',
      'Validation',
      isRejected(res) ? 'FIXED' : 'STILL OPEN',
      'HTTP 400/415',
      httpInfo(res),
    );
  }

  // 6. Missing X-Request-Id on partner token
  {
    const res = await rawFetch({
      path: '/auth/partner/token',
      body: { partner_id: config.partnerId, partner_secret: config.partnerSecret },
      headers: { 'Content-Type': 'application/json' },
    });
    record(
      'AUTH-003 missing X-Request-Id on partner token',
      'Auth',
      isRejected(res) ? 'FIXED' : 'STILL OPEN',
      'HTTP 400',
      httpInfo(res),
    );
  }

  // 7. Null X-Request-Id on refresh
  {
    const res = await requestPartnerRefresh(refreshToken, {
      extraHeaders: { 'X-Request-Id': null },
    });
    // TravelVipClient may coerce null — also try raw
    const raw = await rawFetch({
      path: '/auth/partner/refresh',
      body: { refresh_token: refreshToken },
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': '' },
    });
    const open = !isRejected(res) || !isRejected(raw);
    record(
      'AUTH-004 null/empty X-Request-Id on refresh',
      'Auth',
      open ? 'STILL OPEN' : 'FIXED',
      'HTTP 400',
      `client=${httpInfo(res)} | emptyHeader=${httpInfo(raw)}`,
    );
  }

  // ---------- Currency USD ----------
  {
    const res = await client.request({
      method: 'POST',
      path: '/v1/flights/search',
      query: { lang: 'en', currency: 'USD', page: 0, perpage: 5 },
      body: { ...buildOneWaySearchBody(50), currency: 'USD' },
      correlation: true,
    });
    const currencies = [];
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (typeof o.currency === 'string') currencies.push(o.currency);
      Object.values(o).forEach(walk);
    };
    walk(res.data);
    const uniq = [...new Set(currencies)];
    const fixed = uniq.includes('USD') && !uniq.every((c) => c === 'INR');
    record(
      'CUR-001 currency=USD ignored',
      'Functional',
      fixed ? 'FIXED' : 'STILL OPEN',
      'Amounts/currency fields in USD',
      `HTTP ${res.status} currenciesSeen=[${uniq.join(',')}] sample=${JSON.stringify(res.data?.currency || res.data?.results?.[0]?.currency || null)}`,
    );
  }

  // ---------- Seed OW search for issue-ticket / seatmap ----------
  console.log('\n--- Seeding OW search/pricing ---');
  let owSearch;
  let searchId;
  let pricing;
  try {
    owSearch = await flight.searchUntilComplete(buildOneWaySearchBody(50));
    searchId = owSearch.searchId;
    pricing = await flight.getPricing([searchId], 'ONE_WAY');
    console.log(`OW searchId=${searchId} priceId=${pricing.data?.priceId} bookingContext=${Boolean(pricing.data?.bookingContext)}`);
  } catch (e) {
    console.error('OW seed failed', e.message);
  }

  // ---------- Round-trip CORPORATE ----------
  console.log('\n--- RT CORPORATE poll ---');
  {
    const body = buildRoundTripSearchBody(45, 52, { fareType: 'CORPORATE' });
    let last;
    let complete = false;
    let returnCount = 0;
    for (let i = 0; i < 15; i++) {
      last = await flight.search(body);
      const state = last.data?.progress?.state || last.data?.progress?.status;
      const ret = last.data?.RETURN || last.data?.return || last.data?.results?.RETURN;
      returnCount = Array.isArray(ret) ? ret.length : ret?.flights?.length || 0;
      if (isSearchProgressComplete(last.data)) {
        complete = true;
        break;
      }
      await sleep(last.data?.progress?.pollAfterMs || 2500);
    }
    record(
      'RT-001 CORPORATE RT never completes',
      'Round-Trip',
      complete && returnCount > 0 ? 'FIXED' : 'STILL OPEN',
      'COMPLETE + RETURN populated',
      `complete=${complete} returnCount=${returnCount} state=${last?.data?.progress?.state || last?.data?.progress?.status}`,
    );
  }

  // RT NORMAL for comparison + reversed itinerary
  console.log('\n--- RT NORMAL + reversed ---');
  let rtSearchIds = null;
  {
    try {
      const rt = await flight.searchRoundTripUntilComplete(
        buildRoundTripSearchBody(40, 47, { fareType: 'NORMAL' }),
      );
      rtSearchIds = rt.searchIds;
      record(
        'RT-003 NORMAL RT completes',
        'Round-Trip',
        rtSearchIds?.length >= 2 ? 'FIXED' : 'STILL OPEN',
        '2 searchIds',
        `searchIds=${JSON.stringify(rtSearchIds)}`,
      );
    } catch (e) {
      record('RT-003 NORMAL RT completes', 'Round-Trip', 'STILL OPEN', '2 searchIds', e.message);
    }

    const reversed = buildRoundTripSearchBody(40, 47, { fareType: 'NORMAL' });
    // Swap legs: BOM->DEL first with later date, DEL->BOM second with earlier — weird order
    if (reversed.itinerary?.length === 2) {
      reversed.itinerary = [
        { origin: 'BOM', destination: 'DEL', date: reversed.itinerary[1].date },
        { origin: 'DEL', destination: 'BOM', date: reversed.itinerary[0].date },
      ];
    }
    const res = await flight.search(reversed);
    const hasOptions =
      (res.data?.ONWARD?.length || res.data?.onward?.length || res.data?.results?.length || 0) > 0 ||
      Boolean(extractOnwardSearchId(res.data));
    record(
      'RT-004 reversed itinerary accepted',
      'Round-Trip',
      isRejected(res) || !hasOptions ? 'FIXED' : 'STILL OPEN',
      'HTTP 400 or no results',
      `${httpInfo(res)} hasOptions=${hasOptions}`,
    );
  }

  // SEARCH_CACHE_MISS — select too early
  {
    const body = buildRoundTripSearchBody(42, 49, { fareType: 'NORMAL' });
    const first = await flight.search(body);
    const earlyId = extractOnwardSearchId(first.data);
    if (earlyId) {
      const details = await flight.getDetails([earlyId], 'ROUND_TRIP');
      const miss =
        details.status === 502 ||
        details.data?.error?.code === 'SEARCH_CACHE_MISS' ||
        /SEARCH_CACHE_MISS|Cached search/i.test(JSON.stringify(details.data || {}));
      record(
        'RT-002 SEARCH_CACHE_MISS early select',
        'Round-Trip',
        miss ? 'STILL OPEN' : details.ok ? 'FIXED/IMPROVED' : 'CHECK',
        'Onward selection succeeds when cache ready; early select should be clear retryable error',
        httpInfo(details) + ` code=${details.data?.error?.code || ''}`,
        'If still 502 SEARCH_CACHE_MISS on early select — gap remains (needs wait/docs)',
      );
    } else {
      record('RT-002 SEARCH_CACHE_MISS early select', 'Round-Trip', 'SKIPPED', '-', 'No early onward searchId');
    }
  }

  // ---------- Seat map ----------
  if (pricing?.data?.bookingContext) {
    try {
      const supports = canSelectSeats(pricing.data);
      const seat = await flight.getSeatMap(pricing.data.bookingContext);
      const segs = seat.data?.data?.segments || seat.data?.segments || seat.data?.FlightSeat?.segments || [];
      const msg = JSON.stringify(seat.data || {}).slice(0, 400);
      const nullData =
        seat.ok &&
        (seat.data?.FlightSeat == null ||
          segs.length === 0 ||
          /not allow select seat/i.test(msg));

      record(
        'SEAT-001 empty/null when seats not allowed',
        'Seat Map',
        !seat.ok
          ? 'FIXED'
          : nullData
            ? 'STILL OPEN'
            : segs.length > 0
              ? 'OK'
              : 'CHECK',
        'HTTP 4xx or structured error when not allowed',
        `${httpInfo(seat)} supportsSeats=${supports} segments=${Array.isArray(segs) ? segs.length : 'n/a'} snippet=${msg.slice(0, 120)}`,
      );

      if (supports && seat.ok && segs.length === 0) {
        record(
          'SEAT-002 supportsSeats=true but empty segments',
          'Seat Map',
          'STILL OPEN',
          'segments populated',
          `${httpInfo(seat)} segments=0`,
        );
      } else if (supports && segs.length > 0) {
        record(
          'SEAT-002 supportsSeats=true but empty segments',
          'Seat Map',
          'FIXED',
          'segments populated',
          `segments=${segs.length}`,
        );
      }

      if (seat.status === 502) {
        record('SEAT-003 intermittent vendor 502', 'Seat Map', 'STILL OPEN', 'Stable response', httpInfo(seat));
      }
    } catch (e) {
      record('SEAT-001 empty/null when seats not allowed', 'Seat Map', 'CHECK', '-', e.message);
    }
  }

  // ---------- Issue ticket validations ----------
  if (pricing?.data?.priceId && pricing?.data?.bookingContext && searchId) {
    async function issueWithBody(mutate) {
      const body = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
      });
      mutate(body);
      return client.request({
        method: 'POST',
        path: '/v1/flights/booking/issue-ticket',
        query: { ...config.flight.issueTicketQuery, lang: 'en', currency: 'INR', count: 10, page: 0, perpage: 20 },
        body,
        correlation: true,
      });
    }

    const cases = [
      {
        id: 'ISSUE-001 invalid priceId',
        run: () =>
          flight.issueTicket({
            bookingContext: pricing.data.bookingContext,
            priceId: 'price_invalid_price_id_000',
            searchIds: [searchId],
            journeyType: 'ONE_WAY',
          }),
      },
      {
        id: 'ISSUE-002 invalid bookingContext',
        run: () =>
          flight.issueTicket({
            bookingContext: 'invalid-booking-context-token',
            priceId: pricing.data.priceId,
            searchIds: [searchId],
            journeyType: 'ONE_WAY',
          }),
      },
      {
        id: 'ISSUE-003 BR in bookingReference/context',
        run: () =>
          flight.issueTicket({
            bookingContext: 'BR0000000000001',
            priceId: pricing.data.priceId,
            searchIds: [searchId],
            journeyType: 'ONE_WAY',
          }),
      },
      {
        id: 'ISSUE-004 lastName with digits',
        run: () =>
          flight.issueTicket({
            bookingContext: pricing.data.bookingContext,
            priceId: pricing.data.priceId,
            searchIds: [searchId],
            journeyType: 'ONE_WAY',
            passengerProfile: { lastName: 'Test123' },
          }),
      },
      {
        id: 'ISSUE-005 empty lastName',
        run: () =>
          flight.issueTicket({
            bookingContext: pricing.data.bookingContext,
            priceId: pricing.data.priceId,
            searchIds: [searchId],
            journeyType: 'ONE_WAY',
            passengerProfile: { lastName: '' },
          }),
      },
      {
        id: 'ISSUE-006 invalid email',
        run: () =>
          issueWithBody((body) => {
            body.data.contact.email = 'not-an-email';
          }),
      },
      {
        id: 'ISSUE-007 empty mobile',
        run: () =>
          issueWithBody((body) => {
            body.data.contact.mobile = '';
          }),
      },
      {
        id: 'ISSUE-008 invalid dob',
        run: () =>
          flight.issueTicket({
            bookingContext: pricing.data.bookingContext,
            priceId: pricing.data.priceId,
            searchIds: [searchId],
            journeyType: 'ONE_WAY',
            passengerProfile: { dob: 'invalid' },
          }),
      },
    ];

    for (const c of cases) {
      const res = await c.run();
      const createdBr = Boolean(res.data?.bookingReference || res.data?.bookingRefId);
      const pending = /pending|processing/i.test(String(res.data?.status || ''));
      const open = res.ok && (createdBr || pending);
      record(
        c.id,
        'Issue Ticket',
        open ? 'STILL OPEN' : 'FIXED',
        'HTTP 400 — no BR created',
        `${httpInfo(res)} br=${res.data?.bookingReference || res.data?.bookingRefId || 'n/a'} status=${res.data?.status}`,
      );
    }

    // journeyType mismatch
    {
      const res = await flight.issueTicket({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ROUND_TRIP',
      });
      const is500 = res.status === 500 || res.data?.status === 500;
      record(
        'ISSUE-009 journeyType mismatch → 500',
        'Issue Ticket',
        is500 ? 'STILL OPEN' : isRejected(res) && res.status === 400 ? 'FIXED' : isRejected(res) ? 'PARTIAL' : 'STILL OPEN',
        'HTTP 400',
        httpInfo(res),
      );
    }

    // Property naming — pricing bookingContext vs issue bookingReference
    {
      const payload = buildIssueTicketPayload({
        bookingContext: pricing.data.bookingContext,
        priceId: pricing.data.priceId,
        searchIds: [searchId],
        journeyType: 'ONE_WAY',
      });
      const hasBookingReference = Object.prototype.hasOwnProperty.call(payload, 'bookingReference');
      const hasBookingContext = Object.prototype.hasOwnProperty.call(payload, 'bookingContext');
      const pricingHasContext = Boolean(pricing.data?.bookingContext);
      record(
        'ISSUE-010 bookingContext vs bookingReference naming',
        'API Contract',
        pricingHasContext && hasBookingReference && !hasBookingContext
          ? 'STILL OPEN'
          : pricingHasContext && hasBookingContext
            ? 'FIXED/CLIENT-ALIGNED'
            : 'CHECK',
        'Same property name across APIs',
        `pricing.bookingContext=${pricingHasContext} issuePayload.bookingReference=${hasBookingReference} issuePayload.bookingContext=${hasBookingContext}`,
        'If client sends bookingReference for pricing token while pricing returns bookingContext — contract inconsistency',
      );
    }

    // International passport — DEL-DXB or similar if we can quickly search
    {
      const intlBody = buildOneWaySearchBody(60, {
        origin: 'DEL',
        destination: 'DXB',
        fareType: 'NORMAL',
      });
      try {
        const intl = await flight.searchUntilComplete(intlBody);
        if (intl.searchId) {
          const intlPricing = await flight.getPricing([intl.searchId], 'ONE_WAY');
          const body = buildIssueTicketPayload({
            bookingContext: intlPricing.data.bookingContext,
            priceId: intlPricing.data.priceId,
            searchIds: [intl.searchId],
            journeyType: 'ONE_WAY',
          });
          body.data.passportType = 'REGULAR';
          body.data.passengers[0].passport = {
            number: '',
            expiry: null,
            issuedDate: null,
            issuedCountryCode: null,
          };
          const res = await client.request({
            method: 'POST',
            path: '/v1/flights/booking/issue-ticket',
            query: { ...config.flight.issueTicketQuery, lang: 'en', currency: 'INR', count: 10, page: 0, perpage: 20 },
            body,
            correlation: true,
          });
          const open = res.ok && Boolean(res.data?.bookingReference || res.data?.bookingRefId);
          record(
            'ISSUE-011 intl passport validation missing',
            'Issue Ticket',
            open ? 'STILL OPEN' : 'FIXED',
            'HTTP 400 when passport required',
            `${httpInfo(res)} br=${res.data?.bookingReference || 'n/a'}`,
          );
        } else {
          record('ISSUE-011 intl passport validation missing', 'Issue Ticket', 'SKIPPED', '-', 'No intl searchId');
        }
      } catch (e) {
        record('ISSUE-011 intl passport validation missing', 'Issue Ticket', 'SKIPPED', '-', e.message.slice(0, 120));
      }
    }
  } else {
    record('ISSUE-* seed', 'Issue Ticket', 'SKIPPED', '-', 'Could not seed pricing');
  }

  // ---------- Booking status casing / totalPassengers (from a valid issue if any OPEN created one) ----------
  // Use history or skip if no BR — try a cheap status on fake + any recent from issue open cases
  {
    const fake = await flight.getBookingStatus('BR0000000000001');
    record(
      'STATUS-001 invalid BR status HTTP',
      'Booking Status',
      isRejected(fake) && fake.status !== 200 ? 'FIXED' : isRejected(fake) ? 'PARTIAL (body error, HTTP 200)' : 'STILL OPEN',
      'HTTP 404',
      httpInfo(fake),
    );
  }

  // fareType OW CORPORATE vs RT — already covered RT-001; note OW works
  {
    try {
      const owCorp = await flight.searchUntilComplete(
        buildOneWaySearchBody(48, { fareType: 'CORPORATE' }),
      );
      record(
        'FARE-001 CORPORATE works OW',
        'Search',
        owCorp.searchId ? 'FIXED/OK' : 'STILL OPEN',
        'OW CORPORATE completes',
        `searchId=${owCorp.searchId}`,
      );
    } catch (e) {
      record('FARE-001 CORPORATE works OW', 'Search', 'STILL OPEN', 'OW CORPORATE completes', e.message);
    }
  }

  // ---------- Summary ----------
  const fixed = results.filter((r) => r.status === 'FIXED' || r.status.startsWith('FIXED'));
  const open = results.filter((r) => r.status === 'STILL OPEN');
  const other = results.filter((r) => !r.status.startsWith('FIXED') && r.status !== 'STILL OPEN');

  console.log('\n=== SUMMARY ===');
  console.log(`Total checked: ${results.length}`);
  console.log(`FIXED: ${fixed.length}`);
  console.log(`STILL OPEN: ${open.length}`);
  console.log(`OTHER (partial/skipped/check): ${other.length}`);
  console.log('\nSTILL OPEN:');
  open.forEach((r) => console.log(` - ${r.id}: ${r.actual}`));
  console.log('\nFIXED:');
  fixed.forEach((r) => console.log(` - ${r.id}: ${r.actual}`));

  // write json report
  const fs = await import('fs');
  const out = {
    ranAt: new Date().toISOString(),
    summary: { total: results.length, fixed: fixed.length, open: open.length, other: other.length },
    results,
  };
  fs.mkdirSync('reports/flight', { recursive: true });
  fs.writeFileSync('reports/flight/bug-reverification.json', JSON.stringify(out, null, 2));
  console.log('\nWrote reports/flight/bug-reverification.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

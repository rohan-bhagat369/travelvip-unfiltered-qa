/**
 * Follow-up probes for issues skipped when CORPORATE OW search hung.
 */
import { config } from '../../../shared/config/env.js';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';
import {
  buildOneWaySearchBody,
  buildRoundTripSearchBody,
  buildIssueTicketPayload,
  canSelectSeats,
  extractOnwardSearchId,
  isSearchProgressComplete,
} from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const results = [];
function record(id, status, actual, notes = '') {
  results.push({ id, status, actual, notes });
  console.log(`[${status.startsWith('FIXED') ? 'FIXED' : status === 'STILL OPEN' ? 'OPEN ' : status.slice(0, 5)}] ${id} — ${actual}`);
}

function info(res) {
  return `HTTP ${res.status} ok=${res.ok} status=${res.data?.status} br=${res.data?.bookingReference || res.data?.bookingRefId || 'n/a'} msg=${res.data?.message || res.data?.error?.message || res.data?.error?.code || ''}`;
}

const { client } = await authenticate(true);
const flight = new FlightService(client);

console.log('\n=== Follow-up: OW NORMAL seed ===\n');
const ow = await flight.searchUntilComplete(buildOneWaySearchBody(55, { fareType: 'NORMAL' }));
const searchId = ow.searchId;
const pricing = await flight.getPricing([searchId], 'ONE_WAY');
console.log(`seeded searchId=${searchId} priceId=${pricing.data?.priceId}`);

// Seat map
{
  const supports = canSelectSeats(pricing.data);
  const seat = await flight.getSeatMap(pricing.data.bookingContext);
  const raw = JSON.stringify(seat.data || {});
  const segs = seat.data?.data?.segments || seat.data?.segments || seat.data?.FlightSeat?.segments || [];
  const empty =
    seat.ok &&
    (seat.data?.FlightSeat == null ||
      (Array.isArray(segs) && segs.length === 0) ||
      /not allow select seat/i.test(raw));
  record(
    'SEAT-001/002 seat map empty or error shape',
    empty ? 'STILL OPEN' : seat.status === 502 ? 'STILL OPEN' : seat.ok && segs.length > 0 ? 'FIXED' : !seat.ok ? 'FIXED' : 'CHECK',
    `${info(seat)} supportsSeats=${supports} segments=${Array.isArray(segs) ? segs.length : 'n/a'}`,
    raw.slice(0, 200),
  );
}

async function issueMutate(mutate) {
  const body = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
  });
  mutate?.(body);
  return client.request({
    method: 'POST',
    path: '/v1/flights/booking/issue-ticket',
    query: { ...config.flight.issueTicketQuery, lang: 'en', currency: 'INR', count: 10, page: 0, perpage: 20 },
    body,
    correlation: true,
  });
}

function openGap(res) {
  return res.ok && Boolean(res.data?.bookingReference || res.data?.bookingRefId || /pending|processing/i.test(String(res.data?.status || '')));
}

const issueCases = [
  ['ISSUE-001 invalid priceId', () => flight.issueTicket({ bookingContext: pricing.data.bookingContext, priceId: 'price_invalid_000', searchIds: [searchId], journeyType: 'ONE_WAY' })],
  ['ISSUE-002 invalid bookingContext', () => flight.issueTicket({ bookingContext: 'invalid-context', priceId: pricing.data.priceId, searchIds: [searchId], journeyType: 'ONE_WAY' })],
  ['ISSUE-003 BR as bookingReference', () => flight.issueTicket({ bookingContext: 'BR0000000000001', priceId: pricing.data.priceId, searchIds: [searchId], journeyType: 'ONE_WAY' })],
  ['ISSUE-004 lastName digits', () => flight.issueTicket({ bookingContext: pricing.data.bookingContext, priceId: pricing.data.priceId, searchIds: [searchId], journeyType: 'ONE_WAY', passengerProfile: { lastName: 'Test123' } })],
  ['ISSUE-005 empty lastName', () => flight.issueTicket({ bookingContext: pricing.data.bookingContext, priceId: pricing.data.priceId, searchIds: [searchId], journeyType: 'ONE_WAY', passengerProfile: { lastName: '' } })],
  ['ISSUE-006 invalid email', () => issueMutate((b) => { b.data.contact.email = 'not-an-email'; })],
  ['ISSUE-007 empty mobile', () => issueMutate((b) => { b.data.contact.mobile = ''; })],
  ['ISSUE-008 invalid dob', () => flight.issueTicket({ bookingContext: pricing.data.bookingContext, priceId: pricing.data.priceId, searchIds: [searchId], journeyType: 'ONE_WAY', passengerProfile: { dob: 'invalid' } })],
  ['ISSUE-009 journeyType mismatch', () => flight.issueTicket({ bookingContext: pricing.data.bookingContext, priceId: pricing.data.priceId, searchIds: [searchId], journeyType: 'ROUND_TRIP' })],
];

console.log('\n=== Issue ticket negative cases ===\n');
for (const [id, run] of issueCases) {
  const res = await run();
  const is500 = res.status === 500 || res.data?.status === 500 || /PRICING_FETCH_FAILED/i.test(JSON.stringify(res.data || {}));
  let status;
  if (id.includes('journeyType')) {
    status = is500 ? 'STILL OPEN' : !res.ok && res.status === 400 ? 'FIXED' : openGap(res) ? 'STILL OPEN' : !res.ok ? 'PARTIAL' : 'STILL OPEN';
  } else {
    status = openGap(res) ? 'STILL OPEN' : 'FIXED';
  }
  record(id, status, info(res));
}

// Naming contract
{
  const body = buildIssueTicketPayload({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
  });
  record(
    'ISSUE-010 bookingContext vs bookingReference naming',
    pricing.data.bookingContext && body.bookingReference && !body.bookingContext ? 'STILL OPEN' : 'CHECK',
    `pricing returns bookingContext; issue-ticket request field is bookingReference=${Boolean(body.bookingReference)}`,
    'Same token, different property names — contract inconsistency',
  );
}

// Valid issue + status casing / totalPassengers / cancel penalty typo
console.log('\n=== Valid issue + status/cancel fields ===\n');
{
  const issue = await flight.issueTicket({
    bookingContext: pricing.data.bookingContext,
    priceId: pricing.data.priceId,
    searchIds: [searchId],
    journeyType: 'ONE_WAY',
  });
  const br = issue.data?.bookingReference;
  record('ISSUE-valid creates BR', issue.ok && br ? 'OK' : 'FAIL', info(issue));

  if (br) {
    let statusRes;
    for (let i = 0; i < 8; i++) {
      statusRes = await flight.getBookingStatus(br);
      const s = String(statusRes.data?.status || '');
      if (!/pending|inprogress|in_progress|processing/i.test(s)) break;
      await sleep(5000);
    }
    const statusVal = statusRes.data?.status;
    const casingMixed = statusVal && statusVal !== String(statusVal).toLowerCase();
    const totalPax = statusRes.data?.summary?.totalPassengers ?? statusRes.data?.totalPassengers;
    record(
      'STATUS-002 status casing',
      casingMixed ? 'STILL OPEN' : 'FIXED/OK',
      `status=${statusVal}`,
    );
    record(
      'STATUS-003 totalPassengers',
      totalPax === 0 ? 'STILL OPEN' : totalPax >= 1 ? 'FIXED' : 'CHECK',
      `totalPassengers=${totalPax}`,
    );

    const penalty = await flight.checkCancellationPenalty(br);
    const keys = JSON.stringify(penalty.data || {});
    const typo = /penalityAmount|totalPenalityAmount/i.test(keys);
    const correct = /penaltyAmount|totalPenaltyAmount/i.test(keys);
    record(
      'CANCEL-001 penality typo in field names',
      typo ? 'STILL OPEN' : correct ? 'FIXED' : 'CHECK',
      `typo=${typo} correct=${correct} keys sample=${keys.slice(0, 250)}`,
    );

    // Provider error visibility on a known-bad prior booking if status failed
    if (/fail/i.test(String(statusVal))) {
      const topLevel = statusRes.data?.message || statusRes.data?.error;
      const nested = statusRes.data?.result?.status || statusRes.data?.bookingResponse;
      record(
        'STATUS-004 provider error visibility',
        topLevel ? 'FIXED' : nested ? 'STILL OPEN' : 'CHECK',
        `topLevel=${Boolean(topLevel)} nested=${Boolean(nested)}`,
      );
    }
  }
}

// SEARCH_CACHE_MISS early select via RT search with selection
console.log('\n=== RT early selection SEARCH_CACHE_MISS ===\n');
{
  const body = buildRoundTripSearchBody(35, 42, { fareType: 'NORMAL' });
  const first = await flight.search(body);
  await sleep(1000);
  const onward = extractOnwardSearchId(first.data);
  if (onward) {
    const refined = { ...body, selection: { selectedSearchIds: [onward] } };
    const early = await flight.search(refined);
    const miss =
      early.status === 502 ||
      early.data?.error?.code === 'SEARCH_CACHE_MISS' ||
      /SEARCH_CACHE_MISS|Cached search/i.test(JSON.stringify(early.data || {}));
    record(
      'RT-002 SEARCH_CACHE_MISS early select',
      miss ? 'STILL OPEN' : early.ok ? 'FIXED/IMPROVED' : 'CHECK',
      info(early) + ` code=${early.data?.error?.code || ''}`,
    );
  } else {
    // try after a few polls without waiting for complete
    let onward2 = null;
    let last = first;
    for (let i = 0; i < 5 && !onward2; i++) {
      await sleep(3000);
      last = await flight.search(body);
      onward2 = extractOnwardSearchId(last.data);
    }
    if (onward2) {
      const early = await flight.search({ ...body, selection: { selectedSearchIds: [onward2] } });
      const miss =
        early.status === 502 ||
        early.data?.error?.code === 'SEARCH_CACHE_MISS' ||
        /SEARCH_CACHE_MISS|Cached search/i.test(JSON.stringify(early.data || {}));
      record(
        'RT-002 SEARCH_CACHE_MISS early select',
        miss ? 'STILL OPEN' : early.ok ? 'FIXED/IMPROVED' : 'CHECK',
        info(early) + ` code=${early.data?.error?.code || ''}`,
      );
    } else {
      record('RT-002 SEARCH_CACHE_MISS early select', 'SKIPPED', `no onward; progress=${last.data?.progress?.state}`);
    }
  }
}

// International passport
console.log('\n=== Intl passport ===\n');
try {
  const intl = await flight.searchUntilComplete(
    buildOneWaySearchBody(70, { origin: 'DEL', destination: 'DXB', fareType: 'NORMAL' }),
  );
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
  record(
    'ISSUE-011 intl passport validation',
    openGap(res) ? 'STILL OPEN' : 'FIXED',
    info(res),
  );
} catch (e) {
  record('ISSUE-011 intl passport validation', 'SKIPPED', e.message.slice(0, 150));
}

const open = results.filter((r) => r.status === 'STILL OPEN');
const fixed = results.filter((r) => r.status.startsWith('FIXED'));
console.log('\n=== FOLLOW-UP SUMMARY ===');
console.log(`OPEN=${open.length} FIXED=${fixed.length}`);
open.forEach((r) => console.log(' OPEN', r.id, r.actual));
fixed.forEach((r) => console.log(' FIXED', r.id, r.actual));

const fs = await import('fs');
fs.writeFileSync(
  'reports/flight/bug-reverification-followup.json',
  JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2),
);

/**
 * Cab: check if passenger-name-change still creates a new booking
 * (same X-Request-Id + same fare tokens, only name changed).
 *
 * Also checks exact same-payload retry for duplicate.
 *
 * Run:
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-same-requestid-name-change.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  futurePickupDatetime,
  pickCab,
} from '../src/helpers.js';
import fs from 'fs';

function brOf(data) {
  return data?.bookingRefId || data?.bookingReferenceId || data?.bookingReference || null;
}
function isDup(data) {
  const msg = `${data?.message || ''} ${data?.error?.message || ''} ${JSON.stringify(data || {})}`.toLowerCase();
  return data?.duplicate === true || msg.includes('duplicate payload') || msg.includes('duplicate request');
}
function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

async function main() {
  const session = await authenticate(true);
  const client = session.client;
  const cab = new CabService(client);

  const searchBody = buildAirportSearchBody(futurePickupDatetime(5));
  const search = await cab.search(searchBody);
  if (!search.ok) throw new Error(`cab search failed: ${search.status} ${JSON.stringify(search.data).slice(0, 200)}`);

  const selected = pickCab(search.data?.cabs);
  if (!selected?.searchId) throw new Error('no cab with searchId');

  const fare = await cab.fare(selected.searchId);
  if (!fare.ok || !fare.data?.bookingReference || !fare.data?.priceId) {
    throw new Error(`cab fare failed: ${fare.status} ${JSON.stringify(fare.data).slice(0, 300)}`);
  }

  const bookingReference = fare.data.bookingReference;
  const priceId = fare.data.priceId;
  const totalHint =
    fare.data?.pricing?.totalAmount
    ?? fare.data?.totalAmount
    ?? fare.data?.fare?.totalAmount
    ?? null;

  const base = buildFinalizeBody({ bookingReference, priceId });
  const bodyA = clone(base);
  bodyA.passengers[0].profile.firstName = 'RohanOne';
  bodyA.passengers[0].profile.lastName = 'BhagatOne';

  const bodyB = clone(base);
  bodyB.passengers[0].profile.firstName = 'RohanTwo';
  bodyB.passengers[0].profile.lastName = 'BhagatTwo';

  const requestId = `req-sameid-cab-${Date.now()}`;

  // Case A: exact same payload retry (name A twice)
  const hitSame1 = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking',
    query: { lang: 'en', currency: 'INR' },
    body: bodyA,
    correlation: true,
    extraHeaders: { 'X-Request-Id': requestId },
  });
  const brSame1 = brOf(hitSame1.data);

  const hitSame2 = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking',
    query: { lang: 'en', currency: 'INR' },
    body: bodyA,
    correlation: true,
    extraHeaders: { 'X-Request-Id': requestId },
  });
  const brSame2 = brOf(hitSame2.data);

  // Case C: same requestId + same fare tokens, only passenger name changed
  // Need fresh fare tokens if first fare was consumed — try same tokens first.
  let nameChange = null;
  {
    const hitName = await client.request({
      method: 'POST',
      path: '/v1/airportServices/cabs/finalize-booking',
      query: { lang: 'en', currency: 'INR' },
      body: bodyB,
      correlation: true,
      extraHeaders: { 'X-Request-Id': requestId },
    });
    const brName = brOf(hitName.data);
    nameChange = {
      usedSameFareTokens: true,
      http: hitName.status,
      br: brName,
      duplicate: isDup(hitName.data),
      message: hitName.data?.message || hitName.data?.status || hitName.data?.code || null,
      data: hitName.data,
      sameBrAsFirst: !!(brSame1 && brName && brSame1 === brName),
      newBookingCreated: !!(brSame1 && brName && brSame1 !== brName && !isDup(hitName.data)),
    };
  }

  // If name-change with same fare tokens failed without BR, try fresh fare + same requestId + name B
  if (!nameChange.br && !nameChange.duplicate) {
    const fare2 = await cab.fare(selected.searchId);
    if (fare2.ok && fare2.data?.bookingReference && fare2.data?.priceId) {
      const bodyB2 = buildFinalizeBody({
        bookingReference: fare2.data.bookingReference,
        priceId: fare2.data.priceId,
      });
      bodyB2.passengers[0].profile.firstName = 'RohanTwo';
      bodyB2.passengers[0].profile.lastName = 'BhagatTwo';

      const hitName2 = await client.request({
        method: 'POST',
        path: '/v1/airportServices/cabs/finalize-booking',
        query: { lang: 'en', currency: 'INR' },
        body: bodyB2,
        correlation: true,
        extraHeaders: { 'X-Request-Id': requestId },
      });
      const brName2 = brOf(hitName2.data);
      nameChange = {
        usedSameFareTokens: false,
        note: 'second attempt used fresh fare tokens; still same X-Request-Id + different passenger name',
        http: hitName2.status,
        br: brName2,
        duplicate: isDup(hitName2.data),
        message: hitName2.data?.message || hitName2.data?.status || hitName2.data?.code || null,
        data: hitName2.data,
        sameBrAsFirst: !!(brSame1 && brName2 && brSame1 === brName2),
        newBookingCreated: !!(brSame1 && brName2 && brSame1 !== brName2 && !isDup(hitName2.data)),
      };
    }
  }

  const out = {
    service: 'Cab',
    journeyType: 'AIRPORT',
    sameRequestId: requestId,
    fareTotalHint: totalHint,
    samePayloadRetry: {
      passenger: { firstName: 'RohanOne', lastName: 'BhagatOne' },
      hit1: {
        http: hitSame1.status,
        br: brSame1,
        duplicate: isDup(hitSame1.data),
        message: hitSame1.data?.message || hitSame1.data?.status || null,
        data: hitSame1.data,
      },
      hit2: {
        http: hitSame2.status,
        br: brSame2,
        duplicate: isDup(hitSame2.data),
        message: hitSame2.data?.message || hitSame2.data?.status || null,
        data: hitSame2.data,
      },
      sameBr: !!(brSame1 && brSame2 && brSame1 === brSame2),
      duplicateOnSecond: isDup(hitSame2.data),
    },
    nameChange: {
      passengerA: { firstName: 'RohanOne', lastName: 'BhagatOne' },
      passengerB: { firstName: 'RohanTwo', lastName: 'BhagatTwo' },
      bookingIdA: brSame1,
      bookingIdB: nameChange.br,
      ...nameChange,
    },
  };

  console.log(JSON.stringify(out, null, 2));
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/cab-same-requestid-name-change.json', JSON.stringify(out, null, 2));

  // Best-effort cancel to reduce wallet/driver impact
  for (const br of [brSame1, brSame2, nameChange.br].filter(Boolean)) {
    try {
      await cab.cancelBooking(br);
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

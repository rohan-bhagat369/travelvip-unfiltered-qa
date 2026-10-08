/**
 * Hotel security: Finalize Booking + Cancel Booking
 * A) Concurrent identical request
 * B) Sequential same payload within 15 min
 * Plus a few negatives.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-security-hotel.js
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import { createRequestId, createSignature, createTimestamp } from '../../../shared/lib/signature.js';
import {
  buildSearchBody,
  buildFinalizeBody,
  buildGuests,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  HOTEL_QUERY,
} from '../src/helpers.js';

const findings = [];

function rec(id, type, title, expected, actual, pass, notes = '') {
  findings.push({ id, type, title, expected, actual, pass, notes });
  console.log(`\n[${pass ? 'PASS' : 'FAIL/BUG'}] ${id} ${title}`);
  console.log('  expected:', expected);
  console.log('  actual  :', actual);
  if (notes) console.log('  notes   :', notes);
}

function hasDupPayload(data) {
  return data?.duplicate === true
    || /duplicate payload/i.test(`${data?.message || ''} ${JSON.stringify(data || {})}`);
}

function hasDupRequest(data) {
  return data?.code === 'DUPLICATE_REQUEST'
    || data?.status === 409
    || data?.error?.code === 'DUPLICATE_REQUEST'
    || /duplicate request/i.test(String(data?.message || data?.error?.message || ''));
}

function brOf(data) {
  return data?.bookingRefId || data?.bookingReferenceId || data?.bookingReference || null;
}

async function postRaw(client, { method = 'POST', path, query, body, identicalCurl = false, frozen, rawBody }) {
  const bodyString = rawBody ?? (body === undefined ? '' : JSON.stringify(body));
  let timestamp;
  let signature;
  let requestId;
  if (identicalCurl && frozen) {
    ({ timestamp, signature, requestId } = frozen);
  } else {
    timestamp = createTimestamp();
    requestId = createRequestId();
    signature = createSignature(bodyString, timestamp, client.signingKey);
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${client.authToken}`,
    'X-Request-Id': requestId,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
    'X-Correlation-ID': client.correlationId,
  };
  const url = client.buildUrl(path, query);
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : bodyString,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { http: res.status, ok: res.ok, data, elapsedMs: Date.now() - started, br: brOf(data) };
}

function freeze(client, bodyOrRaw) {
  const bodyString = typeof bodyOrRaw === 'string' ? bodyOrRaw : JSON.stringify(bodyOrRaw);
  const timestamp = createTimestamp();
  return {
    timestamp,
    signature: createSignature(bodyString, timestamp, client.signingKey),
    requestId: createRequestId(),
  };
}

async function prepareFinalizePayload(hotel) {
  // Use farther dates so cancel policy is free / bookable, and unique enough inventory
  const searchBody = buildSearchBody({
    entityId: config.hotel.defaultEntityId,
    checkinDays: 21,
    nights: config.hotel.nights || 1,
  });
  const search = await hotel.search(searchBody);
  if (!search.ok) throw new Error(`search failed: ${search.status}`);
  const details = await hotel.getDetails(searchBody);
  if (!details.ok) throw new Error(`details failed: ${details.status}`);
  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  const rooms = (details.data?.results?.[0]?.rooms || []).filter(
    (r) => r.available !== false && r.bookingCode,
  );
  if (!rooms.length) throw new Error('no rooms');

  let lastErr;
  for (const room of rooms.slice(0, 8)) {
    const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    if (!isPrebookSuccess(prebook)) {
      lastErr = prebook.data;
      continue;
    }
    const bookingContext = extractBookingContext(prebook.data);
    const finalizeBody = buildFinalizeBody({
      bookingContext,
      bookingCode: room.bookingCode,
      requestId,
      checkin: searchBody.checkin,
      checkout: searchBody.checkout,
      guests: buildGuests(),
    });
    return {
      finalizeBody,
      searchBody,
      roomName: room.name || room.roomType,
      hotelName: details.data?.results?.[0]?.name,
      price: room.price,
    };
  }
  throw new Error(`prebook failed for all rooms: ${JSON.stringify(lastErr).slice(0, 200)}`);
}

async function bookConfirmed(hotel, client) {
  const prep = await prepareFinalizePayload(hotel);
  // unique email so payload won't collide with prior finalize tests
  prep.finalizeBody.contact.email = `qa.hotel.${Date.now()}@travelvip.ai`;
  const issue = await postRaw(client, {
    path: '/v1/hotels/finalize-booking',
    query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
    body: prep.finalizeBody,
  });
  const br = issue.br;
  if (!br) throw new Error(`finalize failed: ${JSON.stringify(issue.data).slice(0, 250)}`);
  const { status } = await hotel.waitForBookingStatus(br, 36);
  return { br, status, finalizeBody: prep.finalizeBody };
}

async function main() {
  console.log('Base URL:', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);

  console.log('\n######## HOTEL FINALIZE BOOKING ########');

  // HF-P1 concurrent identical finalize
  {
    const prep = await prepareFinalizePayload(hotel);
    const body = prep.finalizeBody;
    const frozen = freeze(client, body);
    console.log('Prepared finalize for', prep.hotelName, prep.roomName, prep.searchBody.checkin);
    const [r1, r2] = await Promise.all([
      postRaw(client, {
        path: '/v1/hotels/finalize-booking',
        query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
        body,
        identicalCurl: true,
        frozen,
      }),
      postRaw(client, {
        path: '/v1/hotels/finalize-booking',
        query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
        body,
        identicalCurl: true,
        frozen,
      }),
    ]);
    const brs = [...new Set([r1.br, r2.br].filter(Boolean))];
    const oneDup = hasDupRequest(r1.data) || hasDupRequest(r2.data);
    rec(
      'HF-P1',
      'POSITIVE',
      'Concurrent identical Finalize Booking',
      '1 BR + other DUPLICATE_REQUEST',
      `BRs=${JSON.stringify(brs)} r1=${r1.br || r1.data?.code || r1.data?.error?.code || r1.data?.message} r2=${r2.br || r2.data?.code || r2.data?.error?.code || r2.data?.message}`,
      brs.length === 1 && oneDup,
      brs.length > 1 ? 'BUG: two hotel bookings from concurrent finalize' : '',
    );
    for (const br of brs) {
      const { status } = await hotel.waitForBookingStatus(br, 24);
      console.log('  finalize BR', br, status);
    }
  }

  // HF-P2 sequential same payload
  {
    const prep = await prepareFinalizePayload(hotel);
    const body = prep.finalizeBody;
    const r1 = await postRaw(client, {
      path: '/v1/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body,
    });
    await new Promise((r) => setTimeout(r, 2000));
    const r2 = await postRaw(client, {
      path: '/v1/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body,
    });
    rec(
      'HF-P2',
      'POSITIVE',
      'Sequential same Finalize payload <15min',
      'same BR + Duplicate payload message',
      `br1=${r1.br} br2=${r2.br} dup=${r2.data?.duplicate} msg=${r2.data?.message}`,
      !!r1.br && r1.br === r2.br && hasDupPayload(r2.data),
      !hasDupPayload(r2.data) && r1.br && r2.br && r1.br !== r2.br
        ? 'BUG: created second hotel booking for same finalize payload'
        : '',
    );
    if (r1.br) await hotel.waitForBookingStatus(r1.br, 24).catch(() => {});
  }

  // HF-N1 different email should NOT be duplicate of previous
  {
    const prep = await prepareFinalizePayload(hotel);
    const body1 = prep.finalizeBody;
    const r1 = await postRaw(client, {
      path: '/v1/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body: body1,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const body2 = JSON.parse(JSON.stringify(body1));
    body2.contact.email = `qa.alt.${Date.now()}@travelvip.ai`;
    const r2 = await postRaw(client, {
      path: '/v1/hotels/finalize-booking',
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body: body2,
    });
    const wrongly = hasDupPayload(r2.data) && r1.br && r2.br === r1.br;
    rec(
      'HF-N1',
      'NEGATIVE',
      'Different contact email must NOT reuse previous finalize BR',
      'New booking or business error — not duplicate of first',
      `br1=${r1.br} br2=${r2.br} dup=${r2.data?.duplicate} msg=${r2.data?.message}`,
      !wrongly,
      wrongly ? 'BUG: different email returned previous hotel BR' : '',
    );
    if (r1.br) await hotel.waitForBookingStatus(r1.br, 20).catch(() => {});
    if (r2.br && r2.br !== r1.br) await hotel.waitForBookingStatus(r2.br, 20).catch(() => {});
  }

  // HF-N2 concurrent same body, different request ids
  {
    const prep = await prepareFinalizePayload(hotel);
    const body = prep.finalizeBody;
    const [r1, r2] = await Promise.all([
      postRaw(client, {
        path: '/v1/hotels/finalize-booking',
        query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
        body,
      }),
      postRaw(client, {
        path: '/v1/hotels/finalize-booking',
        query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
        body,
      }),
    ]);
    const brs = [...new Set([r1.br, r2.br].filter(Boolean))];
    const protected_ = brs.length <= 1 && (
      hasDupRequest(r1.data) || hasDupRequest(r2.data)
      || hasDupPayload(r1.data) || hasDupPayload(r2.data)
      || (r1.br && r2.br && r1.br === r2.br)
    );
    rec(
      'HF-N2',
      'NEGATIVE',
      'Concurrent same finalize body, different X-Request-Id',
      'Still protected (1 BR or duplicate signal)',
      `BRs=${JSON.stringify(brs)} dupReq=${hasDupRequest(r1.data) || hasDupRequest(r2.data)}`,
      protected_ || brs.length <= 1,
      brs.length > 1 ? 'BUG: header-only difference created 2 hotel bookings' : '',
    );
    for (const br of brs) await hotel.waitForBookingStatus(br, 20).catch(() => {});
  }

  console.log('\n######## HOTEL CANCEL BOOKING ########');

  let brA;
  let brB;
  try {
    const a = await bookConfirmed(hotel, client);
    brA = a.br;
    console.log('Confirmed BR-A for cancel tests:', brA, a.status);
  } catch (e) {
    rec('HC-SETUP-A', 'SETUP', 'Book confirmed hotel A', 'Confirmed BR', e.message, false);
  }
  try {
    const b = await bookConfirmed(hotel, client);
    brB = b.br;
    console.log('Confirmed BR-B for cancel tests:', brB, b.status);
  } catch (e) {
    rec('HC-SETUP-B', 'SETUP', 'Book confirmed hotel B', 'Confirmed BR', e.message, false);
  }

  // Hotel cancel is GET in this API
  if (brA && String((await hotel.getBookingStatus(brA)).data?.status).toLowerCase() === 'confirmed') {
    const path = `/v1/hotels/bookings/${brA}/cancel`;

    // HC-P1 concurrent identical cancel (same URL, identical headers)
    {
      const frozen = freeze(client, ''); // GET body empty
      const [r1, r2] = await Promise.all([
        postRaw(client, { method: 'GET', path, query: HOTEL_QUERY, body: undefined, identicalCurl: true, frozen, rawBody: '' }),
        postRaw(client, { method: 'GET', path, query: HOTEL_QUERY, body: undefined, identicalCurl: true, frozen, rawBody: '' }),
      ]);
      const oneDup = hasDupRequest(r1.data) || hasDupRequest(r2.data);
      const bothFullRefund = [r1, r2].filter((x) => Number(x.data?.result?.totalRefund) > 0).length;
      rec(
        'HC-P1',
        'POSITIVE',
        'Concurrent identical Hotel Cancel (GET)',
        'One processes, other DUPLICATE_REQUEST',
        `dup=${oneDup} r1refund=${r1.data?.result?.totalRefund} r2refund=${r2.data?.result?.totalRefund} r1code=${r1.data?.code || r1.data?.error?.code} r2code=${r2.data?.code || r2.data?.error?.code}`,
        oneDup,
        !oneDup ? 'BUG or not implemented for hotel cancel GET' : '',
      );
      await new Promise((r) => setTimeout(r, 2000));
      const st = await hotel.getBookingStatus(brA);
      console.log('  BR-A status after concurrent cancel:', st.data?.status, 'bothFullRefundCount~', bothFullRefund);
    }

    // HC-P2 sequential same cancel
    {
      const r2 = await postRaw(client, { method: 'GET', path, query: HOTEL_QUERY, rawBody: '' });
      rec(
        'HC-P2',
        'POSITIVE',
        'Sequential same Hotel Cancel URL <15min',
        'Duplicate payload / previous cancel response',
        `dup=${r2.data?.duplicate} msg=${r2.data?.message} refund=${r2.data?.result?.totalRefund} status=${(await hotel.getBookingStatus(brA)).data?.status}`,
        hasDupPayload(r2.data),
        !hasDupPayload(r2.data) ? 'BUG: no duplicate payload on hotel cancel retry' : '',
      );
    }
  }

  if (brB && String((await hotel.getBookingStatus(brB)).data?.status).toLowerCase() === 'confirmed') {
    const path = `/v1/hotels/bookings/${brB}/cancel`;

    // First cancel alone then duplicate
    {
      const r1 = await postRaw(client, { method: 'GET', path, query: HOTEL_QUERY, rawBody: '' });
      await new Promise((r) => setTimeout(r, 1500));
      const r2 = await postRaw(client, { method: 'GET', path, query: HOTEL_QUERY, rawBody: '' });
      const st = await hotel.getBookingStatus(brB);
      rec(
        'HC-P3',
        'POSITIVE',
        'Cancel once then retry same cancel',
        '1st success, 2nd duplicate payload (not second refund)',
        `r1refund=${r1.data?.result?.totalRefund} r2dup=${r2.data?.duplicate} r2msg=${r2.data?.message} status=${st.data?.status}`,
        hasDupPayload(r2.data) || (Number(r1.data?.result?.totalRefund) >= 0 && String(st.data?.status).toLowerCase().includes('cancel')),
        hasDupPayload(r2.data) ? 'OK' : 'Check if 2nd is business already-cancelled without duplicate flag',
      );
    }
  }

  // HC-N1 cancel different BR should not be duplicate of another
  if (brA && brB && brA !== brB) {
    // brA already cancelled; brB maybe cancelled too. Book a fresh one if needed.
    let brC = null;
    try {
      const c = await bookConfirmed(hotel, client);
      brC = c.br;
    } catch (e) {
      console.log('Could not book BR-C:', e.message);
    }
    if (brC) {
      const path = `/v1/hotels/bookings/${brC}/cancel`;
      const r = await postRaw(client, { method: 'GET', path, query: HOTEL_QUERY, rawBody: '' });
      rec(
        'HC-N1',
        'NEGATIVE',
        'Cancel different BR is a new request (not cross-BR duplicate)',
        'Normal cancel success for this BR',
        `br=${brC} dup=${r.data?.duplicate} refund=${r.data?.result?.totalRefund} code=${r.data?.code}`,
        !hasDupPayload(r.data) && (r.br === brC || r.data?.bookingRefId === brC || Number(r.data?.result?.totalRefund) >= 0),
      );
      await new Promise((x) => setTimeout(x, 1000));
      console.log('  BR-C status', (await hotel.getBookingStatus(brC)).data?.status);
    }
  }

  console.log('\n\n========== SUMMARY ==========');
  const failed = findings.filter((f) => !f.pass);
  console.log(`Total: ${findings.length}  PASS: ${findings.length - failed.length}  FAIL/BUG: ${failed.length}`);
  for (const f of findings) {
    console.log(`${f.pass ? 'PASS' : 'BUG '} | ${f.id} | ${f.type} | ${f.title}${f.notes ? ' || ' + f.notes : ''}`);
  }
  if (failed.length) {
    console.log('\n--- FAILURES ---');
    for (const f of failed) console.log(JSON.stringify(f, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

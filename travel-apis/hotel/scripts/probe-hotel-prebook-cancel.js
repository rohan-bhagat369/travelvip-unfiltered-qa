/**
 * DEV/STAGING: Inspect hotel PREBOOK response for cancellation policy fields.
 * Flow: autocomplete Pune → CITY search → HOTEL search → details → prebook
 * Does NOT finalize/book.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-hotel-prebook-cancel.js
 */
import { writeFileSync } from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { config } from '../../../shared/config/env.js';
import { futureDate } from '../../../shared/lib/testUtils.js';
import { isPrebookSuccess } from '../src/helpers.js';

const Q = { lang: 'en', currency: 'INR' };

function pickPuneCity(content = []) {
  return (
    content.find(
      (x) =>
        /CITY/i.test(String(x.type || '')) &&
        /^pune$/i.test(String(x.title || '').trim()) &&
        /india/i.test(String(x.country || ''))
    ) ||
    content.find(
      (x) => /CITY/i.test(String(x.type || '')) && /pune/i.test(x.title || '')
    ) ||
    null
  );
}

function isCancellableFromSearch(hotel) {
  if (hotel?.refundable === true) return true;
  const notes = (hotel?.refundableNotes || []).join(' ').toLowerCase();
  return (
    /free\s*cancel|fully\s*refund|refundable/.test(notes) &&
    !/non.?refund/.test(notes)
  );
}

function findCancelFields(obj, path = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findCancelFields(v, `${path}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/cancel|refund/i.test(k)) {
      out.push({
        path: p,
        type: Array.isArray(v) ? `array(${v.length})` : typeof v,
        sample: JSON.stringify(v)?.slice(0, 800),
      });
    }
    if (v && typeof v === 'object') findCancelFields(v, p, out);
  }
  return out;
}

async function main() {
  console.log('Base:', config.baseUrl, '| hotel prebook cancellation fields');
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotelApi = new HotelService(session.client);
  const client = session.client;

  const ac = await hotelApi.autocomplete('Pune');
  const city = pickPuneCity(ac.data?.content || []);
  if (!city?.entityId) throw new Error('Pune CITY not found');
  console.log('City', city.entityId, city.title);

  const checkin = futureDate(21);
  const checkout = futureDate(23);
  const roomsOcc = [{ adults: 1, children: 0, childrenAges: [] }];
  console.log('Dates', checkin, '->', checkout);

  const citySearch = await client.request({
    method: 'POST',
    path: '/v1/hotels/search',
    query: { ...Q, page: 0, perpage: 40, sortby: 'price,asc' },
    body: {
      checkin,
      checkout,
      entityId: String(city.entityId),
      nationality: 'IN',
      type: 'CITY',
      rooms: roomsOcc,
    },
    correlation: true,
    partnerKey: session.accessToken,
  });

  const results = [...(citySearch.data?.results || [])].filter(
    (h) => h?.available !== false
  );
  const cancellable = results.filter(isCancellableFromSearch);
  console.log(
    'search http',
    citySearch.status,
    'hotels',
    results.length,
    'cancellable',
    cancellable.length
  );

  const candidates = (cancellable.length ? cancellable : results).slice(0, 8);
  let success = null;

  for (const h of candidates) {
    console.log('\nTry hotel', h.id, h.name, 'refundable', h.refundable, h.refundableNotes);

    await client.request({
      method: 'POST',
      path: '/v1/hotels/search',
      query: { ...Q, page: 0, perpage: 20 },
      body: {
        checkin,
        checkout,
        entityId: String(h.id),
        nationality: 'IN',
        type: 'HOTEL',
        rooms: roomsOcc,
      },
      correlation: true,
      partnerKey: session.accessToken,
    });

    const details = await hotelApi.getDetails({
      checkin,
      checkout,
      entityId: String(h.id),
      nationality: 'IN',
      rooms: roomsOcc,
    });
    const requestId = details.data?.requestId;
    const hotelResult = details.data?.results?.[0];
    const rooms = (hotelResult?.rooms || []).filter(
      (r) => r.available !== false && r.bookingCode
    );
    console.log(
      'details http',
      details.status,
      'requestId',
      !!requestId,
      'rooms',
      rooms.length
    );
    if (!requestId || !rooms.length) continue;

    // Prefer room with cancelPolicies
    rooms.sort((a, b) => {
      const ap = (a.cancelPolicies || []).length;
      const bp = (b.cancelPolicies || []).length;
      const ar = a.refundable === true ? 1 : 0;
      const br = b.refundable === true ? 1 : 0;
      return bp - ap || br - ar;
    });
    const room = rooms[0];

    const detailsCancel = {
      refundable: room.refundable,
      refundableNotes: room.refundableNotes || [],
      cancelPolicies: room.cancelPolicies || [],
      benefitsIcon: (room.benefitsIcon || []).map((b) => b.key || b),
    };

    const prebook = await hotelApi.prebook({
      bookingCode: room.bookingCode,
      requestId,
    });
    console.log(
      'prebook http',
      prebook.status,
      'ok',
      prebook.ok,
      'success',
      isPrebookSuccess(prebook)
    );
    if (!isPrebookSuccess(prebook)) {
      console.log('prebook fail', JSON.stringify(prebook.data).slice(0, 300));
      continue;
    }

    const cancelPaths = findCancelFields(prebook.data);
    success = {
      hotel: {
        id: h.id,
        name: h.name,
        searchRefundable: h.refundable,
        searchRefundableNotes: h.refundableNotes || [],
      },
      room: {
        name: room.name,
        bookingCode: room.bookingCode,
        price: room.price || room.pricing || null,
      },
      checkin,
      checkout,
      requestId,
      detailsCancel,
      prebookHttp: prebook.status,
      prebookTopKeys: Object.keys(prebook.data || {}),
      prebookCancelRelatedPaths: cancelPaths,
      prebookData: prebook.data,
    };
    break;
  }

  if (!success) {
    console.log('No successful prebook');
    process.exit(2);
  }

  writeFileSync(
    'scripts/_tmp_hotel_prebook_cancel.json',
    JSON.stringify(success, null, 2)
  );

  console.log('\n========== SUMMARY ==========');
  console.log(
    JSON.stringify(
      {
        hotel: success.hotel,
        roomName: success.room.name,
        checkin: success.checkin,
        checkout: success.checkout,
        detailsCancel: success.detailsCancel,
        prebookTopKeys: success.prebookTopKeys,
        prebookCancelRelatedPaths: success.prebookCancelRelatedPaths,
        hasCancelPoliciesInPrebook: success.prebookCancelRelatedPaths.some((p) =>
          /cancelPolicies/i.test(p.path)
        ),
        hasRefundableInPrebook: success.prebookCancelRelatedPaths.some((p) =>
          /refundable/i.test(p.path)
        ),
      },
      null,
      2
    )
  );

  console.log('\n========== PREBOOK BODY (trunc) ==========');
  console.log(JSON.stringify(success.prebookData, null, 2).slice(0, 8000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

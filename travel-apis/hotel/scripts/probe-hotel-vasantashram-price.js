/**
 * Price New Vasantashram Boarding & Lodging (Mumbai) — details + prebook breakup
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-hotel-vasantashram-price.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { extractRequestId, extractBookingContext } from '../src/helpers.js';
import { futureDate } from '../../../shared/lib/testUtils.js';

const OUT = path.join('reports', 'hotel-vasantashram-mumbai-price-canary.json');

function acList(data) {
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.predictions)) return data.predictions;
  if (Array.isArray(data)) return data;
  return [];
}

function itemId(item) {
  const raw = item.entityId || item.id || item.hotelId || item.destinationId || '';
  return String(raw).split(':')[0];
}

function itemName(item) {
  return item.name || item.hotelName || item.displayName || item.label || '';
}

async function main() {
  clearSession();
  console.log('Vasantashram Mumbai price on', config.baseUrl);
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  const queries = [
    'New Vasantashram Boarding & Lodging',
    'New Vasantashram Boarding',
    'Vasantashram Boarding',
    'Vasantashram',
  ];

  let entityId = null;
  let matched = null;

  for (const q of queries) {
    const ac = await hotel.autocomplete(q, 1, 20);
    const arr = acList(ac.data);
    console.log('autocomplete', JSON.stringify(q), 'count', arr.length);
    for (const item of arr) {
      const name = itemName(item);
      const id = itemId(item);
      const city = item.city || item.cityName || '';
      console.log(' ', id, name || '(no name)', city, item.type || item.entityType || '');
      if (/vasantashram/i.test(name)) {
        entityId = id;
        matched = item;
        break;
      }
      // autocomplete sometimes returns only id for exact hotel hit
      if (!name && id && /boarding|vasanta/i.test(q)) {
        entityId = id;
        matched = item;
      }
    }
    if (entityId && matched && /vasantashram/i.test(itemName(matched))) break;
  }

  if (!entityId) {
    throw new Error('Could not resolve entityId for New Vasantashram Boarding & Lodging');
  }
  console.log('\nUsing entityId', entityId, itemName(matched) || '');

  let result = null;
  for (const days of [14, 21, 28, 35, 45, 60]) {
    const searchBody = {
      checkin: futureDate(days),
      checkout: futureDate(days + 1),
      entityId: String(entityId),
      nationality: 'IN',
      type: 'HOTEL',
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    };
    console.log('\n===', searchBody.checkin, '→', searchBody.checkout);
    const search = await hotel.search(searchBody);
    if (!search.ok) {
      console.log(' search fail', search.status, search.data?.error?.code);
      continue;
    }
    const details = await hotel.getDetails(searchBody);
    if (!details.ok) {
      console.log(' details fail', details.status);
      continue;
    }
    const requestId = extractRequestId(details.data) || extractRequestId(search.data);
    const hotelBlock = details.data?.results?.[0];
    const rooms = (hotelBlock?.rooms || []).filter((r) => r.bookingCode && r.available !== false);
    console.log(' hotel', hotelBlock?.name, 'rooms', rooms.length);
    if (!rooms.length) continue;

    rooms.sort((a, b) => Number(a.price?.totalAmount || 1e12) - Number(b.price?.totalAmount || 1e12));
    const room = rooms[0];
    const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    const preOk = Boolean(prebook.ok && extractBookingContext(prebook.data));
    const preHotel = preOk ? prebook.data?.results?.[0] : null;
    const preRoom = preHotel
      ? ((preHotel.rooms || []).find((r) => r.bookingCode === room.bookingCode) || preHotel.rooms?.[0])
      : null;

    result = {
      ranAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      hotel: hotelBlock?.name || 'New Vasantashram Boarding & Lodging',
      entityId: String(entityId),
      address: hotelBlock?.address || null,
      city: hotelBlock?.city || null,
      country: hotelBlock?.country || null,
      checkin: searchBody.checkin,
      checkout: searchBody.checkout,
      requestId,
      roomsAvailable: rooms.length,
      detailsBreakup: {
        baseFare: room.price?.baseFare,
        taxes: room.price?.taxes,
        convenienceFee: room.price?.convenienceFee,
        gstAmount: room.price?.gstAmount,
        totalAmount: room.price?.totalAmount,
        currency: room.price?.currency,
      },
      prebookBreakup: preRoom ? {
        baseFare: preRoom.price?.baseFare,
        taxes: preRoom.price?.taxes,
        convenienceFee: preRoom.price?.convenienceFee,
        gstAmount: preRoom.price?.gstAmount,
        totalAmount: preRoom.price?.totalAmount,
        currency: preRoom.price?.currency,
      } : null,
      room: {
        title: room.title || room.name?.[0] || room.name,
        mealType: room.mealType,
        isPANMandatory: room.isPANMandatory,
        isGSTClaimable: room.isGSTClaimable,
        bookingCode: room.bookingCode,
      },
      allRooms: rooms.map((r) => ({
        title: r.title || r.name?.[0] || r.name,
        mealType: r.mealType,
        baseFare: r.price?.baseFare,
        taxes: r.price?.taxes,
        convenienceFee: r.price?.convenienceFee,
        totalAmount: r.price?.totalAmount,
        currency: r.price?.currency,
        isPANMandatory: r.isPANMandatory,
        isGSTClaimable: r.isGSTClaimable,
      })),
      match: preRoom ? room.price?.totalAmount === preRoom.price?.totalAmount : null,
      prebookOk: preOk,
    };
    break;
  }

  if (!result) throw new Error(`entity ${entityId} found but no bookable rooms on tried dates`);

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log('\n' + JSON.stringify({
    hotel: result.hotel,
    entityId: result.entityId,
    city: result.city,
    address: result.address,
    checkin: result.checkin,
    checkout: result.checkout,
    room: result.room.title,
    mealType: result.room.mealType,
    detailsBreakup: result.detailsBreakup,
    prebookBreakup: result.prebookBreakup,
    match: result.match,
    allRooms: result.allRooms,
  }, null, 2));
  console.log('\nReport', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
clearSession();
const { client } = await authenticate(true);
const hotel = new HotelService(client);

const searchBody = buildSearchBody({
  entityId: '39627872',
  checkinDays: 28,
  nights: 1,
  rooms: [{ adults: 1, children: 0, childrenAges: [] }],
});
searchBody.type = 'HOTEL';
const search = await hotel.search(searchBody);
const details = await hotel.getDetails(searchBody);
const requestId = extractRequestId(details.data) || extractRequestId(search.data);
const hotelObj = details.data?.results?.[0];
const room = (hotelObj?.rooms || [])
  .filter((r) => r.available !== false && r.bookingCode)
  .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12))[0];
const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
if (!isPrebookSuccess(pre)) {
  console.error('prebook fail', JSON.stringify(pre.data).slice(0, 400));
  process.exit(1);
}

const payload = {
  bookingContext: extractBookingContext(pre.data),
  bookingCode: room.bookingCode,
  requestId,
  checkin: searchBody.checkin,
  checkout: searchBody.checkout,
  rooms: [{
    guests: [{
      title: 'Mr',
      firstName: 'Rohan',
      lastName: 'Bhagat',
      type: 'Adult',
      isLead: true,
    }],
  }],
  contact: {
    email: `hotel.staging.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: config.hotel.contactMobile,
    panCardNumber: 'EUIPB1672M',
    panCardName: 'Rohan Bhagat',
  },
};
if (room.isGSTClaimable || room.isGstClaimable) {
  payload.gstDetails = {
    gstNumber: '27AABCT1429B1Z1',
    gstCompanyName: 'TravelVIP Technologies Pvt Ltd',
    gstAddress: 'Office No 401, Tower B, Business Bay, Pune, Maharashtra 411014',
    gstEmailID: 'accounts@travelvip.ai',
    gstMobileNumber: '9921862715',
  };
}

const out = {
  method: 'POST',
  url: `${config.baseUrl}/v1/hotels/finalize-booking?lang=en&currency=INR&page=0&perpage=20`,
  priorBooking: {
    br: 'BR1786958209326832',
    note: 'That BR was already booked+cancelled. bookingContext/bookingCode below are a fresh prebook for the same hotel/dates pattern.',
  },
  hotel: hotelObj?.name,
  amount: room.price?.totalAmount,
  gstClaimable: Boolean(room.isGSTClaimable || room.isGstClaimable),
  body: payload,
};
fs.writeFileSync('reports/hotel-finalize-payload-staging.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

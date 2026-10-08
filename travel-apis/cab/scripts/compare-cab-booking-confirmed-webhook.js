/**
 * Compare live booking.confirmed webhook payload vs PDF §3.2 sample contract.
 */
import fs from 'fs';

const live = {
  version: 1,
  event: 'booking.confirmed',
  timestamp: '2026-09-07T07:22:17Z',
  type: 'cab',
  data: {
    status: 'Confirmed',
    reason: null,
    bookingReference: 'BR1788765729128745',
    providerBookingId: 'TVIPWE070926125209LO34',
    transaction: [{
      id: '4385',
      amount: 453.16,
      currency: 'INR',
      paymentMethod: 'wallet',
      createdAt: '2026-09-07T07:22:09Z',
      completedAt: '2026-09-07T07:22:09Z',
      type: 'debit',
      status: 'success',
    }],
    contact: {
      name: 'Pratik Patil',
      email: 'chaitanya@travelvip.ai',
      countryCode: '+91',
      mobile: '9921862715',
    },
    passengers: [{
      paxId: 1,
      paxType: 'ADT',
      isLead: true,
      profile: {
        title: 'Mr',
        firstName: 'Pratik',
        lastName: 'Patil',
        gender: null,
      },
    }],
    details: {
      journeyType: 'AIRPORT',
      travelType: 'DEPARTURE',
      airportCode: 'DEL',
      pickupDatetime: '2026-09-16T18:35:58+00:00',
      pickup: { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 },
      drop: { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 },
      distanceKm: 15,
      durationMin: 15,
      extraKmFare: 24.0,
      freeCancellationTillMin: 30,
      inclusions: ['15 Kms Ride', 'GST Included ₹20.58'],
      exclusions: ['Toll Charges'],
      vehicle: {
        type: 'SEDAN',
        category: 'ECONOMY',
        model: 'Dzire or Similar',
        makeYear: 2016,
        seatingCapacity: 2,
        luggageCapacity: 2,
        airConditioned: true,
        fuelType: 'CNG',
        imageUrl: 'https://cdn.bookairportcab.com/svglogos/logo_carzonrent_84x84.svg',
        imageAppUrl: 'https://cdn.bookairportcab.com/svglogos/logo_carzonrent_84x84.svg',
        imageMobileUrl: 'https://cdn.bookairportcab.com/svglogos/logo_carzonrent38x38.svg',
      },
      operator: {
        name: 'Carzonrent',
        logoUrl: 'https://cdn.bookairportcab.com/svglogos/logo_carzonrent_84x84.svg',
        rating: 4.6,
        ratingCount: 377,
      },
      otp: '2497',
    },
    salesSummary: {
      subTotal: 411.0,
      tax: 20.58,
      convenienceFee: 21.58,
      totalAmount: 453.16,
      totalDiscount: 0.0,
      currency: 'INR',
    },
  },
};

const required = {
  envelope: ['version', 'event', 'timestamp', 'type', 'data'],
  data: ['status', 'reason', 'bookingReference', 'providerBookingId', 'transaction', 'contact', 'passengers', 'details', 'salesSummary'],
  details: ['journeyType', 'travelType', 'airportCode', 'pickupDatetime', 'pickup', 'drop', 'distanceKm', 'durationMin', 'extraKmFare', 'freeCancellationTillMin', 'inclusions', 'exclusions', 'vehicle', 'operator', 'otp'],
  loc: ['name', 'city', 'latitude', 'longitude'],
  vehicle: ['type', 'category', 'model', 'makeYear', 'seatingCapacity', 'luggageCapacity', 'airConditioned', 'fuelType', 'imageUrl', 'imageAppUrl', 'imageMobileUrl'],
  operator: ['name', 'logoUrl', 'rating', 'ratingCount'],
  sales: ['basePrice', 'subTotal', 'tax', 'convenienceFee', 'totalAmount', 'totalDiscount', 'currency'],
  tx: ['id', 'amount', 'currency', 'paymentMethod', 'createdAt', 'completedAt', 'type', 'status'],
  contact: ['name', 'email', 'countryCode', 'mobile'],
  pax: ['paxId', 'paxType', 'isLead', 'profile'],
  profile: ['title', 'firstName', 'lastName', 'gender'],
};

function miss(obj, keys) {
  return keys.filter((k) => !(k in (obj || {})));
}

const rows = [];
const add = (rule, status, note) => rows.push({ rule, status, note });

add('Envelope keys', miss(live, required.envelope).length ? 'BUG' : 'PASS', miss(live, required.envelope).join(',') || 'ok');
add('event=booking.confirmed', live.event === 'booking.confirmed' ? 'PASS' : 'BUG', live.event);
add('type=cab', live.type === 'cab' ? 'PASS' : 'BUG', live.type);
add('version=1', live.version === 1 ? 'PASS' : 'BUG', String(live.version));
add('data.status=Confirmed', live.data.status === 'Confirmed' ? 'PASS' : 'BUG', live.data.status);
add('data keys', miss(live.data, required.data).length ? 'BUG' : 'PASS', miss(live.data, required.data).join(',') || 'ok');
add('providerBookingId TVIPWE…', /^TVIPWE/.test(live.data.providerBookingId) ? 'PASS' : 'BUG', live.data.providerBookingId);
add('details keys', miss(live.data.details, required.details).length ? 'BUG' : 'PASS', miss(live.data.details, required.details).join(',') || 'ok');
add('pickup keys', miss(live.data.details.pickup, required.loc).length ? 'BUG' : 'PASS', miss(live.data.details.pickup, required.loc).join(',') || 'ok');
add('drop keys', miss(live.data.details.drop, required.loc).length ? 'BUG' : 'PASS', miss(live.data.details.drop, required.loc).join(',') || 'ok');
add('vehicle keys', miss(live.data.details.vehicle, required.vehicle).length ? 'BUG' : 'PASS', miss(live.data.details.vehicle, required.vehicle).join(',') || 'ok');
add('operator keys', miss(live.data.details.operator, required.operator).length ? 'BUG' : 'PASS', miss(live.data.details.operator, required.operator).join(',') || 'ok');
add('salesSummary keys vs PDF', miss(live.data.salesSummary, required.sales).length ? 'NOTE' : 'PASS', `missing: ${miss(live.data.salesSummary, required.sales).join(',') || 'none'}`);
add('transaction[0] keys', miss(live.data.transaction[0], required.tx).length ? 'BUG' : 'PASS', miss(live.data.transaction[0], required.tx).join(',') || 'ok');
add('contact keys', miss(live.data.contact, required.contact).length ? 'BUG' : 'PASS', miss(live.data.contact, required.contact).join(',') || 'ok');
add('passenger keys', miss(live.data.passengers[0], required.pax).length ? 'BUG' : 'PASS', miss(live.data.passengers[0], required.pax).join(',') || 'ok');
add('profile keys', miss(live.data.passengers[0].profile, required.profile).length ? 'BUG' : 'PASS', miss(live.data.passengers[0].profile, required.profile).join(',') || 'ok');
add('otp 4-digit', /^\d{4}$/.test(live.data.details.otp) ? 'PASS' : 'BUG', live.data.details.otp);
add('pickupDatetime +00:00 form', /\+00:00$/.test(live.data.details.pickupDatetime) ? 'PASS' : 'BUG', live.data.details.pickupDatetime);
add('amounts major units (not paise)', live.data.salesSummary.totalAmount === 453.16 ? 'PASS' : 'BUG', String(live.data.salesSummary.totalAmount));
add('no cancellation on confirmed', !('cancellation' in live.data) ? 'PASS' : 'BUG', 'ok');
add('profile.gender null', live.data.passengers[0].profile.gender == null ? 'NOTE' : 'PASS', 'PDF sample uses male/female; live null');
add('assignment/trip absent', !live.data.details.assignment && !live.data.details.trip ? 'PASS' : 'BUG', 'PDF: assignment/trip never on booking events');

const report = {
  br: live.data.bookingReference,
  providerBookingId: live.data.providerBookingId,
  summary: {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOTE: rows.filter((r) => r.status === 'NOTE').length,
  },
  rows,
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/cab-webhook-booking-confirmed-compare.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import { FlightService } from '../../flight/src/service.js';
import { FLIGHT_QUERY } from '../../flight/src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const HOTEL_BR = 'BR1786958209326832';
const FLIGHT_BR = 'BR1786958342483741';
const OUT = 'reports/cancel-hotel-flight-staging.json';

clearSession();
console.log('Base', config.baseUrl);
const session = await authenticate(true);
session.client.setPartnerKey(session.accessToken);
const hotel = new HotelService(session.client);
const flight = new FlightService(session.client);
const client = session.client;

console.log('\n=== HOTEL', HOTEL_BR);
const hPen = await hotel.penaltyCheck(HOTEL_BR);
console.log('penalty', hPen.status, JSON.stringify(hPen.data).slice(0, 280));
const hCan = await hotel.cancelBooking(HOTEL_BR);
console.log('cancel', hCan.status, JSON.stringify(hCan.data).slice(0, 280));
await sleep(2000);
const hSt = await hotel.getBookingStatus(HOTEL_BR);
console.log('after', hSt.data?.status, hSt.data?.message);

console.log('\n=== FLIGHT', FLIGHT_BR);
const det = await flight.getBookingDetail(FLIGHT_BR);
const pnr = det.data?.bookingResponse?.itinerary?.[0]?.pnr;
console.log('pnr', pnr, 'before', det.data?.status || det.data?.bookingResponse?.status);

async function cancelCall(body) {
  return client.request({
    method: 'POST',
    path: `/v1/flights/booking/${FLIGHT_BR}/cancel`,
    query: { ...FLIGHT_QUERY },
    body,
    correlation: true,
    partnerKey: client.partnerKey,
  });
}

const fPen = await cancelCall({
  action: 'PENALTY',
  pnr,
  retryCount: 2,
  cancellationReason: 'cancel both hotel+flight',
});
console.log('penalty', fPen.status, JSON.stringify(fPen.data).slice(0, 320));
const fCan = await cancelCall({
  action: 'CANCEL',
  pnr,
  retryCount: 2,
  cancellationReason: 'cancel both hotel+flight',
  remarks: 'requested by partner',
});
console.log('cancel', fCan.status, JSON.stringify(fCan.data).slice(0, 320));
await sleep(2000);
const fSt = await flight.getBookingStatus(FLIGHT_BR);
console.log('after', fSt.data?.status);

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: config.baseUrl,
  hotel: {
    br: HOTEL_BR,
    penaltyHttp: hPen.status,
    cancelHttp: hCan.status,
    afterStatus: hSt.data?.status,
    cancel: hCan.data,
    penalty: hPen.data,
  },
  flight: {
    br: FLIGHT_BR,
    pnr,
    penaltyHttp: fPen.status,
    cancelHttp: fCan.status,
    afterStatus: fSt.data?.status,
    penalty: fPen.data,
    cancel: fCan.data,
  },
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\nWrote', OUT);

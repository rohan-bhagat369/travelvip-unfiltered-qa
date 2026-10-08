/**
 * Mirror Postman-style POST cancel: try with/without signature & query variants.
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
  futurePickupDatetime,
  CAB_QUERY,
} from '../src/helpers.js';

clearSession();
process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const { client } = await authenticate(true);
const cab = new CabService(client);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bookOne() {
  const search = await cab.search(buildAirportSearchBody(futurePickupDatetime(20)));
  const selected = pickCab(search.data?.cabs);
  if (!selected) throw new Error('no cab');
  const fare = await cab.fare(selected.searchId);
  const book = await cab.finalizeBooking(
    buildFinalizeBody({
      bookingReference: fare.data.bookingReference,
      priceId: fare.data.priceId,
    }),
  );
  const br = book.data?.bookingRefId || book.data?.bookingReferenceId;
  let st = await cab.getBookingStatus(br);
  for (let i = 0; i < 14 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
    await sleep(2000);
    st = await cab.getBookingStatus(br);
  }
  return { br, status: st.data?.status, providerBookingId: st.data?.providerBookingId };
}

const booked = await bookOne();
console.log('BOOKED', booked);

const attempts = [];

async function tryCancel(label, opts) {
  const res = await client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${booked.br}/cancel`,
    ...opts,
  });
  const st = await cab.getBookingStatus(booked.br);
  const row = {
    label,
    http: res.status,
    code: res.data?.error?.code,
    message: res.data?.error?.message,
    result: res.data?.error?.result,
    statusAfter: st.data?.status,
    data: res.data,
  };
  attempts.push(row);
  console.log(label, row.http, row.code, row.statusAfter);
  return row;
}

// Attempt 1: match our probe (signed + query + USER)
await tryCancel('signed+query+USER', {
  query: CAB_QUERY,
  correlation: true,
  partnerKey: client.partnerKey,
  signed: true,
  body: { cancelledBy: 'USER', cancellationReason: 'Postman parity retest' },
});

// If still confirmed, try unsigned (closer to many Postman setups)
if (attempts.at(-1).statusAfter === 'Confirmed') {
  await tryCancel('unsigned+query+USER', {
    query: CAB_QUERY,
    correlation: true,
    partnerKey: client.partnerKey,
    signed: false,
    body: { cancelledBy: 'USER', cancellationReason: 'Postman parity retest' },
  });
}

if (attempts.at(-1).statusAfter === 'Confirmed') {
  await tryCancel('unsigned+noQuery+USER', {
    correlation: true,
    partnerKey: client.partnerKey,
    signed: false,
    body: { cancelledBy: 'USER', cancellationReason: 'Postman parity retest' },
  });
}

if (attempts.at(-1).statusAfter === 'Confirmed') {
  await tryCancel('unsigned+query+ADMIN', {
    query: CAB_QUERY,
    correlation: true,
    partnerKey: client.partnerKey,
    signed: false,
    body: { cancelledBy: 'ADMIN', cancellationReason: 'Postman parity retest admin' },
  });
}

if (attempts.at(-1).statusAfter === 'Confirmed') {
  await tryCancel('signed+query+USER+remarks', {
    query: CAB_QUERY,
    correlation: true,
    partnerKey: client.partnerKey,
    signed: true,
    body: {
      cancelledBy: 'USER',
      cancellationReason: 'Postman parity',
      remarks: 'Postman parity',
    },
  });
}

const report = {
  ranAt: new Date().toISOString(),
  booked,
  attempts,
  pass: attempts.some((a) => /cancel/i.test(String(a.statusAfter || ''))),
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/cab-cancel-postman-parity.json', JSON.stringify(report, null, 2));
console.log('PASS?', report.pass);

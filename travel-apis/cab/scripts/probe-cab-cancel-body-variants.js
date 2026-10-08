/**
 * Isolate whether POST cancel needs `remarks` vs only cancellationReason.
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

async function book(days) {
  const search = await cab.search(buildAirportSearchBody(futurePickupDatetime(days)));
  const selected = pickCab(search.data?.cabs);
  if (!selected) return { ok: false, search: search.data };
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
  return {
    ok: /confirm/i.test(String(st.data?.status || '')),
    br,
    status: st.data?.status,
  };
}

async function cancel(br, body) {
  const res = await client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: CAB_QUERY,
    correlation: true,
    partnerKey: client.partnerKey,
    signed: true,
    body,
  });
  const st = await cab.getBookingStatus(br);
  return {
    http: res.status,
    code: res.data?.error?.code,
    message: res.data?.error?.message,
    statusAfter: st.data?.status,
    data: res.data,
  };
}

const rows = [];

// Case 1: only cancellationReason (what we used before)
{
  const b = await book(21);
  console.log('C1 book', b.br, b.status);
  const c = await cancel(b.br, {
    cancelledBy: 'USER',
    cancellationReason: 'Plans changed',
  });
  rows.push({
    id: 'C1_reason_only',
    body: { cancelledBy: 'USER', cancellationReason: 'Plans changed' },
    booked: b,
    cancel: c,
    status: c.http === 200 || /cancel/i.test(c.statusAfter) ? 'PASS' : 'BUG',
  });
  console.log('C1', c.http, c.code, c.statusAfter);
}

// Case 2: only remarks
{
  const b = await book(22);
  console.log('C2 book', b.br, b.status);
  const c = await cancel(b.br, {
    cancelledBy: 'USER',
    remarks: 'Plans changed',
  });
  rows.push({
    id: 'C2_remarks_only',
    body: { cancelledBy: 'USER', remarks: 'Plans changed' },
    booked: b,
    cancel: c,
    status: c.http === 200 || /cancel/i.test(c.statusAfter) ? 'PASS' : 'BUG',
  });
  console.log('C2', c.http, c.code, c.statusAfter);
}

// Case 3: both (Postman-like)
{
  const b = await book(23);
  console.log('C3 book', b.br, b.status);
  const c = await cancel(b.br, {
    cancelledBy: 'USER',
    cancellationReason: 'Plans changed',
    remarks: 'Plans changed',
  });
  rows.push({
    id: 'C3_reason_and_remarks',
    body: {
      cancelledBy: 'USER',
      cancellationReason: 'Plans changed',
      remarks: 'Plans changed',
    },
    booked: b,
    cancel: c,
    status: c.http === 200 || /cancel/i.test(c.statusAfter) ? 'PASS' : 'BUG',
  });
  console.log('C3', c.http, c.code, c.statusAfter);
}

// Case 4: cancelledBy only
{
  const b = await book(24);
  console.log('C4 book', b.br, b.status);
  const c = await cancel(b.br, { cancelledBy: 'USER' });
  rows.push({
    id: 'C4_cancelledBy_only',
    body: { cancelledBy: 'USER' },
    booked: b,
    cancel: c,
    status: c.http === 200 || /cancel/i.test(c.statusAfter) ? 'PASS' : 'BUG',
  });
  console.log('C4', c.http, c.code, c.statusAfter);
}

const summary = {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
};
const report = { ranAt: new Date().toISOString(), summary, rows };
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/cab-cancel-body-variants.json', JSON.stringify(report, null, 2));
console.log('SUMMARY', summary);
for (const r of rows) console.log(r.id, r.status, r.cancel.http, r.cancel.code || r.cancel.statusAfter);

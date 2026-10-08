/**
 * Quick POST cancel retest on api-staging.
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-cancel-post-retest.js
 */
import fs from 'fs';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildOutstationSearchBody,
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

async function book(searchBody) {
  const search = await cab.search(searchBody);
  const selected = pickCab(search.data?.cabs);
  if (!selected) return { ok: false, stage: 'search', data: search.data };
  const fare = await cab.fare(selected.searchId);
  const bookRes = await cab.finalizeBooking(
    buildFinalizeBody({
      bookingReference: fare.data.bookingReference,
      priceId: fare.data.priceId,
    }),
  );
  const br = bookRes.data?.bookingRefId || bookRes.data?.bookingReferenceId;
  let st = await cab.getBookingStatus(br);
  for (let i = 0; i < 14 && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
    await sleep(2000);
    st = await cab.getBookingStatus(br);
  }
  return {
    ok: /confirm/i.test(String(st.data?.status || '')),
    br,
    status: st.data?.status,
    pickup: st.data?.details?.pickupDatetime,
    freeCancellationTillMin: st.data?.details?.freeCancellationTillMin,
    progress: st.data?.details?.progress,
    providerBookingId: st.data?.providerBookingId,
  };
}

async function postCancel(br, body) {
  const res = await client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: CAB_QUERY,
    correlation: true,
    partnerKey: client.partnerKey,
    body,
  });
  const st = await cab.getBookingStatus(br);
  return {
    http: res.status,
    ok: res.ok,
    code: res.data?.error?.code,
    message: res.data?.error?.message,
    result: res.data?.error?.result || res.data?.result,
    data: res.data,
    statusAfter: st.data?.status,
  };
}

const rows = [];

// 1) AIRPORT + USER
{
  const b = await book(buildAirportSearchBody(futurePickupDatetime(17)));
  console.log('AIRPORT book', b.br, b.status);
  if (b.ok) {
    const c = await postCancel(b.br, {
      cancelledBy: 'USER',
      cancellationReason: 'Retest POST cancel',
    });
    rows.push({ id: 'AIR-USER', booked: b, cancel: c, status: c.ok || /cancel/i.test(c.statusAfter) ? 'PASS' : 'BUG' });
    console.log('AIR-USER', c.http, c.code, c.statusAfter);
  } else rows.push({ id: 'AIR-USER', status: 'NOT TESTED', booked: b });
}

// 2) OUTSTATION + USER
{
  const b = await book(buildOutstationSearchBody(futurePickupDatetime(18)));
  console.log('OUT book', b.br, b.status);
  if (b.ok) {
    const c = await postCancel(b.br, {
      cancelledBy: 'USER',
      cancellationReason: 'Retest POST cancel outstation',
    });
    rows.push({ id: 'OUT-USER', booked: b, cancel: c, status: c.ok || /cancel/i.test(c.statusAfter) ? 'PASS' : 'BUG' });
    console.log('OUT-USER', c.http, c.code, c.statusAfter);
  } else rows.push({ id: 'OUT-USER', status: 'NOT TESTED', booked: b });
}

// 3) AIRPORT + ADMIN (fresh book)
{
  const b = await book(buildAirportSearchBody(futurePickupDatetime(19)));
  console.log('AIRPORT admin book', b.br, b.status);
  if (b.ok) {
    const c = await postCancel(b.br, {
      cancelledBy: 'ADMIN',
      cancellationReason: 'Retest POST cancel admin',
    });
    rows.push({ id: 'AIR-ADMIN', booked: b, cancel: c, status: c.ok || /cancel/i.test(c.statusAfter) ? 'PASS' : 'BUG' });
    console.log('AIR-ADMIN', c.http, c.code, c.statusAfter);
  } else rows.push({ id: 'AIR-ADMIN', status: 'NOT TESTED', booked: b });
}

const summary = {
  PASS: rows.filter((r) => r.status === 'PASS').length,
  BUG: rows.filter((r) => r.status === 'BUG').length,
  'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
};
const report = { ranAt: new Date().toISOString(), baseUrl: process.env.BASE_URL, summary, rows };
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/cab-cancel-post-retest.json', JSON.stringify(report, null, 2));
console.log('SUMMARY', summary);

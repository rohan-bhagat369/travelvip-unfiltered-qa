/**
 * Cab finalize otherDetails variants + post-book status/details check.
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-cab-otherdetails-status.js
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

const BASE = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const OUT = 'reports/cab-otherdetails-status.json';
const SETTLE_MS = Number(process.env.CANCEL_SETTLE_MS || 6000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

clearSession();
process.env.BASE_URL = BASE;
const { client } = await authenticate(true);
const cab = new CabService(client);

async function freshFare() {
  const search = await cab.search(buildAirportSearchBody(futurePickupDatetime(11)));
  const c0 = pickCab(search.data?.cabs || []);
  if (!c0?.searchId) return null;
  const fare = await cab.fare(c0.searchId);
  if (!fare.ok || !fare.data?.bookingReference || !fare.data?.priceId) return null;
  return { bookingReference: fare.data.bookingReference, priceId: fare.data.priceId };
}

async function pollStatus(br, attempts = 12) {
  let st = await cab.getBookingStatus(br);
  for (let i = 0; i < attempts && !/confirm|fail|cancel/i.test(String(st.data?.status || '')); i++) {
    await sleep(2000);
    st = await cab.getBookingStatus(br);
  }
  return st;
}

async function cancel(br) {
  await sleep(SETTLE_MS);
  return client.request({
    method: 'POST',
    path: `/v1/airportServices/cabs/bookings/${br}/cancel`,
    query: CAB_QUERY,
    partnerKey: client.partnerKey,
    body: { cancelledBy: 'USER', cancellationReason: 'otherDetails status probe cleanup' },
  });
}

function findOtherDetailsEcho(data) {
  if (!data || typeof data !== 'object') return { present: false, value: null, path: null };
  const raw = JSON.stringify(data);
  if (!/otherDetails/i.test(raw) && !/"remarks"/i.test(raw)) {
    return { present: false, value: null, path: null };
  }
  if (data.otherDetails != null) return { present: true, value: data.otherDetails, path: 'otherDetails' };
  if (data.details?.otherDetails != null) {
    return { present: true, value: data.details.otherDetails, path: 'details.otherDetails' };
  }
  if (data.remarks != null) return { present: true, value: data.remarks, path: 'remarks' };
  if (data.details?.remarks != null) {
    return { present: true, value: data.details.remarks, path: 'details.remarks' };
  }
  return { present: /otherDetails/i.test(raw), value: null, path: 'embedded' };
}

const cases = [
  { id: 'OD.omit', label: 'omit otherDetails', mutate: (b) => { delete b.otherDetails; } },
  { id: 'OD.empty', label: 'otherDetails empty string', mutate: (b) => { b.otherDetails = ''; } },
  { id: 'OD.null', label: 'otherDetails null', mutate: (b) => { b.otherDetails = null; } },
  {
    id: 'OD.valid',
    label: 'otherDetails normal text',
    mutate: (b) => {
      b.otherDetails = 'QA test booking — please cancel';
    },
  },
  {
    id: 'OD.html',
    label: 'otherDetails HTML script',
    mutate: (b) => {
      b.otherDetails = '<script>alert(1)</script>';
    },
  },
  {
    id: 'OD.comma',
    label: 'otherDetails trailing comma text',
    mutate: (b) => {
      b.otherDetails = 'note,';
    },
  },
  {
    id: 'OD.punct',
    label: 'otherDetails punctuation only',
    mutate: (b) => {
      b.otherDetails = '!@#$%';
    },
  },
  {
    id: 'OD.long',
    label: 'otherDetails 600 chars',
    mutate: (b) => {
      b.otherDetails = 'x'.repeat(600);
    },
  },
  {
    id: 'OD.sql',
    label: 'otherDetails SQL-ish',
    mutate: (b) => {
      b.otherDetails = "'; DROP TABLE bookings; --";
    },
  },
];

const rows = [];

for (const c of cases) {
  const fare = await freshFare();
  if (!fare) {
    rows.push({ id: c.id, label: c.label, result: 'NOT TESTED', actual: 'no fare' });
    console.log('NOT TESTED', c.id);
    continue;
  }

  const body = buildFinalizeBody(fare);
  c.mutate(body);
  const sent = Object.prototype.hasOwnProperty.call(body, 'otherDetails')
    ? body.otherDetails
    : '(omitted)';

  const book = await cab.finalizeBooking(body);
  const br = book.data?.bookingRefId || null;
  const row = {
    id: c.id,
    label: c.label,
    otherDetailsSent: sent,
    finalizeHttp: book.status,
    finalizeCode: book.data?.error?.code || null,
    finalizeMessage: book.data?.error?.message || null,
    finalizeBodyStatus: book.data?.status || null,
    br,
  };

  if (br && book.status === 200) {
    const st = await pollStatus(br);
    row.statusHttp = st.status;
    row.bookingStatus = st.data?.status || null;
    row.statusEcho = findOtherDetailsEcho(st.data);

    const det = await client.request({
      method: 'GET',
      path: `/v1/airportServices/cabs/booking/${br}`,
      query: CAB_QUERY,
      correlation: true,
    });
    row.detailsHttp = det.status;
    row.detailsStatus = det.data?.status || null;
    row.detailsEcho = findOtherDetailsEcho(det.data);

    const cancelRes = await cancel(br);
    await sleep(1500);
    const after = await pollStatus(br, 6);
    row.cancelHttp = cancelRes.status;
    row.cancelCode = cancelRes.data?.error?.code || null;
    row.statusAfterCancel = after.data?.status || null;
  }

  if (book.status >= 500) row.result = 'BUG';
  else if (br) row.result = 'BOOKED';
  else if (book.status >= 400) row.result = 'REJECTED';
  else row.result = 'RECORDED';

  rows.push(row);
  console.log(
    row.result,
    c.id,
    `finalize=${book.status}`,
    `br=${br || '-'}`,
    `status=${row.bookingStatus || '-'}`,
    `details=${row.detailsStatus || '-'}`,
    `echo=${row.detailsEcho?.present ? row.detailsEcho.path : 'none'}`,
    `afterCancel=${row.statusAfterCancel || '-'}`,
  );
}

const report = {
  ranAt: new Date().toISOString(),
  baseUrl: BASE,
  summary: {
    BOOKED: rows.filter((r) => r.result === 'BOOKED').length,
    REJECTED: rows.filter((r) => r.result === 'REJECTED').length,
    BUG: rows.filter((r) => r.result === 'BUG').length,
    'NOT TESTED': rows.filter((r) => r.result === 'NOT TESTED').length,
  },
  rows,
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n=== SUMMARY ===', report.summary);
console.log('Wrote', OUT);
process.exit(report.summary.BUG ? 1 : 0);

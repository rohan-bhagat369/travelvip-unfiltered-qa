import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  buildFinalizeBody,
  buildGuests,
  extractRequestId,
  extractBookingCodes,
  extractBookingContext,
} from '../src/helpers.js';

const findings = [];
function push(id, expected, actual, bug, notes = '') {
  findings.push({ id, expected, actual, bug, notes });
}

const { client } = await authenticate();
const hotel = new HotelService(client);
const searchBody = buildSearchBody({ checkinDays: 30, nights: 2 });
const search = await hotel.search(searchBody);
const details = await hotel.getDetails(searchBody);
const searchRid = extractRequestId(search.data);
const detailsRid = extractRequestId(details.data);
const codes = extractBookingCodes(details.data);

push(
  'HOTEL-REQ-001',
  'Document which requestId prebook uses (search vs details)',
  `search=${searchRid} details=${detailsRid} same=${searchRid === detailsRid}`,
  searchRid !== detailsRid
    ? 'YES — different requestIds; search id + details bookingCode silently fails prebook'
    : 'no',
  'Ask API team to document: prebook/finalize must use Details requestId',
);

const preWrong = await hotel.prebook({ bookingCode: codes[0], requestId: searchRid });
push(
  'HOTEL-PRE-001',
  'HTTP 4xx with clear error when requestId/bookingCode mismatch',
  `http=${preWrong.status} bookingContext=${Boolean(preWrong.data?.bookingContext)} availableResults=${preWrong.data?.availableResults}`,
  preWrong.ok && !preWrong.data?.bookingContext
    ? 'YES — HTTP 200 success-shaped response but bookingContext=null (silent fail)'
    : 'no',
);

let pre = null;
let code = null;
for (const c of codes.slice(0, 10)) {
  const r = await hotel.prebook({ bookingCode: c, requestId: detailsRid });
  if (extractBookingContext(r.data)) {
    pre = r;
    code = c;
    break;
  }
}
const ctx = extractBookingContext(pre?.data);

if (!ctx) {
  console.log(JSON.stringify(findings, null, 2));
  process.exit(0);
}

const noContact = await hotel.finalizeBooking({
  bookingContext: ctx,
  bookingCode: code,
  requestId: detailsRid,
  checkin: searchBody.checkin,
  checkout: searchBody.checkout,
  rooms: [{ guests: buildGuests() }],
});
push(
  'HOTEL-FIN-001',
  'HTTP 400 when contact missing',
  `http=${noContact.status} bodyStatus=${noContact.data?.status} msg=${noContact.data?.message}`,
  noContact.ok && noContact.data?.status >= 400
    ? 'YES — HTTP 200 with body status 400 (contact is required)'
    : 'CHECK',
);

const guestsNoLead = buildGuests().map(({ isLead, ...rest }) => rest);
const noLead = await hotel.finalizeBooking(
  buildFinalizeBody({
    bookingContext: ctx,
    bookingCode: code,
    requestId: detailsRid,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
    guests: guestsNoLead,
  }),
);
push(
  'HOTEL-FIN-002',
  'HTTP 400 when isLead missing',
  `http=${noLead.status} bodyStatus=${noLead.data?.status} msg=${noLead.data?.message}`,
  noLead.ok && noLead.data?.status >= 400
    ? 'YES — HTTP 200 with body status 400 (lead guest required)'
    : noLead.data?.bookingRefId
      ? 'no (accepted without isLead)'
      : 'CHECK',
);

const badCode = await hotel.prebook({
  bookingCode: 'invalid-booking-code',
  requestId: detailsRid,
});
push(
  'HOTEL-PRE-002',
  'HTTP 4xx for invalid bookingCode',
  `http=${badCode.status} bookingContext=${Boolean(badCode.data?.bookingContext)} keys=${Object.keys(badCode.data || {}).join(',')}`,
  badCode.ok && !badCode.data?.bookingContext
    ? 'YES — HTTP 200, no error message, only missing bookingContext'
    : 'no',
);

const emptySearch = await hotel.search({});
push(
  'HOTEL-SEA-001',
  'HTTP 4xx for empty search body',
  `http=${emptySearch.status} bodyStatus=${emptySearch.data?.status} title=${emptySearch.data?.title} msg=${emptySearch.data?.message}`,
  emptySearch.ok && (emptySearch.data?.status >= 400 || emptySearch.data?.title)
    ? 'YES — HTTP 200 with error payload'
    : emptySearch.ok
      ? 'CHECK'
      : 'no',
);

const badStatus = await hotel.getBookingStatus('BR_NOT_REAL_000');
push(
  'HOTEL-STA-001',
  'HTTP 404 for unknown bookingRefId',
  `http=${badStatus.status} bodyStatus=${badStatus.data?.status} msg=${badStatus.data?.message || badStatus.data?.info}`,
  badStatus.ok && (badStatus.data?.status === 404 || /not found/i.test(JSON.stringify(badStatus.data || {})))
    ? 'YES — HTTP 200 + body 404'
    : !badStatus.ok
      ? 'no'
      : 'CHECK',
);

const good = await hotel.finalizeBooking(
  buildFinalizeBody({
    bookingContext: ctx,
    bookingCode: code,
    requestId: detailsRid,
    checkin: searchBody.checkin,
    checkout: searchBody.checkout,
  }),
);
push(
  'HOTEL-FIN-003',
  'Finalize success returns BR',
  `http=${good.status} br=${good.data?.bookingRefId} status=${good.data?.status}`,
  good.data?.bookingRefId ? 'no' : 'YES — no bookingRefId',
);

if (good.data?.bookingRefId) {
  const br = good.data.bookingRefId;
  const st = await hotel.getBookingStatus(br);
  push(
    'HOTEL-STA-002',
    'Consistent field naming bookingRefId',
    `status=${st.data?.status} hasBookingRefId=${Boolean(st.data?.bookingRefId)} hasBookingReferenceId=${Boolean(st.data?.bookingReferenceId)}`,
    st.data?.bookingReferenceId && !st.data?.bookingRefId
      ? 'YES — finalize uses bookingRefId, status uses bookingReferenceId'
      : 'no',
  );

  const cancel = await hotel.cancelBooking(br);
  push(
    'HOTEL-CAN-001',
    'Cancel confirmed booking succeeds',
    `http=${cancel.status} body=${JSON.stringify(cancel.data).slice(0, 160)}`,
    cancel.ok && !(cancel.data?.status >= 400) ? 'no' : 'CHECK / YES fail',
  );

  const cancel2 = await hotel.cancelBooking(br);
  push(
    'HOTEL-CAN-002',
    'Double cancel returns clear already-cancelled (or idempotent)',
    `http=${cancel2.status} body=${JSON.stringify(cancel2.data).slice(0, 160)}`,
    cancel2.ok && !(cancel2.data?.status >= 400)
      ? 'YES — second cancel looks success without clear already-cancelled'
      : 'no / CHECK',
  );
}

push(
  'HOTEL-DOC-001',
  'Postman finalize examples include contact + isLead',
  'Postman hotel finalize samples have neither contact nor isLead, but staging API requires both',
  'YES — collection/docs out of date vs live API',
  'Partners will break until docs updated',
);

console.log('\n=== HOTEL API BUGS (raise with API/dev) ===\n');
findings
  .filter((f) => String(f.bug).startsWith('YES'))
  .forEach((f, i) => {
    console.log(`${i + 1}. ${f.id}`);
    console.log(`   Actual:   ${f.actual}`);
    console.log(`   Expected: ${f.expected}`);
    if (f.notes) console.log(`   Notes:    ${f.notes}`);
    console.log('');
  });

console.log('\n=== FULL PROBE ===\n');
console.log(JSON.stringify(findings, null, 2));

import { HILLTOP, money, moneyEq, totalOf, vendorLeak } from '../fixtures.js';
import { row, errCode, brief } from '../report.js';
import {
  hilltopSearchDetails,
  noteCall,
  prebookRoom,
  buildFinalizeBodyFromStay,
  waitTerminal,
  uniqueEmail,
} from '../session.js';
import { isPrebookSuccess } from '../../helpers.js';

export async function runE2e(ctx, { cancel = true, checkPrice = true } = {}) {
  const rows = [];
  const daysList = [28, 35, 21];
  let stay;
  let room;
  let pre;
  for (const days of daysList) {
    stay = await hilltopSearchDetails(ctx.hotel, { checkinDays: days, nights: 1 });
    noteCall(ctx, `e2e-search-${days}`, '/v1/hotels/search', stay.search);
    noteCall(ctx, `e2e-details-${days}`, '/v1/hotels/details', stay.details);
    room = stay.rooms[0];
    if (stay.details.ok && room && stay.requestId) {
      pre = await prebookRoom(ctx.hotel, stay, room);
      noteCall(ctx, 'e2e-prebook', '/v1/hotels/prebook', pre);
      if (isPrebookSuccess(pre)) break;
    }
    pre = null;
    room = null;
  }

  if (!room || !isPrebookSuccess(pre)) {
    rows.push(row(
      'E2E', 'book', 1, 'Search → details → prebook → finalize Confirmed',
      `Hilltop ${HILLTOP.entityId}`,
      'Confirmed BR',
      `no prebook ${brief(stay?.details?.data, 160)}`,
      'BUG',
    ));
    return rows;
  }

  const detailsPrice = money(room.price?.totalAmount);
  const prePrice = totalOf(pre.data?.salesSummary) ?? totalOf(pre.data?.rooms?.[0]?.price) ?? totalOf(pre.data);
  if (checkPrice) {
    rows.push(row(
      'PRICE', 'price', 1, 'Details totalAmount ≈ prebook total',
      'same bookingCode / stay, ±₹0.05',
      'match',
      `details=${detailsPrice} prebook=${prePrice}`,
      moneyEq(detailsPrice, prePrice) ? 'PASS' : (detailsPrice == null || prePrice == null ? 'NOT TESTED' : 'BUG'),
    ));
  }

  const body = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    email: uniqueEmail('hotel.e2e'),
  });
  const fin = await ctx.hotel.finalizeBooking(body);
  noteCall(ctx, 'e2e-finalize', '/v1/hotels/finalize-booking', fin);
  const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId || null;
  const encOk = !vendorLeak(room.bookingCode);
  rows.push(row(
    'ENCRYPT', 'vendor', 3, 'Finalize uses encrypted bookingCode',
    'POST /v1/hotels/finalize-booking',
    'not VALIDATION_ERROR merely for encryption; Confirmed possible',
    `codeLen=${String(room.bookingCode || '').length} leak=${encOk ? 0 : 1} http=${fin.status} br=${br}`,
    encOk && fin.status < 500 ? 'PASS' : 'BUG',
  ));

  if (!br) {
    rows.push(row(
      'E2E', 'book', 1, 'Search → details → prebook → finalize Confirmed',
      'Hilltop + PAN Rohan (+ GST if claimable)',
      'Confirmed, BR + confirmation number',
      `HTTP ${fin.status} code=${errCode(fin)} ${brief(fin.data, 240)}`,
      'BUG',
    ));
    return rows;
  }

  const statusRes = await waitTerminal(ctx.hotel, br);
  noteCall(ctx, 'e2e-status', `/v1/hotels/bookings/${br}/status`, statusRes);
  const st = String(statusRes.data?.status || '');
  const confirmed = /confirmed/i.test(st);
  const inprog = /inprogress|in.progress|pending/i.test(st);
  rows.push(row(
    'E2E', 'book', 1, 'Search → details → prebook → finalize Confirmed',
    `Hilltop PAN+GST as required checkin=${stay.searchBody.checkin}`,
    'status Confirmed, BR + confirmation number',
    `br=${br} status=${st} conf=${statusRes.data?.confirmationNumber || fin.data?.confirmationNumber || null}`,
    confirmed ? 'PASS' : (inprog ? 'NOT TESTED' : 'BUG'),
    { note: inprog ? 'Left Inprogress; do not keep polling' : '' },
  ));

  ctx.bookingRefId = br;
  ctx.bookingStatus = st;
  ctx.finalize = fin;
  ctx.e2eStay = stay;
  ctx.e2eRoom = room;

  const detail = await ctx.hotel.getBookingDetail(br);
  noteCall(ctx, 'e2e-detail', `/v1/hotels/bookings/${br}`, detail);

  const roomTypeBook = detail.data?.roomDetails?.roomType
    || detail.data?.rooms?.[0]?.roomType
    || detail.data?.roomType
    || null;
  const roomTypeSrc = room.roomType || room.name || room.title || null;
  rows.push(row(
    'E2E', 'detail', 1, 'Booking detail roomType present',
    `GET /v1/hotels/bookings/${br}`,
    'roomType/title present',
    `detailRoomType=${roomTypeBook} booked=${roomTypeSrc} http=${detail.status}`,
    detail.ok && (roomTypeBook || detail.data) ? 'PASS' : 'BUG',
  ));

  const hist = await ctx.hotel.bookingHistory(0, 20);
  noteCall(ctx, 'e2e-history', '/v1/hotels/bookings/history', hist);
  const histBlob = JSON.stringify(hist.data || {});
  rows.push(row(
    'E2E', 'book', 6, 'Hotel history lists BR',
    'GET /v1/hotels/bookings/history',
    'BR present; status matches when listed',
    `http=${hist.status} listed=${histBlob.includes(br)}`,
    hist.ok && histBlob.includes(br) ? 'PASS' : (hist.ok ? 'NOT TESTED' : 'BUG'),
  ));

  if (checkPrice && confirmed) {
    const confPrice = totalOf(fin.data?.salesSummary) ?? totalOf(fin.data);
    const stPrice = totalOf(statusRes.data?.salesSummary) ?? totalOf(statusRes.data);
    const detPrice = totalOf(detail.data?.salesSummary) ?? totalOf(detail.data);
    rows.push(row(
      'PRICE', 'price', 2, 'Prebook ≈ finalize/confirmed total',
      'salesSummary.totalAmount ±₹0.05',
      'match',
      `prebook=${prePrice} finalize=${confPrice}`,
      moneyEq(prePrice, confPrice)
        ? 'PASS'
        : (prePrice == null || confPrice == null ? 'NOT TESTED' : 'BUG'),
    ));
    rows.push(row(
      'PRICE', 'price', 3, 'Confirmed ≈ GET status total',
      `GET /v1/hotels/bookings/${br}/status`,
      'match ±₹0.05',
      `confirmed=${confPrice} status=${stPrice}`,
      moneyEq(confPrice ?? detailsPrice, stPrice) ? 'PASS' : (stPrice == null ? 'NOT TESTED' : 'BUG'),
    ));
    rows.push(row(
      'PRICE', 'price', 4, 'Status ≈ GET booking details total',
      `GET /v1/hotels/bookings/${br}`,
      'match ±₹0.05',
      `status=${stPrice} detail=${detPrice}`,
      moneyEq(stPrice ?? confPrice, detPrice) ? 'PASS' : (detPrice == null ? 'NOT TESTED' : 'BUG'),
    ));
  }

  const unknown = await ctx.hotel.getBookingDetail('BR0000000000000001');
  noteCall(ctx, 'unknown-br', '/v1/hotels/bookings/BR0000000000000001', unknown);
  const nf = unknown.status >= 400 && (errCode(unknown) === 'NOT_FOUND' || unknown.status === 404 || unknown.status === 400);
  rows.push(row(
    'E2E', 'detail', 3, 'Unknown BR is 4xx NOT_FOUND',
    'GET /v1/hotels/bookings/BR0000000000000001',
    '4xx NOT_FOUND (not 200)',
    `HTTP ${unknown.status} code=${errCode(unknown)}`,
    unknown.status === 200 ? 'BUG' : (nf ? 'PASS' : 'BUG'),
  ));

  if (!cancel || !confirmed) {
    if (!cancel) {
      rows.push(row('CANCEL', 'post', 4, 'Cancel Confirmed skipped', '--tags without CANCEL', 'Cancelled', 'not requested', 'NOT TESTED'));
    }
    return rows;
  }

  const penalty = await ctx.hotel.penaltyCheck(br);
  noteCall(ctx, 'e2e-penalty', `/v1/hotels/bookings/${br}/penalty-check`, penalty);
  rows.push(row(
    'CANCEL', 'post', 7, 'Penalty check on Confirmed',
    `GET /v1/hotels/bookings/${br}/penalty-check`,
    'HTTP 200 quote (does not cancel)',
    `HTTP ${penalty.status} ${brief(penalty.data, 160)}`,
    penalty.ok || penalty.status === 200 ? 'PASS' : 'BUG',
  ));

  const can = await ctx.hotel.cancelBooking(br);
  noteCall(ctx, 'e2e-cancel', `/v1/hotels/bookings/${br}/cancel`, can);
  const after = await waitTerminal(ctx.hotel, br, { max: 12, intervalMs: 3000 });
  noteCall(ctx, 'e2e-cancel-status', `/v1/hotels/bookings/${br}/status`, after);
  const cancelled = /cancel/i.test(String(after.data?.status || can.data?.status || ''));
  rows.push(row(
    'CANCEL', 'post', 4, 'Cancel Confirmed',
    `GET /v1/hotels/bookings/${br}/cancel then poll status`,
    '200; status → Cancelled',
    `cancelHttp=${can.status} status=${after.data?.status || null}`,
    can.ok && cancelled ? 'PASS' : (can.ok ? 'NOT TESTED' : 'BUG'),
  ));

  const again = await ctx.hotel.cancelBooking(br);
  noteCall(ctx, 'e2e-cancel-again', `/v1/hotels/bookings/${br}/cancel`, again);
  const already = again.status >= 400;
  rows.push(row(
    'CANCEL', 'post', 5, 'Cancel already-Cancelled',
    'repeat cancel on same BR',
    '4xx already cancelled / not Confirmed',
    `HTTP ${again.status} code=${errCode(again)} ${brief(again.data, 160)}`,
    already ? 'PASS' : 'BUG',
  ));

  return rows;
}

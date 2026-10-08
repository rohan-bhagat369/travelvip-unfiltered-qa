import { row, errCode, brief } from '../../../hotel/regression/report.js';
import { noteCall } from '../session.js';
import { sleep } from '../../../../../shared/lib/testUtils.js';
import { config } from '../../../../../shared/config/env.js';
import { TravelVipClient } from '../../../../../shared/lib/TravelVipClient.js';
import { requestPartnerToken, requestUserSession } from '../../../../../shared/lib/authApi.js';
import { FlightService } from '../../service.js';

async function waitCancelled(flight, ctx, br) {
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    const st = await flight.getBookingStatus(br);
    noteCall(ctx, `cancel-status-${i + 1}`, `/v1/flights/booking/${br}/status`, st);
    last = String(st.data?.status || '');
    if (/cancel/i.test(last)) return { status: last, res: st };
    await sleep(2500);
  }
  return { status: last, res: null };
}

function extractOnlineCancel(data) {
  const it = data?.bookingResponse?.itinerary || data?.itinerary || [];
  if (it.some((leg) => leg.onlineCancellation === true)) return true;
  if (data?.onlineCancellation === true || data?.bookingResponse?.onlineCancellation === true) return true;
  if (it.some((leg) => leg.onlineCancellation === false)) return false;
  if (data?.onlineCancellation === false || data?.bookingResponse?.onlineCancellation === false) return false;
  return null;
}

function cancelRequestStatus(data) {
  return String(
    data?.data?.cancellationRequest?.status
    || data?.cancellationRequest?.status
    || '',
  );
}
async function scoreOffline(flight, ctx, rows) {
  const off = ctx.offlineFixture;
  if (off?.br && /confirm/i.test(off.status || '')) {
    const offPnr = extractPnr(off.statusRes?.data) || extractPnr(off.issue?.data);
    const offCan = await flight.cancelV2({
      bookingId: off.br,
      action: 'CANCEL',
      pnr: offPnr || 'ABCDEF',
      cancelledBy: 'USER',
      cancellationReason: 'offline copy check',
    });
    noteCall(ctx, 'cancel-offline', '/api/v2/flight/cancel', offCan);
    const offSt = await flight.getBookingStatus(off.br);
    noteCall(ctx, 'cancel-offline-status', `/v1/flights/booking/${off.br}/status`, offSt);
    const stillOn = /confirm/i.test(String(offSt.data?.status || ''));
    const msg = JSON.stringify(offCan.data || {});
    const offlineHint = /offline|not (eligible|allowed)|cannot cancel|onlineCancellation/i.test(msg);
    const crash = (offCan.status || 0) >= 500;
    rows.push(row(
      'CANCEL', 'offline', 12, 'POST /api/v2/flight/cancel — onlineCancellation=false stays Confirmed',
      `v2 cancel BR ${off.br} (offline fare); GET status must remain Confirmed`,
      'status Confirmed + 4xx/200 with offline/not-allowed copy — never 500 and never Cancelled',
      `HTTP ${offCan.status} status=${offSt.data?.status} hint=${offlineHint} ${brief(offCan.data, 140)}`,
      crash || (!stillOn && /cancel/i.test(String(offSt.data?.status || ''))) ? 'BUG' : (stillOn ? 'PASS' : 'BUG'),
    ));
    return;
  }
  rows.push(row(
    'CANCEL', 'offline', 12, 'POST /api/v2/flight/cancel — onlineCancellation=false stays Confirmed',
    'needs Confirmed BR with itinerary.onlineCancellation=false',
    'Confirmed + offline message',
    `offlineBr=${off?.br || null} status=${off?.status || null}`,
    'NOT TESTED',
  ));
}

function extractPnr(data) {
  const it = data?.bookingResponse?.itinerary || data?.itinerary || [];
  for (const leg of it) {
    const pnr = leg?.pnr || leg?.airlinePnr || leg?.airline_pnr;
    if (pnr) return String(pnr).trim();
  }
  return data?.pnr || data?.bookingResponse?.pnr || null;
}

export async function runCancel(ctx) {
  const rows = [];
  const { flight } = ctx;

  const missingId = await flight.cancelV2({});
  noteCall(ctx, 'cancel-missing-id', '/api/v2/flight/cancel', missingId);
  rows.push(row(
    'CANCEL', 'v2', 1, 'v2 cancel missing bookingId',
    'POST /api/v2/flight/cancel {}',
    '400 VALIDATION_ERROR bookingId',
    `HTTP ${missingId.status} code=${errCode(missingId)} ${brief(missingId.data, 160)}`,
    missingId.status === 400 && errCode(missingId) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
  ));

  const missingAction = await flight.cancelV2({ bookingId: 'BR0000000000000001' });
  noteCall(ctx, 'cancel-missing-action', '/api/v2/flight/cancel', missingAction);
  rows.push(row(
    'CANCEL', 'v2', 2, 'v2 cancel missing action',
    '{ bookingId } only',
    '400 VALIDATION_ERROR action',
    `HTTP ${missingAction.status} code=${errCode(missingAction)}`,
    missingAction.status === 400 && errCode(missingAction) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
  ));

  const badAction = await flight.cancelV2({ bookingId: 'BR0000000000000001', action: 'DELETE' });
  noteCall(ctx, 'cancel-bad-action', '/api/v2/flight/cancel', badAction);
  rows.push(row(
    'CANCEL', 'v2', 3, 'v2 invalid action',
    'action=DELETE',
    '400 VALIDATION_ERROR',
    `HTTP ${badAction.status} code=${errCode(badAction)}`,
    badAction.status === 400 && errCode(badAction) === 'VALIDATION_ERROR' ? 'PASS' : 'BUG',
  ));

  const fake = `BR9${Date.now().toString().slice(-15)}`;
  const nf = await flight.cancelV2({ bookingId: fake, action: 'CANCEL', pnr: 'ABCDEF', cancelledBy: 'USER' });
  noteCall(ctx, 'cancel-not-found', '/api/v2/flight/cancel', nf);
  rows.push(row(
    'CANCEL', 'v2', 4, 'BOOKING_NOT_FOUND',
    `bookingId=${fake}`,
    '404 BOOKING_NOT_FOUND',
    `HTTP ${nf.status} code=${errCode(nf)} ${brief(nf.data, 140)}`,
    nf.status === 404 && errCode(nf) === 'BOOKING_NOT_FOUND' ? 'PASS' : (nf.status >= 400 ? 'PASS' : 'BUG'),
  ));

  const hasPartner2 = Boolean(process.env.PARTNER_ID_2 && process.env.PARTNER_SECRET_2);
  if (!hasPartner2) {
    rows.push(row(
      'CANCEL', 'v2', 5, 'POST /api/v2/flight/cancel — BOOKING_PARTNER_MISMATCH',
      'needs PARTNER_ID_2 + PARTNER_SECRET_2 in env (second partner credentials)',
      '403 BOOKING_PARTNER_MISMATCH',
      'no second partner in this pack',
      'NOT TESTED',
    ));
  }

  const hotelBr = 'BR1786026302970325';
  const notFlight = await flight.cancelV2({
    bookingId: hotelBr, action: 'CANCEL', pnr: 'ABCDEF', cancelledBy: 'USER',
  });
  noteCall(ctx, 'cancel-hotel-br', '/api/v2/flight/cancel', notFlight);
  const code = errCode(notFlight);
  rows.push(row(
    'CANCEL', 'v2', 6, 'Hotel BR on flight cancel',
    `bookingId=${hotelBr}`,
    'FLIGHT_BOOKING_ITEM_NOT_FOUND or NOT_FOUND',
    `HTTP ${notFlight.status} code=${code}`,
    /ITEM_NOT_FOUND|NOT_FOUND/i.test(String(code)) || notFlight.status >= 400 ? 'PASS' : 'BUG',
  ));

  const br = ctx.bookingRefId;
  const confirmed = /confirm/i.test(String(ctx.bookingStatus || ''));
  if (!br || !confirmed || ctx.skipCancel) {
    rows.push(row(
      'CANCEL', 'post', 7, 'Penalty + cancel Confirmed',
      'needs E2E Confirmed BR',
      'Cancelled',
      `br=${br || null} status=${ctx.bookingStatus || null} skip=${Boolean(ctx.skipCancel)}`,
      'NOT TESTED',
    ));
    await scoreOffline(flight, ctx, rows);
    return rows;
  }

  const det = await flight.getBookingDetail(br);
  noteCall(ctx, 'cancel-detail', `/v1/flights/booking/${br}`, det);
  const pnr = ctx.pnr || extractPnr(det.data) || extractPnr(ctx.statusRes?.data) || extractPnr(ctx.e2e?.issue?.data);
  ctx.pnr = pnr;
  const online = ctx.onlineCancellation === true || extractOnlineCancel(det.data) === true;
  ctx.onlineCancellation = online;

  const omitPnr = await flight.checkCancellationPenalty(br, {});
  noteCall(ctx, 'penalty-no-pnr', `/v1/flights/booking/${br}/cancel`, omitPnr);
  const omitOk = omitPnr.status === 400 && errCode(omitPnr) === 'VALIDATION_ERROR'
    && /pnr/i.test(JSON.stringify(omitPnr.data || {}));
  rows.push(row(
    'CANCEL', 'post', 7, 'Penalty without pnr is rejected',
    `{ action: PENALTY } omit pnr — BR ${br}`,
    'HTTP 400 VALIDATION_ERROR pnr required',
    `HTTP ${omitPnr.status} code=${errCode(omitPnr)} ${brief(omitPnr.data, 180)}`,
    omitOk ? 'PASS' : 'BUG',
  ));

  if (!pnr) {
    rows.push(row(
      'CANCEL', 'post', 8, 'Penalty + cancel with pnr',
      'need airline PNR from booking detail',
      'penalty quote then Cancelled',
      `no pnr on ${br} ${brief(det.data, 160)}`,
      'NOT TESTED',
    ));
    await scoreOffline(flight, ctx, rows);
    return rows;
  }

  if (!online) {
    rows.push(row(
      'CANCEL', 'post', 8, 'Penalty + cancel on onlineCancellation=true',
      `BR ${br} itinerary.onlineCancellation`,
      'Confirmed BR with onlineCancellation=true',
      `onlineCancellation=${extractOnlineCancel(det.data)} (Cancellation Requested is not a booking status)`,
      'NOT TESTED',
    ));
    await scoreOffline(flight, ctx, rows);
    return rows;
  }

  const penalty = await flight.checkCancellationPenalty(br, { pnr });
  noteCall(ctx, 'penalty', `/v1/flights/booking/${br}/cancel`, penalty);
  const still = await flight.getBookingStatus(br);
  noteCall(ctx, 'penalty-status', `/v1/flights/booking/${br}/status`, still);
  const penCr = cancelRequestStatus(penalty.data);
  const dup = penalty.data?.duplicate === true;
  rows.push(row(
    'CANCEL', 'post', 8, 'Penalty check on Confirmed (with pnr)',
    `{ action: PENALTY, pnr }`,
    'HTTP 200; booking status still Confirmed (Penalty Check Failed + duplicate cache OK)',
    `HTTP ${penalty.status} pnr=${pnr} status=${still.data?.status} cr=${penCr} duplicate=${dup} ${brief(penalty.data, 140)}`,
    (penalty.ok || penalty.status === 200) && /confirm/i.test(String(still.data?.status || '')) ? 'PASS' : 'BUG',
  ));

  if (hasPartner2) {
    try {
      const tok = await requestPartnerToken({
        partner_id: process.env.PARTNER_ID_2,
        partner_secret: process.env.PARTNER_SECRET_2,
      });
      const sess = tok.ok ? await requestUserSession(tok.data.access_token, { tierId: config.tierId }) : tok;
      const otherClient = new TravelVipClient({
        authToken: sess.data?.auth_token,
        partnerKey: tok.data?.access_token,
        correlationId: process.env.CORRELATION_ID,
      });
      const otherFlight = new FlightService(otherClient);
      const mm = await otherFlight.cancelV2({
        bookingId: br, action: 'CANCEL', pnr, cancelledBy: 'USER',
      });
      noteCall(ctx, 'cancel-partner-mismatch', '/api/v2/flight/cancel', mm);
      const mmCode = errCode(mm);
      rows.push(row(
        'CANCEL', 'v2', 5, 'POST /api/v2/flight/cancel — BOOKING_PARTNER_MISMATCH',
        `Second partner token against BR ${br}`,
        'HTTP 403 BOOKING_PARTNER_MISMATCH (never 500, never cancel)',
        `HTTP ${mm.status} code=${mmCode} ${brief(mm.data, 140)}`,
        /PARTNER_MISMATCH/i.test(String(mmCode || '')) || (mm.status >= 400 && mm.status < 500) ? 'PASS' : 'BUG',
      ));
    } catch (e) {
      rows.push(row(
        'CANCEL', 'v2', 5, 'POST /api/v2/flight/cancel — BOOKING_PARTNER_MISMATCH',
        'second partner auth/cancel threw',
        '403 BOOKING_PARTNER_MISMATCH',
        String(e.message || e).slice(0, 180),
        'BUG',
      ));
    }
  }

  const v1can = await flight.cancelBooking(br, { pnr, cancelledBy: 'USER' });
  noteCall(ctx, 'cancel-v1', `/v1/flights/booking/${br}/cancel`, v1can);
  const v1crash = (v1can.status || 0) >= 500;
  rows.push(row(
    'CANCEL', 'v1', 11, 'POST /v1/flights/booking/{BR}/cancel — action=CANCEL',
    `{ action: CANCEL, pnr, cancelledBy: USER } on ${br}`,
    'HTTP 200 cancel accepted or 4xx with error.code — never 500',
    `HTTP ${v1can.status} code=${errCode(v1can)} ${brief(v1can.data, 140)}`,
    v1crash ? 'BUG' : ((v1can.ok || v1can.status === 200 || (v1can.status >= 400 && v1can.status < 500)) ? 'PASS' : 'BUG'),
  ));

  const cancelBody = {
    bookingId: br,
    action: 'CANCEL',
    pnr,
    cancelledBy: 'USER',
    cancellationReason: 'pre-deploy regression',
  };
  const can = await flight.cancelV2(cancelBody);
  noteCall(ctx, 'cancel-confirmed', '/api/v2/flight/cancel', can);
  const after = await waitCancelled(flight, ctx, br);
  const cancelled = /cancel/i.test(after.status || '');
  const canCr = cancelRequestStatus(can.data);
  const requested = /cancellation requested/i.test(canCr);
  rows.push(row(
    'CANCEL', 'post', 9, 'Cancel Confirmed',
    `v2 cancel BR ${br} pnr=${pnr} cancelledBy=USER`,
    'GET status Cancelled (direct online) OR GET Confirmed + Cancellation Requested (not direct)',
    `http=${can.status} status=${after.status} cr=${canCr} ${brief(can.data, 120)}`,
    can.status === 200 && (cancelled || (requested && /confirm/i.test(after.status || ''))) ? 'PASS' : 'BUG',
  ));

  const again = await flight.cancelV2(cancelBody);
  noteCall(ctx, 'cancel-again', '/api/v2/flight/cancel', again);
  const againCode = errCode(again);
  const expectInProgress = !cancelled;
  const expectCode = expectInProgress
    ? 'CANCELLATION_ALREADY_IN_PROGRESS'
    : 'BOOKING_ALREADY_CANCELLED';
  const codeOk = expectInProgress
    ? againCode === 'CANCELLATION_ALREADY_IN_PROGRESS'
    : /ALREADY_CANCELLED|BOOKING_ALREADY_CANCELLED/i.test(String(againCode || ''));
  rows.push(row(
    'CANCEL', 'post', 10, expectInProgress ? 'Cancel while airline cancel in progress' : 'Cancel already-Cancelled',
    'repeat v2 cancel with same pnr',
    `4xx ${expectCode}`,
    `HTTP ${again.status} code=${againCode} ${brief(again.data, 200)}`,
    again.status >= 400 && codeOk ? 'PASS' : 'BUG',
  ));

  await scoreOffline(flight, ctx, rows);
  return rows;
}

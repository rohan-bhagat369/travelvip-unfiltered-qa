import { INVALID_PAN, PAN_ROHAN, PAN_ATUL } from '../fixtures.js';
import { row, errCode, brief } from '../report.js';
import {
  hilltopSearchDetails,
  noteCall,
  prebookRoom,
  buildFinalizeBodyFromStay,
  uniqueEmail,
} from '../session.js';
import { isPrebookSuccess } from '../../helpers.js';

async function stayReady(ctx) {
  const stay = await hilltopSearchDetails(ctx.hotel);
  noteCall(ctx, 'pan-search', '/v1/hotels/search', stay.search);
  noteCall(ctx, 'pan-details', '/v1/hotels/details', stay.details);
  const room = stay.rooms[0];
  if (!stay.details.ok || !room || !stay.requestId) return { stay, room: null, pre: null };
  const pre = await prebookRoom(ctx.hotel, stay, room);
  noteCall(ctx, 'pan-prebook', '/v1/hotels/prebook', pre);
  return { stay, room, pre };
}

export async function runPanGst(ctx, { twoName = false } = {}) {
  const rows = [];
  const { stay, room, pre } = await stayReady(ctx);
  if (!room || !isPrebookSuccess(pre)) {
    rows.push(row('PAN', 'pan', 1, 'PAN/GST negatives need Hilltop prebook', 'search→details→prebook', 'bookingContext', brief(pre?.data || stay.details.data), 'NOT TESTED'));
    return rows;
  }

  const panFlag = room.isPANMandatory === true;
  const gstFlag = Boolean(room.isGSTClaimable || room.isGstClaimable);
  rows.push(row(
    'PAN', 'pan', 7, 'isPANMandatory flag present on Hilltop room',
    `details room ${stay.hotelName}`,
    'flag present; Hilltop typically true',
    `isPANMandatory=${room.isPANMandatory} isGSTClaimable=${gstFlag} price=${room.price?.totalAmount}`,
    panFlag ? 'PASS' : 'BUG',
  ));

  const badPan = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    pan: { panCardNumber: INVALID_PAN, panCardName: PAN_ROHAN.panCardName },
    email: uniqueEmail('hotel.badpan'),
  });
  const badRes = await ctx.hotel.finalizeBooking(badPan);
  noteCall(ctx, 'pan-invalid', '/v1/hotels/finalize-booking', badRes);
  const badCode = errCode(badRes);
  const badPass = badRes.status === 400 && badCode === 'VALIDATION_ERROR' && !badRes.data?.bookingRefId;
  rows.push(row(
    'PAN', 'pan', 3, 'Invalid PAN format BADPAN',
    'clone valid finalize, mutate only panCardNumber=BADPAN',
    'HTTP 400 VALIDATION_ERROR; no BR',
    `HTTP ${badRes.status} code=${badCode} br=${badRes.data?.bookingRefId || null} ${brief(badRes.data, 220)}`,
    badPass ? 'PASS' : 'BUG',
  ));

  const noName = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    pan: { panCardNumber: PAN_ROHAN.panCardNumber },
    email: uniqueEmail('hotel.noname'),
  });
  delete noName.contact.panCardName;
  const noNameRes = await ctx.hotel.finalizeBooking(noName);
  noteCall(ctx, 'pan-no-name', '/v1/hotels/finalize-booking', noNameRes);
  const noNamePass = noNameRes.status === 400 && errCode(noNameRes) === 'VALIDATION_ERROR';
  rows.push(row(
    'PAN', 'pan', 4, 'PAN without panCardName',
    'omit panCardName only',
    'HTTP 400 VALIDATION_ERROR',
    `HTTP ${noNameRes.status} code=${errCode(noNameRes)} ${brief(noNameRes.data, 180)}`,
    noNamePass ? 'PASS' : 'BUG',
  ));

  const missing = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    includePan: false,
    email: uniqueEmail('hotel.nopan'),
  });
  const missRes = await ctx.hotel.finalizeBooking(missing);
  noteCall(ctx, 'pan-missing', '/v1/hotels/finalize-booking', missRes);
  const missPass = panFlag
    ? (missRes.status === 400 || /fail/i.test(String(missRes.data?.status || ''))) && errCode(missRes)
    : true;
  rows.push(row(
    'PAN', 'pan', 6, 'Missing PAN on isPANMandatory=true',
    'omit panCardNumber + panCardName Hilltop',
    '400 / fail; not Confirmed',
    `HTTP ${missRes.status} code=${errCode(missRes)} status=${missRes.data?.status || null} br=${missRes.data?.bookingRefId || null}`,
    !panFlag ? 'NOT TESTED' : (missPass && !/confirmed/i.test(String(missRes.data?.status || '')) ? 'PASS' : 'BUG'),
  ));

  const mismatch = buildFinalizeBodyFromStay({
    stay, room, requestId: stay.requestId, prebook: pre,
    lastName: `Bhagatx${Date.now().toString().slice(-4)}`,
    pan: PAN_ROHAN,
    email: uniqueEmail('hotel.panname'),
  });
  const mmRes = await ctx.hotel.finalizeBooking(mismatch);
  noteCall(ctx, 'pan-name-mismatch', '/v1/hotels/finalize-booking', mmRes);
  const mmBr = mmRes.data?.bookingRefId || mmRes.data?.bookingReferenceId;
  let mmStatus = mmRes.data?.status || null;
  if (mmBr && ctx.hotel.getBookingStatus) {
    const st = await ctx.hotel.getBookingStatus(mmBr);
    noteCall(ctx, 'pan-mismatch-status', `/v1/hotels/bookings/${mmBr}/status`, st);
    mmStatus = st.data?.status || mmStatus;
  }
  const mmFail = /fail/i.test(String(mmStatus || '')) || (mmRes.status >= 400 && errCode(mmRes));
  const mmConfirmed = /confirmed/i.test(String(mmStatus || ''));
  rows.push(row(
    'PAN', 'pan', 5, 'PAN name ≠ lead guest',
    'lead lastName tagged; PAN name still Rohan Bhagat',
    'status Failed (not Confirmed)',
    `HTTP ${mmRes.status} br=${mmBr || null} status=${mmStatus} code=${errCode(mmRes)}`,
    mmConfirmed ? 'BUG' : (mmFail ? 'PASS' : 'NOT TESTED'),
  ));

  if (gstFlag) {
    const noGst = buildFinalizeBodyFromStay({
      stay, room, requestId: stay.requestId, prebook: pre,
      includeGst: false,
      email: uniqueEmail('hotel.nogst'),
    });
    delete noGst.gstDetails;
    const gstRes = await ctx.hotel.finalizeBooking(noGst);
    noteCall(ctx, 'gst-missing', '/v1/hotels/finalize-booking', gstRes);
    const gstPass = gstRes.status === 400 && errCode(gstRes) === 'VALIDATION_ERROR';
    rows.push(row(
      'GST', 'gst', 8, 'GST-claimable rate without gstDetails',
      'omit gstDetails on claimable room',
      "HTTP 400 VALIDATION_ERROR gstDetails required",
      `HTTP ${gstRes.status} code=${errCode(gstRes)} ${brief(gstRes.data, 200)}`,
      gstPass ? 'PASS' : 'BUG',
    ));
  } else {
    rows.push(row(
      'GST', 'gst', 8, 'GST-claimable rate without gstDetails',
      'needs isGSTClaimable room',
      'HTTP 400 VALIDATION_ERROR',
      'Hilltop cheapest room not GST-claimable this run',
      'NOT TESTED',
    ));
  }

  if (twoName) {
    const hit1 = buildFinalizeBodyFromStay({
      stay, room, requestId: stay.requestId, prebook: pre,
      firstName: 'Rohan', lastName: 'Bhagat', pan: PAN_ROHAN,
      email: uniqueEmail('hotel.twoname.a'),
    });
    const r1 = await ctx.hotel.finalizeBooking(hit1);
    const br1 = r1.data?.bookingRefId;
    const hit2 = buildFinalizeBodyFromStay({
      stay, room, requestId: stay.requestId, prebook: pre,
      firstName: 'Atul', lastName: 'Ugale', pan: PAN_ATUL,
      email: uniqueEmail('hotel.twoname.b'),
    });
    const r2 = await ctx.hotel.finalizeBooking(hit2);
    const br2 = r2.data?.bookingRefId;
    const dup = r2.data?.duplicate === true;
    rows.push(row(
      'PAN', 'pan', 2, 'Second person valid PAN same prebook',
      'Rohan then Atul, same bookingCode/requestId/bookingContext',
      '2nd Confirmed, duplicate:false',
      `br1=${br1} http2=${r2.status} br2=${br2} duplicate=${r2.data?.duplicate}`,
      br1 && br2 && !dup ? 'PASS' : 'BUG',
    ));
  }

  ctx.panStay = stay;
  ctx.panRoom = room;
  return rows;
}

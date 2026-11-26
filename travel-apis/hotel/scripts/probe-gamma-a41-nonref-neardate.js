/**
 * A4.1 non-refundable on near dates (gamma)
 *   $env:BASE_URL='https://gamma-api.travelvip.ai'
 *   node travel-apis/hotel/scripts/probe-gamma-a41-nonref-neardate.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
} from '../src/helpers.js';
import { createRequestId } from '../../../shared/lib/signature.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || 'https://gamma-api.travelvip.ai').replace(/\/$/, '');
process.env.BASE_URL = BASE;
const OUT = path.join(__dirname, '..', 'reports', 'gamma-hotel-callback-stripe');
const PID = process.env.CALLBACK_PID || 'smt';
const KEY = process.env.CALLBACK_KEY || 'palsgcvgscvvs';

function brief(d, n = 300) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}

function isNonRef(room) {
  const t = JSON.stringify(room || {}).toLowerCase();
  if (room?.isFreeCancellation === true || /free cancellation|fully refundable/.test(t)) return false;
  if (room?.refundable === false || room?.isRefundable === false) return true;
  if (room?.isFreeCancellation === false) return true;
  if (/non[- ]?refundable|non refundable|no refund|nonrefundable/.test(t)) return true;
  const ch = Number(room?.cancellationCharge ?? room?.cancelCharge);
  return Number.isFinite(ch) && ch > 0;
}

async function sendCallback(br, status) {
  const q = new URLSearchParams({ bookingId: br, pid: PID, key: KEY });
  const r = await fetch(`${BASE}/api/v1/hotels/updateHotelBooking?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': createRequestId() },
    body: JSON.stringify({
      status,
      ClientReferenceId: 'A41NR',
      ConfirmationNumber: `CNF${Date.now()}`,
      message: 'test',
    }),
  });
  const data = await r.json().catch(() => ({}));
  return { http: r.status, data, msg: String(data.message || data.msg || brief(data)) };
}

async function wallet(accessToken) {
  const r = await fetch(`${BASE}/v1/wallet/activity?page=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const d = await r.json().catch(() => ({}));
  return d?.summary?.available ?? null;
}

clearSession();
const { client, accessToken } = await authenticate(true);
const hotel = new HotelService(client);

let picked = null;
outer:
for (const checkinDays of [1, 2, 3, 4, 5, 6, 7]) {
  for (const nights of [1, 2]) {
    const searchBody = buildSearchBody({
      entityId: '39627872',
      checkinDays,
      nights,
      rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    });
    const search = await hotel.search(searchBody);
    if (!search.ok) continue;
    const details = await hotel.getDetails(searchBody);
    if (!details.ok) continue;
    const requestId = extractRequestId(details.data) || extractRequestId(search.data);
    const rooms = (details.data?.results?.[0]?.rooms || []).filter((r) => r?.bookingCode && isNonRef(r));
    console.log(`scan +${checkinDays}d ${nights}n nonRef=${rooms.length}`);
    for (const room of rooms.slice(0, 5)) {
      const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
      if (!isPrebookSuccess(pre)) continue;
      const preRoom = (pre.data?.results?.[0]?.rooms || []).find((r) => r.bookingCode === room.bookingCode) || room;
      if (!isNonRef(preRoom)) {
        console.log('  skip — not non-ref after prebook', preRoom.refundable, preRoom.isFreeCancellation);
        continue;
      }
      picked = {
        searchBody,
        details,
        pre,
        requestId: extractRequestId(pre.data) || requestId,
        bookingCode: room.bookingCode,
        room: preRoom,
        hotelName: pre.data?.results?.[0]?.name || details.data?.results?.[0]?.name,
      };
      console.log('PICKED', picked.hotelName, 'refundable=', preRoom.refundable, 'free=', preRoom.isFreeCancellation);
      break outer;
    }
  }
}

if (!picked) {
  console.error('NO non-refundable near-date inventory');
  process.exit(2);
}

const body = {
  bookingContext: extractBookingContext(picked.pre.data) || extractBookingContext(picked.details.data),
  bookingCode: picked.bookingCode,
  requestId: picked.requestId,
  checkin: picked.searchBody.checkin,
  checkout: picked.searchBody.checkout,
  rooms: [{ guests: [{ title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
  contact: {
    email: `gamma.a41nr.${Date.now()}@travelvip.ai`,
    countryCode: '+91',
    mobile: config.hotel.contactMobile,
    panCardNumber: 'EUIPB1672M',
    panCardName: 'Rohan Bhagat',
  },
};

const fin = await hotel.finalizeBooking(body);
const br = fin.data?.bookingRefId || fin.data?.bookingReferenceId;
console.log('finalize', fin.status, br, fin.data?.status, brief(fin.data));
if (!br) process.exit(1);

const cbConf = await sendCallback(br, 'CONFIRMED');
console.log('confirm cb', cbConf.http, cbConf.msg);

let status = null;
for (let i = 0; i < 15; i += 1) {
  const st = await hotel.getBookingStatus(br);
  status = st.data?.status;
  console.log('poll', i + 1, status);
  if (/Confirmed|Failed|Cancelled/i.test(String(status || ''))) break;
  await sleep(3000);
}

if (!/Confirmed/i.test(String(status || ''))) {
  const out = { status: 'NOT TESTED', br, after: status, note: 'could not confirm non-ref booking' };
  fs.writeFileSync(path.join(OUT, 'A4.1-nonref.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

await sleep(5000);
const still = await hotel.getBookingStatus(br);
console.log('still', still.data?.status);
if (!/Confirmed/i.test(String(still.data?.status || ''))) {
  const out = { status: 'NOT TESTED', br, after: still.data?.status, note: 'flipped after confirm' };
  fs.writeFileSync(path.join(OUT, 'A4.1-nonref.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const penalty = await hotel.penaltyCheck(br);
const pen = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest;
console.log('penalty', brief(pen));

const bal0 = await wallet(accessToken);
const cancel = await hotel.cancelBooking(br);
console.log('cancel', cancel.status, brief(cancel.data));
await sleep(4000);
const afterCancel = await hotel.getBookingStatus(br);
const bal1 = await wallet(accessToken);
const cancelCr = cancel.data?.data?.cancellationRequest || cancel.data?.cancellationRequest;
const refundAmt = Number(cancelCr?.refund ?? pen?.estimatedRefund ?? -1);
const chargeAmt = Number(cancelCr?.cancellationCharge ?? pen?.estimatedCancellationCharge ?? -1);

const cb = await sendCallback(br, 'CANCELLED');
await sleep(3000);
const bal2 = await wallet(accessToken);
const afterCb = await hotel.getBookingStatus(br);

const noSecond = bal1 == null || bal2 == null || Math.abs(Number(bal2) - Number(bal1)) < 1;
const refundZero = refundAmt === 0;
const cancelled = /Cancel/i.test(String(afterCb.data?.status || afterCancel.data?.status || ''));
const ignored = /no change made/i.test(cb.msg);

let score = 'BUG';
if (cancelled && ignored && noSecond && refundZero) score = 'PASS';
else if (cancelled && ignored && noSecond && !refundZero) score = 'CHECK';

const result = {
  tc: 'A4.1',
  status: score,
  br,
  hotel: picked.hotelName,
  checkin: picked.searchBody.checkin,
  checkout: picked.searchBody.checkout,
  roomFlags: {
    refundable: picked.room?.refundable,
    isFreeCancellation: picked.room?.isFreeCancellation,
    cancellationPolicy: picked.room?.cancellationPolicy || picked.room?.cancelPolicy || null,
  },
  confirmCb: cbConf.msg,
  confirmedStatus: status,
  estimatedRefund: pen?.estimatedRefund,
  estimatedCharge: pen?.estimatedCancellationCharge,
  cancelRefund: cancelCr?.refund,
  cancelCharge: cancelCr?.cancellationCharge,
  afterCancel: afterCancel.data?.status,
  callbackMsg: cb.msg,
  afterCallback: afterCb.data?.status,
  walletBeforeCancel: bal0,
  walletAfterCancel: bal1,
  walletAfterCallback: bal2,
  walletDeltaCancel: bal0 != null && bal1 != null ? Number(bal1) - Number(bal0) : null,
  noSecondRefund: noSecond,
  refundZero,
  note: refundZero
    ? 'non-refundable cancel (refund 0) + CANCELLED callback ignored'
    : `expected refund 0, got refund=${refundAmt} charge=${chargeAmt}`,
};

console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(OUT, 'A4.1-nonref.json'), JSON.stringify(result, null, 2));

const latestPath = path.join(OUT, 'latest.json');
const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
latest.partA.results['A4.1'] = result;
latest.at = new Date().toISOString();
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2));
console.log('A4.1 =>', score, br);

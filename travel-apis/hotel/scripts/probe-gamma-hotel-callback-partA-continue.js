/**
 * ENG-902 Part A continuation — remaining cases after A1.1–A3.2.
 *   $env:BASE_URL='https://gamma-api.travelvip.ai'
 *   node travel-apis/hotel/scripts/probe-gamma-hotel-callback-partA-continue.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  buildSearchBody,
  extractBookingCodes,
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
const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'latest.json'), 'utf8'));
const results = { ...(prev.partA?.results || {}) };

const CALLBACK_PID = process.env.CALLBACK_PID || 'smt';
const CALLBACK_KEY = process.env.CALLBACK_KEY || 'palsgcvgscvvs';

function brief(d, n = 300) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function msgOf(res) {
  return String(res?.data?.message || res?.data?.msg || brief(res?.data, 120));
}
function ignored(res) {
  return /no change made/i.test(msgOf(res));
}
function applied(res) {
  return /updated successfully/i.test(msgOf(res));
}

async function sendCallback(bookingId, status) {
  const q = new URLSearchParams({ bookingId: String(bookingId), pid: CALLBACK_PID, key: CALLBACK_KEY });
  const body = {
    status,
    ClientReferenceId: `TEST${Date.now()}`,
    ConfirmationNumber: `CNF${Date.now()}`,
    message: 'test',
  };
  if (status === '') delete body.status;
  const r = await fetch(`${BASE}/api/v1/hotels/updateHotelBooking?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': createRequestId() },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, message: msgOf({ data }) };
}

async function walletFeed(accessToken) {
  const res = await fetch(`${BASE}/v1/wallet/activity?page=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  return data?.summary?.available ?? null;
}

async function findAndFinalize(hotel, { checkinDays = 45, nights = 2, entityId = '39627872', preferNonRef = false } = {}) {
  const searchBody = buildSearchBody({
    entityId,
    checkinDays,
    nights,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  const search = await hotel.search(searchBody);
  if (!search.ok) return { error: `search ${search.status}` };
  const details = await hotel.getDetails(searchBody);
  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  let rooms = (details.data?.results?.[0]?.rooms || []).filter((r) => r.bookingCode);
  if (preferNonRef) {
    rooms = [...rooms].sort((a, b) => {
      const score = (r) => (/non[- ]?refundable/i.test(JSON.stringify(r)) || r.isFreeCancellation === false ? 0 : 1);
      return score(a) - score(b);
    });
  }
  for (const room of rooms.slice(0, 8)) {
    const prebook = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
    if (!isPrebookSuccess(prebook)) continue;
    const body = {
      bookingContext: extractBookingContext(prebook.data),
      bookingCode: room.bookingCode,
      requestId: extractRequestId(prebook.data) || requestId,
      checkin: searchBody.checkin,
      checkout: searchBody.checkout,
      rooms: [{ guests: [{ title: 'Mr', firstName: 'Rohan', lastName: 'Bhagat', type: 'Adult', isLead: true }] }],
      contact: {
        email: `gamma.cont.${Date.now()}@travelvip.ai`,
        countryCode: '+91',
        mobile: config.hotel.contactMobile,
        panCardNumber: 'EUIPB1672M',
        panCardName: 'Rohan Bhagat',
      },
    };
    const finalize = await hotel.finalizeBooking(body);
    const br = finalize.data?.bookingRefId || finalize.data?.bookingReferenceId;
    if (br) return { br, finalize, searchBody, hotelName: prebook.data?.results?.[0]?.name, room };
    console.log('fin fail', finalize.status, brief(finalize.data));
  }
  return { error: 'no br' };
}

async function wait(hotel, br, want, max = 12) {
  let last;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    console.log('  poll', i + 1, last.data?.status);
    if (new RegExp(want, 'i').test(String(last.data?.status || ''))) return last;
    await sleep(2500);
  }
  return last;
}

clearSession();
const { client, accessToken } = await authenticate(true);
const hotel = new HotelService(client);

let pendingBr = process.env.PENDING_BR || 'BR1795591857361986';
{
  const st = await hotel.getBookingStatus(pendingBr);
  console.log('existing', pendingBr, st.data?.status);
  if (!/Pending/i.test(String(st.data?.status || ''))) {
    const created = await findAndFinalize(hotel, { checkinDays: 50 });
    pendingBr = created.br;
    console.log('new pending', pendingBr, created.error || created.finalize?.data?.status);
    if (!pendingBr) {
      console.error('cannot get pending BR');
      process.exit(1);
    }
  }
}

console.log('\n=== A1.5 ===');
{
  const before = await hotel.getBookingStatus(pendingBr);
  const cb1 = await sendCallback(pendingBr, 'IN_PROGRESS');
  const mid = await hotel.getBookingStatus(pendingBr);
  const cb2 = await sendCallback(pendingBr, '');
  const after = await hotel.getBookingStatus(pendingBr);
  const unchanged = before.data?.status === mid.data?.status && mid.data?.status === after.data?.status;
  results['A1.5'] = {
    status: unchanged && (ignored(cb1) || ignored(cb2)) ? 'PASS' : (unchanged ? 'CHECK' : 'BUG'),
    br: pendingBr,
    before: before.data?.status,
    afterInProg: mid.data?.status,
    afterEmpty: after.data?.status,
    cbInProg: cb1.message,
    cbEmpty: cb2.message,
  };
  console.log(results['A1.5']);
}

console.log('\n=== A1.2 ===');
{
  const bal0 = await walletFeed(accessToken);
  const cb = await sendCallback(pendingBr, 'FAILED');
  const after = await wait(hotel, pendingBr, 'Failed|Confirmed|Cancelled');
  await sleep(4000);
  const bal1 = await walletFeed(accessToken);
  results['A1.2'] = {
    status: /Failed/i.test(String(after?.data?.status || '')) ? 'PASS' : 'BUG',
    br: pendingBr,
    callbackMsg: cb.message,
    applied: applied(cb),
    after: after?.data?.status,
    walletBefore: bal0,
    walletAfter: bal1,
  };
  console.log(results['A1.2']);

  const bal2 = await walletFeed(accessToken);
  const cb2 = await sendCallback(pendingBr, 'FAILED');
  await sleep(2500);
  const bal3 = await walletFeed(accessToken);
  const after2 = await hotel.getBookingStatus(pendingBr);
  results['A2.2'] = {
    status: /Failed/i.test(String(after2.data?.status || '')) && ignored(cb2) && Math.abs(Number(bal3) - Number(bal2)) < 1
      ? 'PASS'
      : 'CHECK',
    br: pendingBr,
    callbackMsg: cb2.message,
    ignored: ignored(cb2),
    after: after2.data?.status,
    walletBefore: bal2,
    walletAfter: bal3,
  };
  console.log(results['A2.2']);

  const cb3 = await sendCallback(pendingBr, 'CONFIRMED');
  await sleep(1500);
  const after3 = await hotel.getBookingStatus(pendingBr);
  results['A3.3'] = {
    status: /Failed/i.test(String(after3.data?.status || '')) && ignored(cb3) ? 'PASS' : 'BUG',
    br: pendingBr,
    callbackMsg: cb3.message,
    ignored: ignored(cb3),
    after: after3.data?.status,
    partnerWebhook: 'NOT TESTED',
  };
  console.log(results['A3.3']);
}

console.log('\n=== A1.3 CANCELLED ===');
{
  const created = await findAndFinalize(hotel, { checkinDays: 52 });
  if (!created.br) {
    results['A1.3a_CANCELLED'] = { status: 'NOT TESTED', note: created.error };
  } else {
    const cb = await sendCallback(created.br, 'CANCELLED');
    const after = await wait(hotel, created.br, 'Failed|Cancelled|Confirmed');
    results['A1.3a_CANCELLED'] = {
      status: /Failed|Cancelled/i.test(String(after?.data?.status || '')) ? 'PASS' : 'BUG',
      br: created.br,
      callbackMsg: cb.message,
      after: after?.data?.status,
    };
  }
  console.log(results['A1.3a_CANCELLED']);
}

console.log('\n=== A1.3 REJECTED ===');
{
  const created = await findAndFinalize(hotel, { checkinDays: 55 });
  if (!created.br) {
    results['A1.3b_REJECTED'] = { status: 'NOT TESTED', note: created.error };
  } else {
    const cb = await sendCallback(created.br, 'REJECTED');
    const after = await wait(hotel, created.br, 'Failed|Cancelled|Confirmed|Rejected');
    results['A1.3b_REJECTED'] = {
      status: /Failed|Cancelled|Rejected/i.test(String(after?.data?.status || '')) ? 'PASS' : 'BUG',
      br: created.br,
      callbackMsg: cb.message,
      after: after?.data?.status,
    };
  }
  console.log(results['A1.3b_REJECTED']);
}

console.log('\n=== A1.4 ===');
{
  const created = await findAndFinalize(hotel, { checkinDays: 58 });
  if (!created.br) {
    results['A1.4'] = { status: 'NOT TESTED', note: created.error };
  } else {
    const cb = await sendCallback(created.br, 'CONFIRMED');
    const after = await wait(hotel, created.br, 'Confirmed|Failed');
    results['A1.4'] = {
      status: /Confirmed/i.test(String(after?.data?.status || '')) ? 'PASS' : 'BUG',
      br: created.br,
      finalizeStatus: created.finalize?.data?.status,
      callbackMsg: cb.message,
      after: after?.data?.status,
    };
  }
  console.log(results['A1.4']);
}

console.log('\n=== A4.2 ===');
{
  const br = 'BR1795591661138485';
  const bal0 = await walletFeed(accessToken);
  const before = await hotel.getBookingStatus(br);
  const cb = await sendCallback(br, 'CANCELLED');
  await sleep(3000);
  const bal1 = await walletFeed(accessToken);
  const after = await hotel.getBookingStatus(br);
  results['A4.2'] = {
    status: /Cancel/i.test(String(after.data?.status || ''))
      && ignored(cb)
      && Math.abs(Number(bal1) - Number(bal0)) < 1
      ? 'PASS'
      : 'CHECK',
    br,
    before: before.data?.status,
    callbackMsg: cb.message,
    ignored: ignored(cb),
    after: after.data?.status,
    walletBefore: bal0,
    walletAfter: bal1,
  };
  console.log(results['A4.2']);
}

console.log('\n=== A4.1 ===');
{
  const created = await findAndFinalize(hotel, { checkinDays: 62, preferNonRef: true });
  if (!created.br) {
    results['A4.1'] = { status: 'NOT TESTED', note: created.error };
  } else {
    await sendCallback(created.br, 'CONFIRMED');
    const conf = await wait(hotel, created.br, 'Confirmed|Failed');
    if (!/Confirmed/i.test(String(conf?.data?.status || ''))) {
      results['A4.1'] = { status: 'NOT TESTED', note: 'could not confirm', br: created.br, after: conf?.data?.status };
    } else {
      await sleep(6000);
      const still = await hotel.getBookingStatus(created.br);
      if (!/Confirmed/i.test(String(still.data?.status || ''))) {
        results['A4.1'] = { status: 'NOT TESTED', note: `flipped to ${still.data?.status}`, br: created.br };
      } else {
        const penalty = await hotel.penaltyCheck(created.br);
        const penCr = penalty.data?.data?.cancellationRequest || penalty.data?.cancellationRequest;
        const bal0 = await walletFeed(accessToken);
        const cancel = await hotel.cancelBooking(created.br);
        await sleep(3000);
        const afterCancel = await hotel.getBookingStatus(created.br);
        const bal1 = await walletFeed(accessToken);
        const cb = await sendCallback(created.br, 'CANCELLED');
        await sleep(2500);
        const bal2 = await walletFeed(accessToken);
        const afterCb = await hotel.getBookingStatus(created.br);
        results['A4.1'] = {
          status: /Cancel/i.test(String(afterCb.data?.status || ''))
            && ignored(cb)
            && Math.abs(Number(bal2) - Number(bal1)) < 1
            ? 'PASS'
            : 'CHECK',
          br: created.br,
          estimatedRefund: penCr?.estimatedRefund,
          estimatedCharge: penCr?.estimatedCancellationCharge,
          cancelHttp: cancel.status,
          afterCancel: afterCancel.data?.status,
          callbackMsg: cb.message,
          afterCallback: afterCb.data?.status,
          walletDeltaCancel: bal0 != null && bal1 != null ? Number(bal1) - Number(bal0) : null,
          walletAfterCallback: bal2,
        };
      }
    }
  }
  console.log(results['A4.1']);
}

let partB = prev.partB;
const files = fs.readdirSync(OUT).filter((f) => f.startsWith('run-') && f.endsWith('.json')).sort();
for (const f of files.reverse()) {
  const j = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  if (j.partB?.results) {
    partB = j.partB;
    break;
  }
}

const report = {
  at: new Date().toISOString(),
  baseUrl: BASE,
  part: 'A-continue+B-merged',
  callback: { pid: CALLBACK_PID, keyPreview: 'pals…' },
  partA: { results },
  partB,
};
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, `run-${Date.now()}.json`), JSON.stringify(report, null, 2));

console.log('\n===== PART A CONTINUATION =====');
for (const [k, v] of Object.entries(results)) {
  console.log(`${k}\t${v.status}\t${v.br || '-'}\t${(v.note || v.after || v.callbackMsg || '').toString().slice(0, 70)}`);
}

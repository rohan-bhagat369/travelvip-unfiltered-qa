import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { HotelService } from '../service.js';
import {
  buildSearchBody,
  extractBookingContext,
  extractRequestId,
  isPrebookSuccess,
  isTerminalHotelStatus,
} from '../helpers.js';
import { sleep } from '../../../../shared/lib/testUtils.js';
import {
  GST,
  HILLTOP,
  PAN_ROHAN,
  uniqueEmail,
  vendorLeak,
} from './fixtures.js';

export async function openHotelSession() {
  if (!process.env.TIER_ID) process.env.TIER_ID = '10546901';
  if (String(process.env.TIER_ID).trim() === '') process.env.TIER_ID = '10546901';
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();

  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  if (session.accessToken) session.client.setPartnerKey(session.accessToken);
  return {
    client: session.client,
    hotel: new HotelService(session.client),
    corrId: process.env.CORRELATION_ID,
    calls: [],
  };
}

export function noteCall(ctx, step, path, res) {
  const rec = {
    step,
    path,
    http: res?.status ?? null,
    ok: Boolean(res?.ok),
    sentCorrelationId: res?.sentCorrelationId || ctx.corrId,
    responseCorrelationId: res?.data?._meta?.correlation_id || null,
  };
  rec.sentPinned = rec.sentCorrelationId === ctx.corrId;
  rec.responseMatchesPinned = rec.responseCorrelationId
    ? rec.responseCorrelationId === ctx.corrId
    : null;
  rec.errorCode = res?.data?.error?.code || null;
  ctx.calls.push(rec);
  return rec;
}

export function availableRooms(details) {
  return (details?.data?.results?.[0]?.rooms || [])
    .filter((r) => r?.bookingCode && r.available !== false)
    .sort((a, b) => (a.price?.totalAmount ?? 1e12) - (b.price?.totalAmount ?? 1e12));
}

export function leakScan(label, data) {
  const blob = JSON.stringify(data ?? {});
  const codes = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.bookingCode === 'string') codes.push(node.bookingCode);
    if (Array.isArray(node)) node.forEach(walk);
    else Object.values(node).forEach((v) => { if (v && typeof v === 'object') walk(v); });
  };
  walk(data);
  const leaked = codes.filter((c) => vendorLeak(c));
  return {
    label,
    leakedCodes: leaked.slice(0, 5),
    leakCount: leaked.length,
    jsonHasRiyaToken: vendorLeak(blob) && leaked.length > 0,
    sample: codes[0] || null,
  };
}

export async function hilltopSearchDetails(hotel, { checkinDays = 28, nights = 1 } = {}) {
  const searchBody = buildSearchBody({
    entityId: HILLTOP.entityId,
    checkinDays,
    nights,
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  });
  searchBody.type = 'HOTEL';
  searchBody.nationality = 'IN';
  const search = await hotel.search(searchBody, { pid: process.env.HOTEL_PID || process.env.FLIGHT_ISSUE_PID || 'vgm' });
  const details = await hotel.getDetails(searchBody);
  const rooms = availableRooms(details);
  const requestId = extractRequestId(details.data) || extractRequestId(search.data);
  return {
    searchBody,
    search,
    details,
    rooms,
    requestId,
    hotelName: details.data?.results?.[0]?.name || HILLTOP.name,
  };
}

export async function waitTerminal(hotel, br, { max = 18, intervalMs = 4000 } = {}) {
  let last = null;
  for (let i = 0; i < max; i += 1) {
    last = await hotel.getBookingStatus(br);
    const st = String(last.data?.status || '');
    if (last.ok && isTerminalHotelStatus(st)) return last;
    if (/inprogress|in.progress/i.test(st) && i >= 2) return last;
    await sleep(intervalMs);
  }
  return last;
}

export function buildFinalizeBodyFromStay({
  stay,
  room,
  requestId,
  prebook,
  firstName = 'Rohan',
  lastName = 'Bhagat',
  pan = PAN_ROHAN,
  includePan = true,
  includeGst = true,
  email,
}) {
  const body = {
    bookingContext: extractBookingContext(prebook.data),
    bookingCode: room.bookingCode,
    requestId,
    checkin: stay.searchBody.checkin,
    checkout: stay.searchBody.checkout,
    rooms: [{
      guests: [{
        title: 'Mr',
        firstName,
        lastName,
        type: 'Adult',
        isLead: true,
      }],
    }],
    contact: {
      email: email || uniqueEmail(),
      countryCode: '+91',
      mobile: '9876543210',
    },
  };
  if (includePan && pan) {
    body.contact.panCardNumber = pan.panCardNumber;
    if (pan.panCardName != null) body.contact.panCardName = pan.panCardName;
  }
  const gstNeeded = room.isGSTClaimable || room.isGstClaimable;
  if (includeGst && gstNeeded) body.gstDetails = { ...GST };
  return body;
}

export async function prebookRoom(hotel, stay, room) {
  return hotel.prebook({ bookingCode: room.bookingCode, requestId: stay.requestId });
}

export { uniqueEmail, isPrebookSuccess, extractBookingContext };

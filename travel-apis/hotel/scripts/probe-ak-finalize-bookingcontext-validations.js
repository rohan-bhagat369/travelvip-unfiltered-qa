/**
 * ak-api: Hotel Finalize bookingContext validations
 * POST /api/v2/hotels/finalize-booking (also records /v1 result if needed)
 *
 * bookingContext → VALIDATION_ERROR when empty / null / "0" / invalid
 *
 * Run:
 *   BASE_URL=https://ak-api.travelvip.ai node travel-apis/hotel/scripts/probe-ak-finalize-bookingcontext-validations.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HotelService } from '../src/service.js';
import {
  HOTEL_QUERY,
  buildSearchBody,
  extractRequestId,
  extractBookingCodes,
  extractBookingContext,
} from '../src/helpers.js';
import { GST as GST_FIXTURE } from '../src/regression/fixtures.js';

const OUT = path.join(
  'reports',
  process.env.AK_HOTEL_VAL_OUT || 'ak-hotel-finalize-bookingcontext-validations.json',
);
const FIN_PATH = process.env.HOTEL_FIN_PATH || '/api/v2/hotels/finalize-booking';

function brief(d, n = 500) {
  try {
    return JSON.stringify(d).slice(0, n);
  } catch {
    return String(d);
  }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function detailsArr(r) {
  const d = r?.data?.error?.details;
  if (Array.isArray(d)) return d.map(String);
  if (d == null) return [];
  return [String(d)];
}
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function adultGuest(overrides = {}) {
  return {
    title: 'Mr',
    firstName: config.hotel.guestFirstName || 'Rohan',
    lastName: config.hotel.guestLastName || 'Bhagat',
    type: 'Adult',
    isLead: true,
    ...overrides,
  };
}

function contactBase() {
  return {
    email: config.hotel.contactEmail,
    mobile: config.hotel.contactMobile,
    countryCode: config.hotel.contactCountryCode,
    panCardNumber: 'EUIPB1672M',
    panCardName: `${config.hotel.guestFirstName || 'Rohan'} ${config.hotel.guestLastName || 'Bhagat'}`,
  };
}

function scoreReject(id, rule, mutation, res) {
  const http = res?.status ?? 0;
  const code = errCode(res);
  const details = detailsArr(res);
  const text = `${details.join(' | ')} | ${res?.data?.error?.message || ''}`;
  let status = 'BUG';
  let note = '';
  if (http >= 500) {
    status = 'BUG';
    note = `HTTP ${http} — must be 4xx VALIDATION_ERROR`;
  } else if (http >= 400 && http < 500 && code === 'VALIDATION_ERROR') {
    status = 'PASS';
    note = /bookingContext|empty|blank|required|invalid/i.test(text)
      ? `VALIDATION_ERROR ${text.slice(0, 180)}`
      : `VALIDATION_ERROR (soft detail) ${text.slice(0, 180)}`;
  } else if (http >= 400 && http < 500 && code) {
    status = 'PASS';
    note = `Rejected HTTP ${http} code=${code}`;
  } else if (http >= 200 && http < 300 && !code) {
    status = 'BUG';
    note = 'Accepted invalid bookingContext';
  } else {
    status = 'BUG';
    note = `Unexpected HTTP ${http} code=${code}`;
  }
  console.log(`[${status}] ${id} ${rule} → HTTP ${http} ${code || ''}`);
  return {
    id,
    kind: 'negative',
    field: 'bookingContext',
    rule,
    mutation,
    status,
    note,
    http,
    code,
    details,
    snippet: brief(res?.data, 350),
  };
}

function scorePositive(id, rule, res) {
  const http = res?.status ?? 0;
  const code = errCode(res);
  let status = 'PASS';
  let note = `HTTP ${http} code=${code || 'none'}`;
  if (http >= 500) {
    status = 'BUG';
    note = `HTTP ${http}`;
  } else if (http === 400 && code === 'VALIDATION_ERROR') {
    status = 'BUG';
    note = `Unexpected VALIDATION_ERROR on valid bookingContext: ${detailsArr(res).join(' | ').slice(0, 160)}`;
  }
  console.log(`[${status}] ${id} ${rule} → HTTP ${http} ${code || ''}`);
  return {
    id,
    kind: 'positive',
    field: 'bookingContext',
    rule,
    status,
    note,
    http,
    code,
    details: detailsArr(res),
    snippet: brief(res?.data, 350),
    br: res?.data?.bookingRefId || res?.data?.bookingReferenceId || null,
  };
}

async function main() {
  console.log('BASE', config.baseUrl);
  console.log('Finalize', FIN_PATH);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);

  let finBase = null;
  let prebookMeta = null;

  // Prefer Hilltop Mumbai HOTEL (same fixture as staging pack); fallback CITY Mumbai from autocomplete
  const targets = [{ entityId: '39627872', type: 'HOTEL', label: 'Hilltop' }];
  try {
    const ac = await hotel.autocomplete('mumbai', 0, 20);
    const city = (ac?.data?.content || []).find((h) => String(h.type).toUpperCase() === 'CITY' && /mumbai/i.test(h.name || ''));
    if (city?.entityId) targets.push({ entityId: String(city.entityId), type: 'CITY', label: city.name });
  } catch {
    /* ignore autocomplete miss */
  }

  const dayCandidates = [28, 35, 21, 42, 45];
  outer: for (const target of targets) {
    for (const days of dayCandidates) {
      const body = buildSearchBody({
        entityId: target.entityId,
        checkinDays: days,
        nights: 2,
        rooms: [{ adults: 2, children: 0, childrenAges: [] }],
      });
      body.type = target.type;
      body.rooms[0].adults = 2;
      body.rooms[0].children = 0;
      console.log('search', target.label, target.type, body.entityId, 'checkin', body.checkin);
      const sRes = await hotel.search(body);
      if (!(sRes.ok || (sRes.status >= 200 && sRes.status < 300))) {
        console.log('search fail', sRes.status, errCode(sRes));
        continue;
      }
      // For CITY search, pick first hotel entity from results then details that hotel
      let detailsBody = { ...body };
      if (target.type === 'CITY') {
        const hotels = sRes.data?.results || sRes.data?.content || [];
        const first = hotels.find((h) => h.entityId || h.id) || hotels[0];
        const hid = first?.entityId || first?.id;
        if (!hid) {
          console.log('CITY search had no hotel hits');
          continue;
        }
        detailsBody = { ...body, entityId: String(hid), type: 'HOTEL' };
        console.log('CITY→hotel', detailsBody.entityId);
      }
      const dRes = await hotel.getDetails(detailsBody);
      const rid = extractRequestId(dRes.data);
      const codes = extractBookingCodes(dRes.data, 12);
      console.log('details', dRes.status, 'requestId', rid, 'codes', codes.length);
      for (const code of codes) {
        const pre = await hotel.prebook({ bookingCode: code, requestId: rid });
        const ctx = extractBookingContext(pre.data);
        if (!ctx) continue;
        prebookMeta = {
          target: target.label,
          code: String(code).slice(0, 40),
          rid,
          ctxLen: String(ctx).length,
          checkin: detailsBody.checkin,
          checkout: detailsBody.checkout,
        };
        finBase = {
          bookingContext: ctx,
          bookingCode: code,
          requestId: rid,
          checkin: detailsBody.checkin,
          checkout: detailsBody.checkout,
          rooms: [
            {
              guests: [
                adultGuest({ isLead: true, firstName: 'Rohan', lastName: 'Bhagat' }),
                adultGuest({ isLead: false, firstName: 'Amit', lastName: 'Sharma', title: 'Mr' }),
              ],
            },
          ],
          contact: contactBase(),
          gstDetails: { ...GST_FIXTURE },
        };
        console.log('Prebook OK', prebookMeta);
        break outer;
      }
    }
  }

  if (!finBase) throw new Error('Could not prebook a hotel on this BASE_URL for finalize baseline');

  const finalize = (body) =>
    client.request({
      method: 'POST',
      path: FIN_PATH,
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body,
      correlation: true,
      partnerKey: client.partnerKey,
    });

  const rows = [];

  // Positive: valid bookingContext
  {
    const b = clone(finBase);
    b.contact.email = `hotel.ak.pos.${Date.now()}@travelvip.ai`;
    const res = await finalize(b);
    rows.push(scorePositive('P1', 'valid bookingContext from prebook is not field VALIDATION_ERROR', res));
  }

  const badValues = [
    { key: 'empty', value: '' },
    { key: 'null', value: null },
    { key: 'zero-string', value: '0' },
    { key: 'invalid', value: 'NOT_A_REAL_BOOKING_CONTEXT' },
  ];

  for (const bv of badValues) {
    const b = clone(finBase);
    b.bookingContext = bv.value;
    b.contact.email = `hotel.ak.${bv.key}.${Date.now()}@travelvip.ai`;
    const res = await finalize(b);
    rows.push(
      scoreReject(
        `CTX-${bv.key}`,
        `bookingContext=${JSON.stringify(bv.value)} → validation error`,
        bv.key,
        res,
      ),
    );
  }

  {
    const b = clone(finBase);
    delete b.bookingContext;
    b.contact.email = `hotel.ak.omit.${Date.now()}@travelvip.ai`;
    const res = await finalize(b);
    rows.push(scoreReject('CTX-omit', 'bookingContext omitted → validation error', 'omit', res));
  }

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    at: new Date().toISOString(),
    baseUrl: config.baseUrl,
    finalizePath: FIN_PATH,
    prebookMeta,
    counts,
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const domainOut = path.join('travel-apis', 'hotel', OUT);
  fs.mkdirSync(path.dirname(domainOut), { recursive: true });
  fs.writeFileSync(domainOut, JSON.stringify(summary, null, 2));
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('COUNTS', counts);
  console.log('WROTE', domainOut);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

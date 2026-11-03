/**
 * ak-api gap suite: hotel finalize bookingContext edges
 * - Wrong types, whitespace, HTML/special
 * - Stale / foreign bookingContext (other prebook)
 *
 * Single baseline: Hilltop 39627872, checkinDays=28 (no date loop).
 *
 *   BASE_URL=https://ak-api.travelvip.ai node travel-apis/hotel/scripts/probe-ak-finalize-bookingcontext-validations-edge.js
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
  'travel-apis',
  'hotel',
  'reports',
  'ak-hotel-finalize-bookingcontext-validations-edge.json',
);
const FIN_PATH = process.env.HOTEL_FIN_PATH || '/api/v2/hotels/finalize-booking';

function brief(d, n = 400) {
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
function contactBase(tag) {
  return {
    email: `hotel.ak.edge.${tag}.${Date.now()}@travelvip.ai`,
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
    note = `HTTP ${http} — must be 4xx + error.code`;
  } else if (http >= 400 && http < 500 && code === 'VALIDATION_ERROR') {
    status = 'PASS';
    note = /bookingContext|invalid|required|decrypt|empty|blank|type/i.test(text)
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
  console.log(`[${status}] ${id} → HTTP ${http} ${code || ''}`);
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
    snippet: brief(res?.data),
  };
}

async function main() {
  console.log('BASE', config.baseUrl);
  const session = await authenticate(true);
  const client = session.client;
  const hotel = new HotelService(client);

  const body = buildSearchBody({
    entityId: '39627872',
    checkinDays: 28,
    nights: 2,
    rooms: [{ adults: 2, children: 0, childrenAges: [] }],
  });
  body.type = 'HOTEL';
  console.log('search Hilltop', body.checkin);
  const sRes = await hotel.search(body);
  if (!(sRes.ok || (sRes.status >= 200 && sRes.status < 300))) {
    throw new Error(`search failed ${sRes.status} ${errCode(sRes)}`);
  }
  const dRes = await hotel.getDetails(body);
  const rid = extractRequestId(dRes.data);
  const codes = extractBookingCodes(dRes.data, 12);
  if (!codes.length) throw new Error('details returned 0 booking codes');

  const preA = await hotel.prebook({ bookingCode: codes[0], requestId: rid });
  const ctxA = extractBookingContext(preA.data);
  if (!ctxA) throw new Error('prebook A had no bookingContext');

  let ctxB = null;
  let codeB = codes[1] || null;
  if (codeB) {
    const preB = await hotel.prebook({ bookingCode: codeB, requestId: rid });
    ctxB = extractBookingContext(preB.data);
  }

  const finBase = {
    bookingContext: ctxA,
    bookingCode: codes[0],
    requestId: rid,
    checkin: body.checkin,
    checkout: body.checkout,
    rooms: [
      {
        guests: [
          adultGuest({ isLead: true, firstName: 'Rohan', lastName: 'Bhagat' }),
          adultGuest({ isLead: false, firstName: 'Amit', lastName: 'Sharma', title: 'Mr' }),
        ],
      },
    ],
    contact: contactBase('base'),
    gstDetails: { ...GST_FIXTURE },
  };
  console.log('Prebook OK', { rid, codeA: String(codes[0]).slice(0, 24), hasCtxB: Boolean(ctxB) });

  const finalize = (payload) =>
    client.request({
      method: 'POST',
      path: FIN_PATH,
      query: { ...HOTEL_QUERY, page: 0, perpage: 20 },
      body: payload,
      correlation: true,
      partnerKey: client.partnerKey,
    });

  const rows = [];
  const edges = [
    { key: 'whitespace', value: '   ' },
    { key: 'html', value: '<script>alert(1)</script>' },
    { key: 'num-zero', value: 0 },
    { key: 'bool-true', value: true },
    { key: 'obj', value: {} },
    { key: 'arr', value: [] },
    { key: 'truncated', value: String(ctxA).slice(0, 12) },
  ];
  for (const bv of edges) {
    const b = clone(finBase);
    b.bookingContext = bv.value;
    b.contact = contactBase(bv.key);
    const res = await finalize(b);
    rows.push(
      scoreReject(
        `CTX-${bv.key}`,
        `bookingContext=${typeof bv.value === 'string' ? JSON.stringify(bv.value) : JSON.stringify(bv.value)} → validation error`,
        bv.key,
        res,
      ),
    );
  }

  // Foreign: ctx from prebook B with bookingCode from A (or swapped)
  if (ctxB && codeB) {
    const b = clone(finBase);
    b.bookingContext = ctxB;
    b.bookingCode = codes[0];
    b.contact = contactBase('foreign');
    const res = await finalize(b);
    rows.push(
      scoreReject(
        'CTX-foreign',
        'bookingContext from other prebook + mismatched bookingCode → reject',
        'foreign',
        res,
      ),
    );
  } else {
    rows.push({
      id: 'CTX-foreign',
      kind: 'negative',
      field: 'bookingContext',
      rule: 'bookingContext from other prebook + mismatched bookingCode → reject',
      mutation: 'foreign',
      status: 'NOT TESTED',
      note: 'Only one booking code available from details',
      http: null,
      code: null,
      details: [],
    });
    console.log('[NOT TESTED] CTX-foreign — need 2 booking codes');
  }

  // Stale: consume ctxA with a finalize, then reuse same ctxA
  {
    const first = clone(finBase);
    first.contact = contactBase('stale-consume');
    await finalize(first);
    const reuse = clone(finBase);
    reuse.contact = contactBase('stale-reuse');
    const res = await finalize(reuse);
    rows.push(
      scoreReject(
        'CTX-stale-reuse',
        'reuse bookingContext after a prior finalize → reject (or business error, not 500)',
        'stale-reuse',
        res,
      ),
    );
  }

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    at: new Date().toISOString(),
    baseUrl: config.baseUrl,
    finalizePath: FIN_PATH,
    suite: 'edge-gap',
    prebookMeta: {
      target: 'Hilltop',
      rid,
      checkin: body.checkin,
      checkout: body.checkout,
      codes: codes.length,
    },
    counts,
    rows,
    bugs: rows.filter((r) => r.status === 'BUG'),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('COUNTS', counts);
  console.log('WROTE', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

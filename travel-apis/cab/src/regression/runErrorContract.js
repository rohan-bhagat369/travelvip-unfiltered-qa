/**
 * Run Cab API Error Contract validations (catalog-driven).
 * Used by scripts/probe-cab-error-contract.js and future cab regression pack.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../../shared/lib/authService.js';
import { config } from '../../../../shared/config/env.js';
import {
  CAB_QUERY,
  buildAirportSearchBody,
  buildFinalizeBody,
  buildRentalSearchBody,
  pickCab,
} from '../helpers.js';
import { CAB_ERROR_CONTRACT_CASES, CAB_ERROR_CONTRACT_SOURCE, casesByTag } from './errorContractCases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEBHOOK_USER = process.env.CAB_WEBHOOK_USER || '';
const WEBHOOK_PASS = process.env.CAB_WEBHOOK_PASS || '';
const FIXTURE_BR = process.env.CAB_BOOKING_REF || '';

function codeOf(data) {
  return data?.error?.code || null;
}

function msgOf(data) {
  return data?.error?.message || data?.message || null;
}

function score(meta, res, { expectHttp, expectCode, extraPass } = {}) {
  const http = res?.status;
  const code = codeOf(res?.data);
  const passHttp = Array.isArray(expectHttp) ? expectHttp.includes(http) : http === expectHttp;
  const passCode = expectCode == null ? true : code === expectCode;
  let status = passHttp && passCode ? 'PASS' : 'BUG';
  if (typeof extraPass === 'function') {
    status = extraPass(res, { passHttp, passCode, status }) ? 'PASS' : 'BUG';
  }
  return {
    ...meta,
    expectHttp,
    expectCode,
    actualHttp: http ?? null,
    actualCode: code,
    actualMessage: msgOf(res?.data),
    status,
    body: res?.data ?? null,
  };
}

function skip(meta, reason) {
  return {
    ...meta,
    expectHttp: meta.expectHttp ?? null,
    expectCode: meta.expectCode ?? null,
    actualHttp: null,
    actualCode: null,
    actualMessage: null,
    status: 'NOT TESTED',
    note: reason,
    body: null,
  };
}

async function req(client, { method = 'GET', path: p, query = {}, body, partnerKey }) {
  return client.request({
    method,
    path: p,
    query: { ...CAB_QUERY, ...query },
    body,
    partnerKey: partnerKey ?? client.partnerKey,
  });
}

async function webhook(body, { user = WEBHOOK_USER, pass = WEBHOOK_PASS, omitAuth = false } = {}) {
  const url = new URL('/v1/airportServices/cabs/partner-webhook', config.baseUrl);
  url.searchParams.set('lang', 'en');
  const headers = { 'Content-Type': 'application/json' };
  if (!omitAuth && user && pass) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function bookCab(client) {
  const search = await req(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/search',
    body: buildAirportSearchBody(),
  });
  const cab = pickCab(search.data?.cabs);
  if (!cab?.searchId) return null;
  const fare = await req(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/fare',
    body: { searchId: cab.searchId },
  });
  const { bookingReference, priceId } = fare.data || {};
  if (!bookingReference || !priceId) return null;
  const fin = await req(client, {
    method: 'POST',
    path: '/v1/airportServices/cabs/finalize-booking',
    body: buildFinalizeBody({ bookingReference, priceId }),
  });
  return {
    br: fin.data?.bookingRefId || fin.data?.bookingReferenceId,
    status: fin.data?.status,
  };
}

function metaOf(c) {
  return {
    id: c.id,
    section: c.section,
    tag: c.tag,
    api: c.api,
    how: c.rule,
    note: c.note || '',
  };
}

/**
 * Execute one catalog case. Returns a result row.
 */
async function runOne(client, c, ctx) {
  const m = metaOf(c);

  switch (c.id) {
    case 'LOC-1':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/locations' }), c);
    case 'LOC-2':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/locations', query: { latitude: 18.5 } }), c);
    case 'LOC-3':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/locations', query: { latitude: 'abc', longitude: 73 } }), c);
    case 'LOC-4':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/locations', query: { latitude: 999, longitude: 999 } }), c);

    case 'SR-1':
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: {} }), c);
    case 'SR-2': {
      const b = buildAirportSearchBody();
      delete b.journeyType;
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-3': {
      const b = buildAirportSearchBody();
      b.journeyType = 'TAXI';
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-4': {
      const b = buildAirportSearchBody();
      b.travelType = 'INVALID';
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-5': {
      const b = buildAirportSearchBody();
      delete b.airportCode;
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-6': {
      const b = buildAirportSearchBody();
      b.pickup.latitude = 999;
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-7': {
      const b = buildAirportSearchBody();
      b.distanceKm = -5;
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-8': {
      const b = buildAirportSearchBody();
      b.pickupDatetime = '2020-01-01T10:00:00Z';
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-9': {
      const b = buildRentalSearchBody();
      b.drop.latitude = 18.9999;
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }
    case 'SR-10': {
      const b = buildRentalSearchBody();
      b.durationMin = 300;
      b.distanceKm = 55;
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/search', body: b }), c);
    }

    case 'FR-1':
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/fare', body: {} }), c);
    case 'FR-2':
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/fare', body: { searchId: '' } }), c);
    case 'FR-3':
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/fare', body: { searchId: 'not-real' } }), c);

    case 'FB-1':
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/finalize-booking', body: {} }), c);
    case 'FB-2':
      return score(m, await req(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/finalize-booking',
        body: buildFinalizeBody({ bookingReference: 'INVALID_REF', priceId: 'x' }),
      }), c);
    case 'FB-3': {
      const b = buildFinalizeBody({ bookingReference: 'INVALID_REF', priceId: 'invalid-price-id' });
      const r = await req(client, { method: 'POST', path: '/v1/airportServices/cabs/finalize-booking', body: b });
      const created = r.data?.bookingRefId || r.data?.bookingReferenceId;
      return score(m, r, {
        ...c,
        extraPass: () => !created && r.status === 400 && codeOf(r.data) === 'VALIDATION_ERROR',
      });
    }
    case 'FB-4': {
      const b = buildFinalizeBody({ bookingReference: 'INVALID_REF', priceId: 'x' });
      b.contact.email = 'not-an-email';
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/finalize-booking', body: b }), c);
    }

    case 'UB-1':
      return score(m, await req(client, { method: 'POST', path: '/v1/airportServices/cabs/update-booking', body: {} }), c);
    case 'UB-2':
      return score(m, await req(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/update-booking',
        body: { status: 'CONFIRMED', bookingId: 'X' },
      }), c);
    case 'UB-3':
      return score(m, await req(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/update-booking',
        body: { bookingRefId: 'BR_FAKE', status: 'CANCELED', bookingId: 'X' },
      }), c);
    case 'UB-4':
      return score(m, await req(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/update-booking',
        body: { bookingRefId: 'BR_NOT_REAL_000', status: 'CONFIRMED', bookingId: 'X' },
      }), c);
    case 'UB-5': {
      const br = FIXTURE_BR || ctx.bookedBr;
      if (!br) return skip(m, 'Set CAB_BOOKING_REF on this env (or allow LIVE book first)');
      return score(m, await req(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/update-booking',
        body: { bookingRefId: br, status: 'CONFIRMED', bookingId: 'WRONG_ID', providerBookingId: 'WRONG_ID' },
      }), c);
    }

    case 'WH-1': {
      if (!WEBHOOK_USER || !WEBHOOK_PASS) return skip(m, 'Set CAB_WEBHOOK_USER + CAB_WEBHOOK_PASS');
      return score(m, await webhook({}), c);
    }
    case 'WH-2': {
      const wh = await webhook({ eventName: 'TEST' }, { user: 'bad', pass: 'bad' });
      const code = codeOf(wh.data);
      return score(m, wh, {
        ...c,
        extraPass: () => (
          (wh.status === 401 && code === 'INVALID_WEBHOOK_CREDENTIALS')
          || (wh.status === 403 && code === 'WEBHOOK_IP_NOT_ALLOWED')
        ),
      });
    }

    case 'ST-1':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/!!!/status' }), c);
    case 'ST-2':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/ROHAN/status' }), c);
    case 'DT-1':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/booking/!!!' }), c);
    case 'DT-2':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/booking/ROHAN' }), c);
    case 'TR-1':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/tracking/!!!/location' }), c);
    case 'TR-2':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/tracking/ROHAN/location' }), c);

    case 'HI-1':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/booking/history', query: { page: 0, perpage: 10 } }), c);
    case 'HI-2':
      return score(m, await req(client, {
        path: '/v1/airportServices/cabs/booking/history',
        query: { userId: '1', page: -1, perpage: 0 },
      }), c);

    case 'CA-1':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/bookings/!!!/cancel' }), c);
    case 'CA-2':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/bookings/ROHAN/cancel' }), c);
    case 'CA-3':
      return score(m, await req(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/bookings/ROHAN/cancel',
        body: { cancelledBy: 'AGENT' },
      }), c);
    case 'CA-4':
      return score(m, await req(client, {
        method: 'POST',
        path: '/v1/airportServices/cabs/bookings/ROHAN/cancel',
        body: { cancelledBy: 'USER', cancellationReason: 'x'.repeat(501) },
      }), c);
    case 'CA-5': {
      const booked = ctx.booked || await bookCab(client);
      ctx.booked = booked;
      if (booked?.br) ctx.bookedBr = booked.br;
      if (!booked?.br) return skip(m, 'Could not book cab for cancel guard');
      const st = await req(client, { path: `/v1/airportServices/cabs/${booked.br}/status` });
      const bookingStatus = st.data?.status || booked.status;
      const cancel = await req(client, { path: `/v1/airportServices/cabs/bookings/${booked.br}/cancel` });
      const row = score({ ...m, how: `${bookingStatus} BR ${booked.br}` }, cancel, {
        expectHttp: 400,
        expectCode: String(bookingStatus).toLowerCase() === 'pending' ? 'BOOKING_NOT_CANCELLABLE' : null,
        extraPass: () => cancel.status === 400,
      });
      return row;
    }

    case 'FLT-LOC-Q': {
      const r = await req(client, { path: '/v1/airportServices/cabs/locations', query: { query: 'Delhi' } });
      const arr = Array.isArray(r.data) ? r.data : (r.data?.locations || []);
      return score(m, r, {
        ...c,
        extraPass: () => r.status === 200 && arr.length > 0,
      });
    }
    case 'FLT-LOC-XY': {
      const r = await req(client, {
        path: '/v1/airportServices/cabs/locations',
        query: { latitude: 18.5518, longitude: 73.9467 },
      });
      const arr = Array.isArray(r.data) ? r.data : (r.data?.locations || []);
      return score(m, r, {
        ...c,
        extraPass: () => r.status === 200 && arr.length > 0,
      });
    }
    case 'FLT-LOC-AIR':
      return score(m, await req(client, {
        path: '/v1/airportServices/cabs/locations',
        query: { airportCode: 'DEL' },
      }), c);
    case 'FLT-PLACE-OK': {
      const r = await req(client, {
        path: '/v1/airportServices/cabs/places/autocomplete',
        query: { searchText: 'viman nagar' },
      });
      const n = (r.data?.suggestions || []).length;
      return score(m, r, {
        ...c,
        extraPass: () => r.status === 200 && n > 0,
      });
    }
    case 'FLT-PLACE-MISS':
      return score(m, await req(client, { path: '/v1/airportServices/cabs/places/autocomplete', query: {} }), c);

    default:
      return skip(m, `No executor for ${c.id}`);
  }
}

/**
 * @param {{ tags?: string[], outPath?: string, quiet?: boolean }} opts
 */
export async function runCabErrorContract(opts = {}) {
  const tags = opts.tags?.length ? opts.tags : ['VALIDATE', 'FILTERS', 'LIVE'];
  const cases = casesByTag(tags);
  const { client } = await authenticate();
  const ctx = {};
  const rows = [];

  for (const c of cases) {
    // Run LIVE book once before CA-5 / UB-5 if needed
    if ((c.id === 'CA-5' || c.id === 'UB-5') && !ctx.booked && tags.includes('LIVE')) {
      ctx.booked = await bookCab(client);
      if (ctx.booked?.br) ctx.bookedBr = ctx.booked.br;
    }
    rows.push(await runOne(client, c, ctx));
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    source: CAB_ERROR_CONTRACT_SOURCE,
    baseUrl: process.env.BASE_URL || config.baseUrl,
    generatedAt: new Date().toISOString(),
    tags,
    catalogSize: CAB_ERROR_CONTRACT_CASES.length,
    counts,
    rows,
  };

  const outPath = opts.outPath || path.join(__dirname, '..', '..', '..', 'reports', 'cab-error-contract-validations.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (!opts.quiet) {
    console.log(`\n=== Cab Error Contract @ ${report.baseUrl} ===`);
    console.log(`Catalog ${report.catalogSize} | ran ${rows.length} | PASS ${counts.PASS || 0} | BUG ${counts.BUG || 0} | NOT TESTED ${counts['NOT TESTED'] || 0}\n`);
    let sec = '';
    for (const r of rows) {
      if (r.section !== sec) {
        sec = r.section;
        console.log(`\n--- §${sec} ---`);
      }
      const exp = r.expectCode != null ? `HTTP ${JSON.stringify(r.expectHttp)} ${r.expectCode}` : `HTTP ${JSON.stringify(r.expectHttp)}`;
      console.log(`${String(r.status).padEnd(11)} ${r.id} | expect ${exp} | got HTTP ${r.actualHttp ?? '-'} ${r.actualCode || ''}`);
      if (r.status === 'BUG') console.log(`            ${r.actualMessage || r.note || ''}`);
      if (r.status === 'NOT TESTED') console.log(`            ${r.note || ''}`);
    }
    console.log(`\nReport: ${outPath}`);
  }

  return { report, outPath, counts, rows };
}

export { CAB_ERROR_CONTRACT_CASES };

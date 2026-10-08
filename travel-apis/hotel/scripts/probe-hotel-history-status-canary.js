/**
 * Hotel booking history — verify new query param `status`
 * Allowed: Pending | Inprogress | Confirmed | Failed | Cancelled
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-hotel-history-status-canary.js
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import { HOTEL_QUERY } from '../src/helpers.js';

const OUT = path.join('reports', 'hotel-history-status-canary.json');
const PATH = '/v1/hotels/bookings/history';
const STATUSES = ['Pending', 'Inprogress', 'Confirmed', 'Failed', 'Cancelled'];

function brief(d, n = 700) {
  try { return JSON.stringify(d).slice(0, n); } catch { return String(d); }
}
function errCode(r) {
  return r?.data?.error?.code || r?.data?.code || null;
}
function bookingsOf(data) {
  if (Array.isArray(data?.bookings)) return data.bookings;
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}
function itemStatus(b) {
  return String(b?.status || b?.bookingStatus || '').trim();
}

async function main() {
  clearSession();
  console.log('Hotel history status filter on', config.baseUrl);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const client = session.client;

  const history = (status) => client.request({
    method: 'GET',
    path: PATH,
    query: {
      ...HOTEL_QUERY,
      page: 0,
      perpage: 20,
      ...(status ? { status } : {}),
    },
    correlation: true,
  });

  const rows = [];
  const calls = [
    { id: 'H0', status: null, rule: 'No status (baseline — all/unfiltered)' },
    ...STATUSES.map((s, i) => ({ id: `H${i + 1}`, status: s, rule: `status=${s}` })),
  ];

  for (const c of calls) {
    const res = await history(c.status);
    const list = bookingsOf(res.data);
    const statuses = list.map(itemStatus);
    const unique = [...new Set(statuses)];
    const mismatch = c.status
      ? list.filter((b) => itemStatus(b).toLowerCase() !== String(c.status).toLowerCase())
      : [];

    let status = 'PASS';
    let note = '';
    if (res.status !== 200 && !res.ok) {
      status = 'BUG';
      note = `HTTP ${res.status} code=${errCode(res)}`;
    } else if (c.status && mismatch.length) {
      status = 'BUG';
      note = `${mismatch.length} row(s) not ${c.status}: ${mismatch.slice(0, 5).map((b) => `${b.bookingId || b.bookingRefId}=${itemStatus(b)}`).join(', ')}`;
    } else if (c.status && list.length === 0) {
      status = 'PASS';
      note = `HTTP ${res.status}; empty list (no ${c.status} bookings for this user)`;
    } else {
      status = 'PASS';
      note = `HTTP ${res.status}; ${list.length} booking(s); unique statuses=[${unique.join(', ')}]`;
    }

    const sample = list.slice(0, 5).map((b) => ({
      bookingId: b.bookingId || b.bookingRefId || b.bookingReferenceId || b.id,
      status: itemStatus(b),
      hotel: b.hotelName || b.hotelDetails?.hotelName || b.hotelDetails?.name || null,
      checkin: b.checkIn || b.checkin || b.travelDate || null,
    }));

    rows.push({
      id: c.id,
      rule: c.rule,
      how: `GET ${PATH}?lang=en&currency=INR&page=0&perpage=20${c.status ? `&status=${c.status}` : ''}`,
      status,
      note,
      http: res.status,
      code: errCode(res),
      totalCount: res.data?.totalCount ?? res.data?.total ?? null,
      page: res.data?.page ?? null,
      perPage: res.data?.perPage ?? res.data?.perpage ?? null,
      returned: list.length,
      uniqueStatuses: unique,
      sample,
      responseKeys: res.data && typeof res.data === 'object' ? Object.keys(res.data) : [],
      snippet: brief(res.data, 500),
    });

    console.log(`\n[${status}] ${c.id} ${c.rule}`);
    console.log(' ', note);
    if (sample.length) console.log('  sample', JSON.stringify(sample));
  }

  const counts = {
    PASS: rows.filter((r) => r.status === 'PASS').length,
    BUG: rows.filter((r) => r.status === 'BUG').length,
    NOT_TESTED: 0,
  };

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    endpoint: `GET ${PATH}`,
    allowedStatuses: STATUSES,
    counts,
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nScore', counts);
  console.log('Report', OUT);
  if (counts.BUG) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

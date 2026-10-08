import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import { buildAirportSearchBody, buildOutstationSearchBody } from '../src/helpers.js';

clearSession();
process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
const { client } = await authenticate(true);
const cab = new CabService(client);
const fmt = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const probe = await cab.search(buildAirportSearchBody(fmt(Date.now() + 30 * 60e3)));
const m = String(probe.data?.error?.message || '');
const em = m.match(/earliest is ([0-9T:\-Z]+)/i);
const earliest = em ? new Date(em[1]).getTime() : Date.now() + 125 * 60e3;
console.log('earliest', fmt(earliest));

let foundAir = null;
for (const addH of [0, 0.5, 1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48]) {
  const dt = fmt(earliest + addH * 3600e3 + 5 * 60e3);
  const s = await cab.search(buildAirportSearchBody(dt));
  const n = s.data?.cabs?.length || 0;
  console.log('AIR', `+${addH}h`, dt, 'cabs', n, (s.data?.error?.message || 'ok').slice(0, 90));
  if (n > 0) {
    foundAir = dt;
    break;
  }
}
let foundOut = null;
for (const addH of [0, 1, 2, 4, 6, 12, 24, 36, 48]) {
  const dt = fmt(earliest + addH * 3600e3 + 5 * 60e3);
  const s = await cab.search(buildOutstationSearchBody(dt));
  const n = s.data?.cabs?.length || 0;
  console.log('OUT', `+${addH}h`, dt, 'cabs', n, (s.data?.error?.message || 'ok').slice(0, 90));
  if (n > 0) {
    foundOut = dt;
    break;
  }
}
console.log(JSON.stringify({ foundAir, foundOut }));

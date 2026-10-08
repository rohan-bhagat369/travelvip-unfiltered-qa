/**
 * One-off: UTC vs IST pickupDatetime examples on staging.
 * Format must be YYYY-MM-DDTHH:MM:SSZ (no millis).
 */
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { CAB_QUERY, buildAirportSearchBody } from '../src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api-staging.travelvip.ai';
clearSession();
const { client, accessToken } = await authenticate(true);
client.setPartnerKey(accessToken);

function isoZ(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

const now = Date.now();
const tomorrow = new Date(now + 86400000);
const y = tomorrow.getUTCFullYear();
const m = tomorrow.getUTCMonth();
const d = tomorrow.getUTCDate();
const correctUtc = isoZ(Date.UTC(y, m, d, 11, 30, 0)); // 17:00 IST
const wrongAsZ = isoZ(Date.UTC(y, m, d, 17, 0, 0)); // wrong: 17:00 wall as Z

async function hit(label, pickupDatetime, travelType = 'DEPARTURE') {
  const body = buildAirportSearchBody();
  body.travelType = travelType;
  if (travelType === 'ARRIVAL') {
    body.pickup = {
      name: 'IGI Airport-T1',
      city: 'Delhi',
      latitude: 28.5588,
      longitude: 77.0814,
    };
    body.drop = {
      name: 'Vasant Kunj, Delhi',
      city: 'Delhi',
      latitude: 28.5201,
      longitude: 77.1591,
    };
  }
  body.pickupDatetime = pickupDatetime;
  const res = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/search',
    query: { ...CAB_QUERY },
    body,
    partnerKey: client.partnerKey,
  });
  console.log(
    JSON.stringify(
      {
        label,
        travelType,
        pickupDatetime,
        http: res.status,
        code: res.data?.error?.code || null,
        message: res.data?.error?.message || (res.ok ? 'OK' : null),
        cabCount: Array.isArray(res.data?.cabs) ? res.data.cabs.length : null,
        reachedVendor:
          res.status === 200 && res.data?.error?.code === 'VENDOR_REJECTED_REQUEST',
      },
      null,
      2,
    ),
  );
}

console.log('base', process.env.BASE_URL);
console.log('nowUtc', isoZ(now));
console.log('note: 17:00 IST -> 11:30Z; 17:00Z is NOT 17:00 IST');
await hit('CORRECT_17IST_as_1130Z', correctUtc);
await hit('WRONG_1700Z_as_if_IST', wrongAsZ);
await hit('AA_plus10', isoZ(now + 10 * 60000), 'ARRIVAL');
await hit('AA_plus25', isoZ(now + 25 * 60000), 'ARRIVAL');

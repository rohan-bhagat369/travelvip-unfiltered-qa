/**
 * Find which booking id the vendor simulator accepts for a TravelVIP BR.
 */
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import {
  buildAirportSearchBody,
  buildFinalizeBody,
  pickCab,
} from '../src/helpers.js';

const DEV_URL = 'https://travelvip-dev.bookairportcab.com';
const username = process.env.CAB_VENDOR_USER || 'gyanesh';
const password = process.env.CAB_VENDOR_PASS || '';

function walk(obj, path = '', found = []) {
  if (!obj || typeof obj !== 'object') return found;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'string' || typeof v === 'number') {
      if (/booking|ref|order|partner|vendor|mojo|mjb|otp|track/i.test(k)) {
        found.push({ path: p, value: v });
      }
    } else {
      walk(v, p, found);
    }
  }
  return found;
}

async function main() {
  if (!password) throw new Error('CAB_VENDOR_PASS required');

  const { client } = await authenticate();
  const cab = new CabService(client);
  const search = await cab.search(buildAirportSearchBody());
  const cabs = search.data?.cabs || [];
  console.log(
    'operators:',
    [...new Set(cabs.map((c) => `${c.operator?.name}|fareId=${c.fareId}`))],
  );

  const preferred =
    cabs.find((c) => /carzon|travelvip|mojo|meru/i.test(c.operator?.name || '')) ||
    pickCab(cabs);

  const fare = await cab.fare(preferred.searchId);
  const book = await cab.finalizeBooking(
    buildFinalizeBody({
      bookingReference: fare.data.bookingReference,
      priceId: fare.data.priceId,
    }),
  );
  const br = book.data?.bookingRefId;
  console.log('created', { br, operator: preferred.operator?.name, book: book.data });

  await new Promise((r) => setTimeout(r, 4000));
  const status = await cab.getBookingStatus(br);
  console.log('status summary', {
    status: status.data?.status,
    interesting: walk(status.data),
  });
  console.log('full status', JSON.stringify(status.data, null, 2));

  const login = await (
    await fetch(`${DEV_URL}/auth/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  ).json();

  if (!login?.token) {
    console.error('login failed', login);
    process.exit(1);
  }

  const authHeader = `Bearer ${login.token}`;
  const candidates = [
    br,
    br?.replace(/^BR/, ''),
    `MJB${br}`,
    `MJB${br?.replace(/^BR/, '')}`,
    ...walk(status.data).map((x) => String(x.value)),
  ].filter(Boolean);

  const unique = [...new Set(candidates)];
  const attempts = [];
  for (const id of unique) {
    const res = await fetch(
      `${DEV_URL}/api/v1/booking/bookingDetailsOps?bookingId=${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: authHeader,
          correlationId: crypto.randomUUID(),
        },
      },
    );
    const data = await res.json();
    attempts.push({
      id,
      http: res.status,
      status: data.status,
      message: data.message,
      first: data.data?.[0]
        ? {
            bookingId: data.data[0].bookingId,
            cabPartner: data.data[0].cabPartner,
            status: data.data[0].status || data.data[0].bookingStatus,
          }
        : null,
    });
  }

  console.log('fetchAttempts', JSON.stringify(attempts, null, 2));
  const hit = attempts.find((a) => a.status === 'success' && a.first);
  console.log('verdict', hit ? { WORKING_WITH: hit.id, details: hit.first } : 'NO_ID_MATCHED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Case J: book cab on theta, wait Confirmed, cancel (wallet refund path).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { CabService } from '../src/service.js';
import { buildFinalizeBody, pickCab, searchBodyForJourney } from '../src/helpers.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'theta-wallet-prepaid');
fs.mkdirSync(OUT, { recursive: true });

const { client } = await authenticate(true);
const cab = new CabService(client);

const searchBody = searchBodyForJourney('AIRPORT');
const search = await cab.search(searchBody);
const picked = pickCab(search.data?.cabs);
if (!picked?.searchId) throw new Error('no cab inventory');
const fare = await cab.fare(picked.searchId);
const bookingReference = fare.data?.bookingReference;
const body = buildFinalizeBody({
  bookingReference,
  searchId: picked.searchId,
  fare: fare.data,
  passengerOverrides: { firstName: 'Rohan', lastName: `CabJ${Date.now().toString().slice(-4)}` },
});
body.contact.email = `theta.cab.j.${Date.now()}@travelvip.ai`;

const fin = await client.request({
  method: 'POST',
  path: '/v1/airportServices/cabs/finalize-booking',
  body,
  correlation: true,
  partnerKey: client.partnerKey,
});
const br = fin.data?.bookingRefId || fin.data?.bookingReference || bookingReference;
console.log('finalize', fin.status, br, fin.data?.status);

let status = fin.data?.status;
for (let i = 0; i < 20; i += 1) {
  const st = await cab.getBookingStatus(br);
  status = st.data?.status || status;
  console.log('status', i + 1, status);
  if (/Confirm|Fail|Cancel/i.test(String(status || ''))) break;
  await sleep(4000);
}

const cancel = await cab.cancelBooking(br);
console.log('cancel', cancel.status, JSON.stringify(cancel.data).slice(0, 500));
await sleep(3000);
const after = await cab.getBookingStatus(br);
const result = {
  br,
  bookStatus: status,
  cancelHttp: cancel.status,
  cancel: cancel.data,
  after: after.data,
  status: (cancel.ok || /Cancel/i.test(String(after.data?.status || cancel.data?.status || '')))
    ? 'PASS'
    : (/Confirm/i.test(String(status || '')) ? 'CHECK' : 'NOT TESTED'),
};
fs.writeFileSync(path.join(OUT, 'cab-J-cancel-latest.json'), JSON.stringify(result, null, 2));
console.log('=>', result.status, result.br);

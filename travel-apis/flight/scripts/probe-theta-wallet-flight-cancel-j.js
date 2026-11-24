/**
 * Case J: cancel wallet-paid confirmed flight on theta-api.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'theta-wallet-prepaid');
fs.mkdirSync(OUT, { recursive: true });

const br = process.env.FLIGHT_BR || 'BR1794993507614124';
const { client } = await authenticate(true);
const flight = new FlightService(client);

const detail = await flight.getBookingDetail(br);
fs.writeFileSync(path.join(OUT, `flight-J-detail-${br}.json`), JSON.stringify(detail.data, null, 2));

function findPnrs(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const x of node) findPnrs(x, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (/^pnr$/i.test(k) && typeof v === 'string' && v.trim()) out.push(v.trim());
    else findPnrs(v, out);
  }
  return out;
}

const pnrs = [...new Set(findPnrs(detail.data))];
console.log('status', detail.data?.status || detail.data?.bookingResponse?.status);
console.log('pnrs', pnrs);

if (!pnrs.length) {
  console.log('NO PNR — cannot cancel');
  process.exit(2);
}

const pnr = pnrs[0];
const cancel = await flight.cancelV2({
  bookingId: br,
  action: 'CANCEL',
  pnr,
  cancelledBy: 'USER',
});
console.log('cancel', cancel.status, JSON.stringify(cancel.data).slice(0, 900));

await new Promise((r) => setTimeout(r, 4000));
const after = await flight.getBookingStatus(br);
console.log('after', JSON.stringify(after.data).slice(0, 400));

const result = {
  br,
  pnr,
  cancelHttp: cancel.status,
  cancel: cancel.data,
  after: after.data,
  status: (cancel.ok || /Cancel/i.test(String(after.data?.status || ''))) ? 'PASS' : 'CHECK',
};
fs.writeFileSync(path.join(OUT, 'flight-J-cancel-latest.json'), JSON.stringify(result, null, 2));
console.log('=>', result.status);

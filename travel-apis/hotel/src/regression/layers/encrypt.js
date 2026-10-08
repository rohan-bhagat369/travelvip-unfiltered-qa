import { HILLTOP, RIYA_HOTELS, vendorLeak } from '../fixtures.js';
import { row, brief } from '../report.js';
import { leakScan, hilltopSearchDetails, noteCall, prebookRoom } from '../session.js';
import { isPrebookSuccess } from '../../helpers.js';

export async function runEncrypt(ctx, { scanAllRiya = false } = {}) {
  const rows = [];
  const stay = await hilltopSearchDetails(ctx.hotel);
  noteCall(ctx, 'encrypt-search', '/v1/hotels/search', stay.search);
  noteCall(ctx, 'encrypt-details', '/v1/hotels/details', stay.details);

  const scanD = leakScan('details', stay.details.data);
  const codes = (stay.rooms || []).map((r) => r.bookingCode);
  const allEncrypted = codes.length > 0 && codes.every((c) => !vendorLeak(c) && String(c).length > 12);
  rows.push(row(
    'ENCRYPT', 'vendor', 1, 'Details bookingCode encrypted (no RIYA / !TB!)',
    `POST /v1/hotels/details Hilltop ${HILLTOP.entityId}`,
    'no RIYA, no !TB!RIYA!TB!; looks encrypted',
    `rooms=${codes.length} leak=${scanD.leakCount} sample=${String(scanD.sample || '').slice(0, 48)}`,
    stay.details.ok && allEncrypted ? 'PASS' : (stay.details.ok ? 'BUG' : 'BUG'),
  ));

  const room = stay.rooms[0];
  if (!stay.requestId || !room) {
    rows.push(row(
      'ENCRYPT', 'vendor', 2, 'Prebook request/response codes encrypted',
      'POST /v1/hotels/prebook',
      'same encryption rule',
      'no requestId/rooms',
      'NOT TESTED',
    ));
    ctx.encryptStay = stay;
    return rows;
  }

  const pre = await prebookRoom(ctx.hotel, stay, room);
  noteCall(ctx, 'encrypt-prebook', '/v1/hotels/prebook', pre);
  const scanP = leakScan('prebook', { req: room.bookingCode, res: pre.data });
  const preCodeOk = !vendorLeak(room.bookingCode);
  rows.push(row(
    'ENCRYPT', 'vendor', 2, 'Prebook request/response codes encrypted',
    'POST /v1/hotels/prebook same bookingCode',
    'code still encrypted; bookingContext present',
    `preOk=${isPrebookSuccess(pre)} leak=${scanP.leakCount} ${brief(pre.data, 160)}`,
    isPrebookSuccess(pre) && preCodeOk ? 'PASS' : 'BUG',
  ));

  rows.push(row(
    'ENCRYPT', 'vendor', 4, 'Scan details JSON bookingCodes for vendor strings',
    'walk details.results[].rooms[].bookingCode',
    'no Riya token in codes',
    `leakCount=${scanD.leakCount}`,
    scanD.leakCount === 0 ? 'PASS' : 'BUG',
  ));

  ctx.encryptStay = stay;
  ctx.encryptRoom = room;
  ctx.encryptPrebook = pre;

  if (scanAllRiya) {
    for (const [i, h] of RIYA_HOTELS.entries()) {
      const one = await hilltopSearchDetails(ctx.hotel);
      // reuse helper with override by temporarily swapping? just search this entity
      const s = await ctx.hotel.search(
        { ...one.searchBody, entityId: h.entityId, type: 'HOTEL' },
        { pid: 'vgm' },
      );
      const d = await ctx.hotel.getDetails({ ...one.searchBody, entityId: h.entityId, type: 'HOTEL' });
      const leaked = leakScan(h.name, d.data);
      rows.push(row(
        'ENCRYPT', 'riya-dest', 8 + i, `PAN hotel encrypted: ${h.name}`,
        `details entityId=${h.entityId}`,
        'bookingCode encrypted',
        `search=${s.status} details=${d.status} leak=${leaked.leakCount} sample=${String(leaked.sample || '').slice(0, 40)}`,
        s.ok && d.ok && leaked.leakCount === 0 && leaked.sample ? 'PASS' : (d.ok ? 'BUG' : 'NOT TESTED'),
      ));
    }
  }

  return rows;
}

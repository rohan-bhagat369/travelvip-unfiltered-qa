/**
 * Cab search pickupDatetime lead-time — alternate timestamps (canary).
 * Format MUST be YYYY-MM-DDTHH:MM:SSZ (no milliseconds).
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-cab-pickup-leadtime-v2.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { config } from '../../../shared/config/env.js';
import {
  CAB_QUERY,
  buildAirportSearchBody,
  buildOutstationSearchBody,
  buildRentalSearchBody,
} from '../src/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'cab-pickup-leadtime-canary-v2.json');

function toUtcZ(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function utcPlusMinutes(mins) {
  const d = new Date(Date.now() + mins * 60_000);
  d.setUTCMilliseconds(0);
  return toUtcZ(d);
}

function utcFixed({ daysAhead = 0, hour, minute = 0, second = 0 }) {
  const n = new Date();
  return toUtcZ(Date.UTC(
    n.getUTCFullYear(),
    n.getUTCMonth(),
    n.getUTCDate() + daysAhead,
    hour,
    minute,
    second,
  ));
}

function minsUntil(iso) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

function bodyFor(kind) {
  if (kind === 'AIRPORT_ARRIVAL') {
    const b = buildAirportSearchBody();
    b.travelType = 'ARRIVAL';
    b.pickup = { name: 'IGI Airport-T1', city: 'Delhi', latitude: 28.5588, longitude: 77.0814 };
    b.drop = { name: 'Vasant Kunj, Delhi', city: 'Delhi', latitude: 28.5201, longitude: 77.1591 };
    return b;
  }
  if (kind === 'AIRPORT_DEPARTURE') return buildAirportSearchBody();
  if (kind === 'RENTAL') return buildRentalSearchBody();
  if (kind === 'OUTSTATION') return buildOutstationSearchBody();
  throw new Error(kind);
}

function codeOf(d) {
  return d?.error?.code || null;
}
function msgOf(d) {
  return d?.error?.message || d?.message || null;
}

function expectFor(kind, iso) {
  const m = minsUntil(iso);
  const need = kind === 'AIRPORT_ARRIVAL' ? 20 : 120;
  return m >= need ? 'ACCEPT' : 'REJECT';
}

async function hit(client, { id, kind, pickupDatetime, expect, note = '' }) {
  const body = bodyFor(kind);
  body.pickupDatetime = pickupDatetime;
  const res = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/search',
    query: { ...CAB_QUERY },
    body,
    partnerKey: client.partnerKey,
  });
  const http = res.status;
  const code = codeOf(res.data);
  const msg = msgOf(res.data);
  const cabs = Array.isArray(res.data?.cabs) ? res.data.cabs.length : null;

  let status = 'BUG';
  if (expect === 'ACCEPT') {
    const leadReject = http === 400 && code === 'VALIDATION_ERROR';
    status = !leadReject && http >= 200 && http < 500 ? 'PASS' : 'BUG';
  } else {
    status = http === 400 && code === 'VALIDATION_ERROR' && (cabs == null || cabs === 0)
      ? 'PASS'
      : 'BUG';
  }

  return {
    id,
    kind,
    pickupDatetime,
    offsetMin: minsUntil(pickupDatetime),
    expect,
    note,
    actualHttp: http,
    actualCode: code,
    actualMessage: msg,
    cabCount: cabs,
    status,
  };
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  clearSession();
  const { client, accessToken } = await authenticate(true);
  client.setPartnerKey(accessToken);
  const now = new Date().toISOString();

  /** @type {Array<{id:string,kind:string,iso:string,expect?:string,note?:string}>} */
  const plan = [
    // ARRIVAL — different offsets than v1
    { id: 'AA-NEG-1', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(1), expect: 'REJECT' },
    { id: 'AA-NEG-15', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(15), expect: 'REJECT' },
    { id: 'AA-NEG-18', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(18), expect: 'REJECT' },
    { id: 'AA-EDGE-20', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(20), expect: 'ACCEPT', note: 'exact 20m' },
    { id: 'AA-POS-25', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(25), expect: 'ACCEPT' },
    { id: 'AA-POS-45', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(45), expect: 'ACCEPT' },
    { id: 'AA-POS-90', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(90), expect: 'ACCEPT' },
    { id: 'AA-POS-1d', kind: 'AIRPORT_ARRIVAL', iso: utcPlusMinutes(24 * 60), expect: 'ACCEPT' },

    // DEPARTURE
    { id: 'AD-NEG-5', kind: 'AIRPORT_DEPARTURE', iso: utcPlusMinutes(5), expect: 'REJECT' },
    { id: 'AD-NEG-90', kind: 'AIRPORT_DEPARTURE', iso: utcPlusMinutes(90), expect: 'REJECT' },
    { id: 'AD-NEG-115', kind: 'AIRPORT_DEPARTURE', iso: utcPlusMinutes(115), expect: 'REJECT' },
    { id: 'AD-EDGE-120', kind: 'AIRPORT_DEPARTURE', iso: utcPlusMinutes(120), expect: 'ACCEPT', note: 'exact 2h' },
    { id: 'AD-POS-150', kind: 'AIRPORT_DEPARTURE', iso: utcPlusMinutes(150), expect: 'ACCEPT' },
    { id: 'AD-POS-240', kind: 'AIRPORT_DEPARTURE', iso: utcPlusMinutes(240), expect: 'ACCEPT' },
    { id: 'AD-POS-1d', kind: 'AIRPORT_DEPARTURE', iso: utcPlusMinutes(24 * 60), expect: 'ACCEPT' },

    // RENTAL
    { id: 'RT-NEG-15', kind: 'RENTAL', iso: utcPlusMinutes(15), expect: 'REJECT' },
    { id: 'RT-NEG-100', kind: 'RENTAL', iso: utcPlusMinutes(100), expect: 'REJECT' },
    { id: 'RT-EDGE-120', kind: 'RENTAL', iso: utcPlusMinutes(120), expect: 'ACCEPT' },
    { id: 'RT-POS-200', kind: 'RENTAL', iso: utcPlusMinutes(200), expect: 'ACCEPT' },
    { id: 'RT-POS-2d', kind: 'RENTAL', iso: utcPlusMinutes(2 * 24 * 60), expect: 'ACCEPT' },

    // OUTSTATION
    { id: 'OS-NEG-45', kind: 'OUTSTATION', iso: utcPlusMinutes(45), expect: 'REJECT' },
    { id: 'OS-NEG-110', kind: 'OUTSTATION', iso: utcPlusMinutes(110), expect: 'REJECT' },
    { id: 'OS-EDGE-120', kind: 'OUTSTATION', iso: utcPlusMinutes(120), expect: 'ACCEPT' },
    { id: 'OS-POS-300', kind: 'OUTSTATION', iso: utcPlusMinutes(300), expect: 'ACCEPT' },
    { id: 'OS-POS-3d', kind: 'OUTSTATION', iso: utcPlusMinutes(3 * 24 * 60), expect: 'ACCEPT' },

    // Fixed wall clocks (UTC) — different hours
    { id: 'FIX-AD-09Z-tmw', kind: 'AIRPORT_DEPARTURE', iso: utcFixed({ daysAhead: 1, hour: 9, minute: 0 }), note: 'tomorrow 09:00Z' },
    { id: 'FIX-AD-1130Z-today', kind: 'AIRPORT_DEPARTURE', iso: utcFixed({ daysAhead: 0, hour: 11, minute: 30 }), note: 'today 11:30Z (=17:00 IST) — correct UTC for 17:00 IST' },
    { id: 'FIX-AD-1430Z-today', kind: 'AIRPORT_DEPARTURE', iso: utcFixed({ daysAhead: 0, hour: 14, minute: 30 }), note: 'today 14:30Z' },
    { id: 'FIX-AA-1300Z-today', kind: 'AIRPORT_ARRIVAL', iso: utcFixed({ daysAhead: 0, hour: 13, minute: 0 }), note: 'today 13:00Z' },
    { id: 'FIX-AA-1330Z-today', kind: 'AIRPORT_ARRIVAL', iso: utcFixed({ daysAhead: 0, hour: 13, minute: 30 }), note: 'today 13:30Z' },
    { id: 'FIX-RT-1600Z-today', kind: 'RENTAL', iso: utcFixed({ daysAhead: 0, hour: 16, minute: 0 }), note: 'today 16:00Z' },
    { id: 'FIX-OS-1830Z-tmw', kind: 'OUTSTATION', iso: utcFixed({ daysAhead: 1, hour: 18, minute: 30 }), note: 'tomorrow 18:30Z' },

    // IST trap
    { id: 'IST-OK-1130Z-tmw', kind: 'AIRPORT_DEPARTURE', iso: utcFixed({ daysAhead: 1, hour: 11, minute: 30 }), note: '17:00 IST tomorrow → 11:30Z' },
    { id: 'IST-BAD-1700Z-today', kind: 'AIRPORT_DEPARTURE', iso: utcFixed({ daysAhead: 0, hour: 17, minute: 0 }), note: '17:00Z today is NOT 17:00 IST' },
  ];

  const rows = [];
  for (const p of plan) {
    const expect = p.expect || expectFor(p.kind, p.iso);
    rows.push(await hit(client, {
      id: p.id,
      kind: p.kind,
      pickupDatetime: p.iso,
      expect,
      note: p.note || '',
    }));
  }

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    baseUrl: process.env.BASE_URL || config.baseUrl,
    ranAt: new Date().toISOString(),
    serverNowApproxUtc: now,
    format: 'YYYY-MM-DDTHH:MM:SSZ (no millis)',
    counts,
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`\n=== Cab pickupDatetime lead-time v2 @ ${report.baseUrl} ===`);
  console.log(`Now≈ ${now}`);
  console.log(`PASS ${counts.PASS || 0} | BUG ${counts.BUG || 0} | total ${rows.length}\n`);

  let kind = '';
  for (const r of rows) {
    if (r.kind !== kind) {
      kind = r.kind;
      console.log(`\n--- ${kind} ---`);
    }
    console.log(
      `${r.status.padEnd(5)} ${r.id.padEnd(24)} off+${String(r.offsetMin).padStart(5)}m exp ${r.expect.padEnd(6)}`
      + ` | HTTP ${r.actualHttp} ${r.actualCode || ''} | ${r.pickupDatetime}`,
    );
    if (r.status === 'BUG') console.log(`      ${r.actualMessage || ''}`);
  }
  console.log(`\nReport: ${OUT}`);
  process.exit((counts.BUG || 0) > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

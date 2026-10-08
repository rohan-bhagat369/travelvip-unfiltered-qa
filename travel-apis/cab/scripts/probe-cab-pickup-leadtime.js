/**
 * Cab search pickupDatetime lead-time rules on canary/staging.
 *
 * Rules (UTC):
 *   AIRPORT + ARRIVAL   → min 20 minutes ahead
 *   AIRPORT + DEPARTURE → min 2 hours ahead
 *   RENTAL              → min 2 hours ahead
 *   OUTSTATION          → min 2 hours ahead
 *
 * Too soon → HTTP 400 VALIDATION_ERROR (must not reach provider / no cabs list).
 *
 *   BASE_URL=https://canary-api.travelvip.ai node scripts/probe-cab-pickup-leadtime.js
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
const OUT = path.join(__dirname, '..', 'reports', 'cab-pickup-leadtime-canary.json');

function utcPlusMinutes(mins) {
  const d = new Date(Date.now() + mins * 60_000);
  // floor to whole seconds
  d.setUTCMilliseconds(0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function codeOf(data) {
  return data?.error?.code || null;
}

function msgOf(data) {
  return data?.error?.message || data?.message || null;
}

function baseBody(kind) {
  if (kind === 'AIRPORT_ARRIVAL') {
    const b = buildAirportSearchBody();
    b.travelType = 'ARRIVAL';
    // airport → city
    b.pickup = {
      name: 'IGI Airport-T1',
      city: 'Delhi',
      latitude: 28.5588,
      longitude: 77.0814,
    };
    b.drop = {
      name: 'Vasant Kunj, Delhi',
      city: 'Delhi',
      latitude: 28.5201,
      longitude: 77.1591,
    };
    return b;
  }
  if (kind === 'AIRPORT_DEPARTURE') {
    return buildAirportSearchBody();
  }
  if (kind === 'RENTAL') {
    return buildRentalSearchBody();
  }
  if (kind === 'OUTSTATION') {
    return buildOutstationSearchBody();
  }
  throw new Error(kind);
}

/**
 * Positive = HTTP 200 and not VALIDATION_ERROR (empty cabs[] ok if inventory).
 * Negative = HTTP 400 VALIDATION_ERROR, no cabs.
 */
async function runCase(client, {
  id, kind, offsetMin, expect, edgeNote = '',
}) {
  const body = baseBody(kind);
  body.pickupDatetime = utcPlusMinutes(offsetMin);
  const res = await client.request({
    method: 'POST',
    path: '/v1/airportServices/cabs/search',
    query: { ...CAB_QUERY },
    body,
    partnerKey: client.partnerKey,
  });

  const http = res.status;
  const code = codeOf(res.data);
  const cabs = Array.isArray(res.data?.cabs) ? res.data.cabs.length : null;
  const msg = msgOf(res.data);

  let status = 'BUG';
  if (expect === 'ACCEPT') {
    // Must not be 400 VALIDATION_ERROR; 200 with cabs or empty is OK; never treat as lead-time fail
    const rejectedLead = http === 400 && code === 'VALIDATION_ERROR'
      && /pickupDatetime|minute|hour|ahead|soon|past/i.test(String(msg || ''));
    const hardReject = http === 400 && code === 'VALIDATION_ERROR';
    if (!hardReject && http >= 200 && http < 300) status = 'PASS';
    else if (hardReject) status = 'BUG'; // rejected when should accept
    else if (http >= 200 && http < 500 && code !== 'VALIDATION_ERROR') status = 'PASS';
    else status = 'BUG';
    // If rejected for lead-time specifically → BUG
    if (rejectedLead) status = 'BUG';
  } else {
    // REJECT: expect 400 VALIDATION_ERROR and no cab options
    const okHttp = http === 400;
    const okCode = code === 'VALIDATION_ERROR';
    const noCabs = cabs == null || cabs === 0;
    status = okHttp && okCode && noCabs ? 'PASS' : 'BUG';
  }

  return {
    id,
    kind,
    offsetMin,
    pickupDatetimeUtc: body.pickupDatetime,
    expect,
    edgeNote,
    actualHttp: http,
    actualCode: code,
    actualMessage: msg,
    cabCount: cabs,
    status,
    body: res.data,
  };
}

async function main() {
  process.env.BASE_URL = process.env.BASE_URL || 'https://canary-api.travelvip.ai';
  clearSession();
  const { client, accessToken } = await authenticate(true);
  client.setPartnerKey(accessToken);

  const nowIso = new Date().toISOString();
  const rows = [];

  // --- AIRPORT + ARRIVAL: min 20 min ---
  rows.push(await runCase(client, { id: 'AA-NEG-past', kind: 'AIRPORT_ARRIVAL', offsetMin: -5, expect: 'REJECT', edgeNote: 'past' }));
  rows.push(await runCase(client, { id: 'AA-NEG-0', kind: 'AIRPORT_ARRIVAL', offsetMin: 0, expect: 'REJECT', edgeNote: 'now' }));
  rows.push(await runCase(client, { id: 'AA-NEG-10', kind: 'AIRPORT_ARRIVAL', offsetMin: 10, expect: 'REJECT', edgeNote: '10 < 20' }));
  rows.push(await runCase(client, { id: 'AA-NEG-19', kind: 'AIRPORT_ARRIVAL', offsetMin: 19, expect: 'REJECT', edgeNote: 'edge just under 20' }));
  rows.push(await runCase(client, { id: 'AA-POS-20', kind: 'AIRPORT_ARRIVAL', offsetMin: 20, expect: 'ACCEPT', edgeNote: 'exact 20 min edge' }));
  rows.push(await runCase(client, { id: 'AA-POS-21', kind: 'AIRPORT_ARRIVAL', offsetMin: 21, expect: 'ACCEPT', edgeNote: 'just over 20' }));
  rows.push(await runCase(client, { id: 'AA-POS-60', kind: 'AIRPORT_ARRIVAL', offsetMin: 60, expect: 'ACCEPT', edgeNote: '1 hour ahead' }));

  // --- AIRPORT + DEPARTURE: min 2 hours (120 min) ---
  rows.push(await runCase(client, { id: 'AD-NEG-30', kind: 'AIRPORT_DEPARTURE', offsetMin: 30, expect: 'REJECT', edgeNote: '30 < 120' }));
  rows.push(await runCase(client, { id: 'AD-NEG-60', kind: 'AIRPORT_DEPARTURE', offsetMin: 60, expect: 'REJECT', edgeNote: '1h < 2h' }));
  rows.push(await runCase(client, { id: 'AD-NEG-119', kind: 'AIRPORT_DEPARTURE', offsetMin: 119, expect: 'REJECT', edgeNote: 'edge just under 2h' }));
  rows.push(await runCase(client, { id: 'AD-POS-120', kind: 'AIRPORT_DEPARTURE', offsetMin: 120, expect: 'ACCEPT', edgeNote: 'exact 2h edge' }));
  rows.push(await runCase(client, { id: 'AD-POS-121', kind: 'AIRPORT_DEPARTURE', offsetMin: 121, expect: 'ACCEPT', edgeNote: 'just over 2h' }));
  rows.push(await runCase(client, { id: 'AD-POS-180', kind: 'AIRPORT_DEPARTURE', offsetMin: 180, expect: 'ACCEPT', edgeNote: '3h ahead' }));

  // --- RENTAL: min 2 hours ---
  rows.push(await runCase(client, { id: 'RT-NEG-30', kind: 'RENTAL', offsetMin: 30, expect: 'REJECT', edgeNote: '30 < 120' }));
  rows.push(await runCase(client, { id: 'RT-NEG-119', kind: 'RENTAL', offsetMin: 119, expect: 'REJECT', edgeNote: 'edge just under 2h' }));
  rows.push(await runCase(client, { id: 'RT-POS-120', kind: 'RENTAL', offsetMin: 120, expect: 'ACCEPT', edgeNote: 'exact 2h edge' }));
  rows.push(await runCase(client, { id: 'RT-POS-180', kind: 'RENTAL', offsetMin: 180, expect: 'ACCEPT', edgeNote: '3h ahead' }));

  // --- OUTSTATION: min 2 hours ---
  rows.push(await runCase(client, { id: 'OS-NEG-30', kind: 'OUTSTATION', offsetMin: 30, expect: 'REJECT', edgeNote: '30 < 120' }));
  rows.push(await runCase(client, { id: 'OS-NEG-119', kind: 'OUTSTATION', offsetMin: 119, expect: 'REJECT', edgeNote: 'edge just under 2h' }));
  rows.push(await runCase(client, { id: 'OS-POS-120', kind: 'OUTSTATION', offsetMin: 120, expect: 'ACCEPT', edgeNote: 'exact 2h edge' }));
  rows.push(await runCase(client, { id: 'OS-POS-180', kind: 'OUTSTATION', offsetMin: 180, expect: 'ACCEPT', edgeNote: '3h ahead' }));

  // UTC vs IST confusion sanity: send a wall-clock that looks like "now IST" but as Z (wrong) —
  // only if that would be "soon" in UTC terms. Document for report.
  const istish = new Date();
  // Construct "today 17:00Z" which is NOT 17:00 IST — if that's within lead window, expect REJECT for DEPARTURE
  const fakeIstAsZ = new Date(Date.UTC(
    istish.getUTCFullYear(),
    istish.getUTCMonth(),
    istish.getUTCDate(),
    17, 0, 0,
  ));
  const minsToFake = Math.round((fakeIstAsZ.getTime() - Date.now()) / 60_000);
  rows.push(await runCase(client, {
    id: 'UTC-TRAP-AD',
    kind: 'AIRPORT_DEPARTURE',
    offsetMin: minsToFake,
    expect: minsToFake >= 120 ? 'ACCEPT' : 'REJECT',
    edgeNote: `pickupDatetime=${fakeIstAsZ.toISOString().replace(/\.\d{3}Z$/, 'Z')} (17:00Z wall, offset ${minsToFake}m) — must treat as UTC not IST`,
  }));

  const counts = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    return a;
  }, {});

  const report = {
    baseUrl: process.env.BASE_URL || config.baseUrl,
    ranAt: new Date().toISOString(),
    serverNowApproxUtc: nowIso,
    rules: {
      'AIRPORT+ARRIVAL': 'min 20 minutes ahead (UTC)',
      'AIRPORT+DEPARTURE': 'min 2 hours ahead (UTC)',
      RENTAL: 'min 2 hours ahead (UTC)',
      OUTSTATION: 'min 2 hours ahead (UTC)',
      failShape: 'HTTP 400 VALIDATION_ERROR; must not return cab options',
    },
    counts,
    rows: rows.map(({ body, ...rest }) => ({ ...rest, error: body?.error || null })),
    raw: rows,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`\n=== Cab pickupDatetime lead-time @ ${report.baseUrl} ===`);
  console.log(`Now≈ ${nowIso}`);
  console.log(`PASS ${counts.PASS || 0} | BUG ${counts.BUG || 0} | NOT TESTED ${counts['NOT TESTED'] || 0}\n`);

  let kind = '';
  for (const r of rows) {
    if (r.kind !== kind) {
      kind = r.kind;
      console.log(`\n--- ${kind} ---`);
    }
    console.log(
      `${r.status.padEnd(11)} ${r.id} offset+${r.offsetMin}m expect ${r.expect} | `
      + `got HTTP ${r.actualHttp} ${r.actualCode || ''} | ${r.pickupDatetimeUtc}`
      + (r.status === 'BUG' ? `\n            ${r.actualMessage || ''}` : ''),
    );
  }
  console.log(`\nReport: ${OUT}`);
  process.exit((counts.BUG || 0) > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

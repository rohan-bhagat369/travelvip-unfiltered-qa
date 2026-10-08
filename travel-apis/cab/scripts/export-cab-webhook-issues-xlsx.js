/**
 * Export cab webhook open issues + full event payloads to Excel.
 */
import fs from 'fs';
import XLSX from 'xlsx';

const extracted = JSON.parse(
  fs.readFileSync('tmp/cab-webhook-extracted-payloads.json', 'utf8'),
);

/** Also pull raw JSON payloads from transcript (non-INSERT pastes). */
function extractRawJsonPayloads() {
  const transcript =
    'C:/Users/Rohan Bhagat/.cursor/projects/d-Travel-VIP-API-Automation/agent-transcripts/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a.jsonl';
  const lines = fs.readFileSync(transcript, 'utf8').split(/\n/).filter(Boolean);
  const extras = {};

  function extractBalanced(s, startIdx) {
    if (s[startIdx] !== '{') return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = startIdx; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === '\\') {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(startIdx, i + 1);
      }
    }
    return null;
  }

  const wantEvents = new Set([
    'driver.enroute',
    'booking.cancelled',
    'booking.failed',
    'trip.ended',
    'booking.confirmed',
  ]);
  const wantBrs = new Set([
    'BR1789031824882449',
    'BR1789032091575394',
    'BR1789033098766714',
  ]);

  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.role !== 'user') continue;
    const t = (o.message?.content || []).map((c) => c.text || '').join('\n');
    if (!t.includes('"event"')) continue;

    for (const ev of wantEvents) {
      const marker = `"event":"${ev}"`;
      let idx = 0;
      while ((idx = t.indexOf(marker, idx)) >= 0) {
        // walk back to opening {
        let start = idx;
        while (start > 0 && t[start] !== '{') start--;
        // prefer version:1 root
        const vIdx = t.lastIndexOf('"version":1', idx);
        if (vIdx >= 0 && vIdx > idx - 80) {
          start = vIdx;
          while (start > 0 && t[start] !== '{') start--;
        }
        const raw = extractBalanced(t, start);
        idx += marker.length;
        if (!raw) continue;
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }
        const br = data?.data?.bookingReference;
        if (!br || !wantBrs.has(br)) continue;
        if (data.event !== ev) continue;
        const key = `${br}|${ev}`;
        if (ev === 'driver.enroute') {
          if (!extras[key]) extras[key] = [];
          if (!extras[key].some((x) => x.timestamp === data.timestamp)) {
            extras[key].push(data);
          }
        } else if (!extras[key]) {
          extras[key] = data;
        }
      }
    }
  }
  return extras;
}

const rawExtras = extractRawJsonPayloads();
const all = { ...extracted };
for (const [k, v] of Object.entries(rawExtras)) {
  if (!all[k]) all[k] = v;
  else if (Array.isArray(v) && Array.isArray(all[k])) {
    for (const item of v) {
      if (!all[k].some((x) => x.timestamp === item.timestamp)) all[k].push(item);
    }
  }
}

function payload(br, event, filterFn) {
  const key = `${br}|${event}`;
  let val = all[key];
  if (!val) return null;
  if (Array.isArray(val) && filterFn) {
    val = val.filter(filterFn);
  }
  return val;
}

function pretty(obj) {
  if (obj == null) return '(payload not found in pastes — see note)';
  return JSON.stringify(obj, null, 2);
}

/** Post-start enroute only (after trip.started). */
function postStartEnroute(br, afterTs) {
  const arr = payload(br, 'driver.enroute');
  if (!Array.isArray(arr)) return arr;
  return arr
    .filter((x) => !afterTs || x.timestamp >= afterTs)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

const rows = [
  {
    '#': 1,
    'Cab type': 'OUTSTATION',
    Event: 'booking.confirmed',
    'Booking ref': 'BR1789027856400104',
    Field: 'details.airportCode',
    Expected: 'null (not an airport trip)',
    Actual: 'PNQ',
    'Issue detail': 'Outstation trip wrongly shows an airport code.',
    'Event payload': pretty(payload('BR1789027856400104', 'booking.confirmed')),
  },
  {
    '#': 2,
    'Cab type': 'OUTSTATION',
    Event: 'booking.failed',
    'Booking ref': 'BR1789028629645454',
    Field: 'providerBookingId',
    Expected: 'Omit (booking never accepted)',
    Actual: 'TVIPWE100926134056XBNK',
    'Issue detail': 'Failed book still sends vendor id (same as a successful trip).',
    'Event payload': pretty(payload('BR1789028629645454', 'booking.failed')),
  },
  {
    '#': 3,
    'Cab type': 'OUTSTATION',
    Event: 'booking.failed',
    'Booking ref': 'BR1789028629645454',
    Field: 'data.reason',
    Expected: 'Failure reason text',
    Actual: 'null',
    'Issue detail': 'Failed event has no reason why it failed.',
    'Event payload': pretty(payload('BR1789028629645454', 'booking.failed')),
  },
  {
    '#': 4,
    'Cab type': 'RENTAL',
    Event: 'booking.confirmed',
    'Booking ref': 'BR1789028742432814',
    Field: 'details.airportCode',
    Expected: 'null',
    Actual: 'PNQ',
    'Issue detail': 'Rental trip wrongly shows airport code.',
    'Event payload': pretty(payload('BR1789028742432814', 'booking.confirmed')),
  },
  {
    '#': 5,
    'Cab type': 'RENTAL',
    Event: 'trip.ended',
    'Booking ref': 'BR1789028742432814',
    Field: 'data.transaction',
    Expected: 'Settlement debit ~₹500',
    Actual: 'null',
    'Issue detail': 'Extra km in trip object, but no wallet settlement on ended.',
    'Event payload': pretty(payload('BR1789028742432814', 'trip.ended')),
  },
  {
    '#': 6,
    'Cab type': 'RENTAL',
    Event: 'trip.ended',
    'Booking ref': 'BR1789028742432814',
    Field: 'trip km fields',
    Expected: 'Coherent total vs extra',
    Actual: 'totalTravelledKm≈quote + extraTravelledKm=5',
    'Issue detail': 'Travelled km and extra km do not add up.',
    'Event payload': pretty(payload('BR1789028742432814', 'trip.ended')),
  },
  {
    '#': 7,
    'Cab type': 'RENTAL',
    Event: 'booking.failed',
    'Booking ref': 'BR1789031847299802',
    Field: 'providerBookingId',
    Expected: 'Omit',
    Actual: 'TVIPWE100926144705JYWZ',
    'Issue detail': 'Failed rental still has vendor id.',
    'Event payload': pretty(payload('BR1789031847299802', 'booking.failed')),
  },
  {
    '#': 8,
    'Cab type': 'RENTAL',
    Event: 'booking.failed',
    'Booking ref': 'BR1789031847299802',
    Field: 'data.reason',
    Expected: 'Failure reason text',
    Actual: 'null',
    'Issue detail': 'No failure reason.',
    'Event payload': pretty(payload('BR1789031847299802', 'booking.failed')),
  },
  {
    '#': 9,
    'Cab type': 'RENTAL',
    Event: 'booking.cancelled',
    'Booking ref': 'BR1789031824882449',
    Field: 'transaction credit vs refundAmount',
    Expected: 'Credit = refundAmount 1328.25',
    Actual: 'Credit 1278.25',
    'Issue detail': 'Refund says full amount; credit is ₹50 less.',
    'Event payload': pretty(payload('BR1789031824882449', 'booking.cancelled')),
  },
  {
    '#': 10,
    'Cab type': 'RENTAL',
    Event: 'booking.cancelled',
    'Booking ref': 'BR1789031824882449',
    Field: 'cancellation.id / requestedBy / requestedAt / reason / message',
    Expected: 'Populated',
    Actual: 'all null',
    'Issue detail': 'Cancel object missing id / who / when / why / message.',
    'Event payload': pretty(payload('BR1789031824882449', 'booking.cancelled')),
  },
  {
    '#': 11,
    'Cab type': 'AIRPORT DEPARTURE',
    Event: 'driver.enroute (after trip.started)',
    'Booking ref': 'BR1789032091575394',
    Field: 'event / tripStage',
    Expected: 'cab.location / Trip In Progress',
    Actual: 'driver.enroute / Driver Enroute',
    'Issue detail':
      'After trip started, GPS still uses driver-enroute event instead of cab.location.',
    'Event payload': pretty(postStartEnroute('BR1789032091575394', '2026-09-10T09:24:08Z')),
  },
  {
    '#': 12,
    'Cab type': 'AIRPORT DEPARTURE',
    Event: 'trip.ended',
    'Booking ref': 'BR1789032091575394',
    Field: 'data.transaction',
    Expected: 'Settlement debit ~₹500',
    Actual: 'null',
    'Issue detail': 'Extras shown, no settlement debit.',
    'Event payload': pretty(payload('BR1789032091575394', 'trip.ended')),
  },
  {
    '#': 13,
    'Cab type': 'AIRPORT DEPARTURE',
    Event: 'trip.ended',
    'Booking ref': 'BR1789032091575394',
    Field: 'trip km fields',
    Expected: 'Coherent',
    Actual: 'total ≈ quote + extra=5',
    'Issue detail': 'Same broken total vs extra km.',
    'Event payload': pretty(payload('BR1789032091575394', 'trip.ended')),
  },
  {
    '#': 14,
    'Cab type': 'AIRPORT DEPARTURE',
    Event: 'booking.failed',
    'Booking ref': 'BR1789032360514643',
    Field: 'providerBookingId',
    Expected: 'Omit',
    Actual: 'TVIPWE100926145131MIB4 (reused)',
    'Issue detail': "Failed reuses successful trip's vendor id.",
    'Event payload': pretty(payload('BR1789032360514643', 'booking.failed')),
  },
  {
    '#': 15,
    'Cab type': 'AIRPORT DEPARTURE',
    Event: 'booking.failed',
    'Booking ref': 'BR1789032360514643',
    Field: 'data.reason',
    Expected: 'Failure reason text',
    Actual: 'null',
    'Issue detail': 'No failure reason.',
    'Event payload': pretty(payload('BR1789032360514643', 'booking.failed')),
  },
  {
    '#': 16,
    'Cab type': 'AIRPORT DEPARTURE',
    Event: 'booking.cancelled',
    'Booking ref': 'BR1789032488187309',
    Field: 'credit vs refundAmount',
    Expected: '686.7',
    Actual: 'credit 636.7',
    'Issue detail': '₹50 short on cancel credit.',
    'Event payload': pretty(payload('BR1789032488187309', 'booking.cancelled')),
  },
  {
    '#': 17,
    'Cab type': 'AIRPORT DEPARTURE',
    Event: 'booking.cancelled',
    'Booking ref': 'BR1789032488187309',
    Field: 'cancellation.* meta',
    Expected: 'Populated',
    Actual: 'all null',
    'Issue detail': 'Cancel metadata empty.',
    'Event payload': pretty(payload('BR1789032488187309', 'booking.cancelled')),
  },
  {
    '#': 18,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'booking.confirmed',
    'Booking ref': 'BR1789033098766714',
    Field: 'details.otp',
    Expected: 'Present on confirm',
    Actual: '"" (empty)',
    'Issue detail':
      'Arrival confirm has no OTP; OTP only appears later on assign (113079).',
    'Event payload': pretty(payload('BR1789033098766714', 'booking.confirmed')),
  },
  {
    '#': 19,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'driver.enroute (after trip.started)',
    'Booking ref': 'BR1789033098766714',
    Field: 'event / tripStage',
    Expected: 'cab.location / Trip In Progress',
    Actual: 'driver.enroute / Driver Enroute',
    'Issue detail': 'Same wrong post-start event.',
    'Event payload': pretty(postStartEnroute('BR1789033098766714', '2026-09-10T09:41:02Z')),
  },
  {
    '#': 20,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'trip.ended',
    'Booking ref': 'BR1789033098766714',
    Field: 'data.transaction',
    Expected: 'Settlement debit ~₹500',
    Actual: 'null',
    'Issue detail': 'Extras without settlement debit.',
    'Event payload': pretty(payload('BR1789033098766714', 'trip.ended')),
  },
  {
    '#': 21,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'trip.ended',
    'Booking ref': 'BR1789033098766714',
    Field: 'trip km fields',
    Expected: 'Coherent',
    Actual: 'total ≈ quote + extra=5',
    'Issue detail': 'Same km inconsistency.',
    'Event payload': pretty(payload('BR1789033098766714', 'trip.ended')),
  },
  {
    '#': 22,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'booking.failed',
    'Booking ref': 'BR1789033354280851',
    Field: 'providerBookingId',
    Expected: 'Omit',
    Actual: 'TVIPWE1009261508185MRO (reused)',
    'Issue detail': 'Failed reuses success vendor id.',
    'Event payload': pretty(payload('BR1789033354280851', 'booking.failed')),
  },
  {
    '#': 23,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'booking.failed',
    'Booking ref': 'BR1789033354280851',
    Field: 'data.reason',
    Expected: 'Failure reason text',
    Actual: 'null',
    'Issue detail': 'No failure reason.',
    'Event payload': pretty(payload('BR1789033354280851', 'booking.failed')),
  },
  {
    '#': 24,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'booking.cancelled',
    'Booking ref': 'BR1789033392643859',
    Field: 'credit vs refundAmount',
    Expected: '585.9',
    Actual: 'credit 535.9',
    'Issue detail': '₹50 short on cancel credit.',
    'Event payload': pretty(payload('BR1789033392643859', 'booking.cancelled')),
  },
  {
    '#': 25,
    'Cab type': 'AIRPORT ARRIVAL',
    Event: 'booking.cancelled',
    'Booking ref': 'BR1789033392643859',
    Field: 'cancellation.* meta',
    Expected: 'Populated',
    Actual: 'all null',
    'Issue detail': 'Cancel metadata empty.',
    'Event payload': pretty(payload('BR1789033392643859', 'booking.cancelled')),
  },
];

const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [
  { wch: 4 },
  { wch: 18 },
  { wch: 36 },
  { wch: 22 },
  { wch: 42 },
  { wch: 34 },
  { wch: 34 },
  { wch: 70 },
  { wch: 120 },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Cab webhook issues');

const notes = XLSX.utils.aoa_to_sheet([
  ['Cab webhook PDF gap report — with event payloads'],
  ['Compared against https://api-docs.travelvip.ai/webhook/cab-webhooks.pdf'],
  ['Generated', new Date().toISOString()],
  [],
  ['Notes'],
  ['1. 6-digit OTP treated as expected (removed from issues).'],
  ['2. Event payload = full observed webhook JSON from live INSERT / paste logs.'],
  ['3. Row 11/19 include post-start driver.enroute GPS pings (should be cab.location).'],
  ['4. Row 18 arrival empty confirm OTP — confirm with product if expected.'],
]);
XLSX.utils.book_append_sheet(wb, notes, 'Notes');

fs.mkdirSync('reports', { recursive: true });
const out = 'reports/cab-webhook-issues-with-payloads.xlsx';
XLSX.writeFile(wb, out);

const missing = rows.filter((r) =>
  String(r['Event payload']).startsWith('(payload not found'),
);
console.log('Wrote', out);
console.log('Rows', rows.length);
console.log(
  'Missing payloads',
  missing.map((r) => r['#'] + ' ' + r['Booking ref'] + ' ' + r.Event),
);
console.log(
  'enroute DEP count',
  (postStartEnroute('BR1789032091575394', '2026-09-10T09:24:08Z') || []).length,
);
console.log(
  'enroute ARR count',
  (postStartEnroute('BR1789033098766714', '2026-09-10T09:41:02Z') || []).length,
);

/**
 * Update Partner API Testing CSV QA Status from 2026-07-20 re-verification.
 */
import fs from 'fs';

const CSV_PATH = 'Partner API Testing - DM.csv';
const NOTE = 'Re-verified 2026-07-20';

// Sr -> { status, notes }
const updates = {
  1: { status: 'Done', notes: `${NOTE}: HTTP 401 Invalid signature` },
  2: { status: 'Done', notes: `${NOTE}: HTTP 401 timestamp out of window` },
  3: { status: 'Done', notes: `${NOTE}: HTTP 400 Invalid tierId` },
  4: { status: 'Done', notes: `${NOTE}: HTTP 400 Invalid tierId` },
  5: { status: 'Not Fixed', notes: `${NOTE}: still HTTP 200 with text/plain + Accept application/xml` },
  6: {
    status: 'Not Fixed',
    notes: `${NOTE}: missing X-Request-Id → 400; null/omitted on refresh client still HTTP 200 (empty header → 400). Partial — keep open`,
  },
  7: { status: 'Done', notes: `${NOTE}: currency=USD returns USD` },
  8: { status: 'Not Fixed', notes: `${NOTE}: CORPORATE RT never completes (returnCount=0)` },
  9: {
    status: 'Not Fixed',
    notes: `${NOTE}: early select skipped in run (no early onward id); SEARCH_CACHE_MISS still a known RT timing issue — keep open`,
  },
  10: { status: 'Done', notes: `${NOTE}: reversed itinerary → HTTP 400` },
  11: {
    status: 'Not Fixed',
    notes: `${NOTE}: inconclusive — fare had supportsSeats=true with segments; need fare where seats NOT allowed`,
  },
  12: { status: 'Done', notes: `${NOTE}: supportsSeats=true → segments=1` },
  13: { status: 'Not Fixed', notes: `${NOTE}: intermittent vendor 502 — keep monitoring` },
  14: {
    status: 'Not Fixed',
    notes: `${NOTE}: still HTTP 200 (body wallet 502 / accepted path) — no clean HTTP 400 validation; Jest gap still fails`,
  },
  15: { status: 'Done', notes: `${NOTE}: HTTP 400 Validation failed — no BR` },
  16: { status: 'Done', notes: `${NOTE}: HTTP 400 Validation failed — no BR` },
  17: {
    status: 'Not Fixed',
    notes: `${NOTE}: still accepted at API (HTTP 200 / wallet 502) — Jest VALIDATION GAP fails`,
  },
  18: {
    status: 'Not Fixed',
    notes: `${NOTE}: still accepted at API (HTTP 200 / wallet 502) — Jest VALIDATION GAP fails`,
  },
  19: { status: 'Done', notes: `${NOTE}: HTTP 400 Validation failed — no BR` },
  20: { status: 'Done', notes: `${NOTE}: HTTP 400 Validation failed` },
  21: { status: 'Done', notes: `${NOTE}: HTTP 400 Validation failed — no BR` },
  22: {
    status: 'Not Fixed',
    notes: `${NOTE}: still HTTP 500 Failed to fetch flight pricing details (should be 400)`,
  },
  23: {
    status: 'Not Fixed',
    notes: `${NOTE}: pricing still returns bookingContext; issue-ticket still expects bookingReference`,
  },
  24: { status: 'Done', notes: `${NOTE}: HTTP 400 Validation failed for empty passport on intl` },
  25: {
    status: 'Not Fixed',
    notes: `${NOTE}: partially improved (email/dob/context fixed) but priceId + lastName gaps remain`,
  },
  26: {
    status: 'Not Fixed',
    notes: `${NOTE}: invalid priceId/lastName still HTTP 200 path — zombie BR risk depends on wallet; keep open`,
  },
  27: {
    status: 'Not Fixed',
    notes: `${NOTE}: invalid requests still can return HTTP 200 with deferred/wallet errors instead of clear issue-ticket validation`,
  },
  28: { status: 'Not Fixed', notes: `${NOTE}: not re-closed — status casing` },
  29: { status: 'Not Fixed', notes: `${NOTE}: not re-closed — totalPassengers` },
  30: { status: 'Not Fixed', notes: `${NOTE}: intermittent confirmation latency — monitor` },
  31: { status: 'Not Fixed', notes: `${NOTE}: not re-closed — provider error nesting` },
  32: { status: 'Not Fixed', notes: `${NOTE}: not re-closed — penalityAmount typo` },
  33: {
    status: 'Not Fixed',
    notes: `${NOTE}: OW CORPORATE OK; RT CORPORATE still never completes`,
  },
  34: {
    status: 'Not Fixed',
    notes: `${NOTE}: 2-step RT flow / early selection cache still required — keep open`,
  },
};

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function escapeCsv(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Parse full CSV preserving multiline quoted fields */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      if (ch === '\r') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const text = fs.readFileSync(CSV_PATH, 'utf8');
const rows = parseCsv(text).filter((r) => r.some((c) => String(c || '').trim()));
const header = rows[0];
const srIdx = header.indexOf('Sr No');
const statusIdx = header.indexOf('QA Status');
const notesIdx = header.indexOf('QA Notes');
const curlIdx = header.indexOf('Curl (Not Fixed)');

const out = [header.map(escapeCsv).join(',')];
let done = 0;
let open = 0;

for (let i = 1; i < rows.length; i++) {
  const cols = [...rows[i]];
  while (cols.length < header.length) cols.push('');
  const sr = Number(String(cols[srIdx] || '').trim());
  if (sr && updates[sr]) {
    const u = updates[sr];
    cols[statusIdx] = u.status;
    cols[notesIdx] = u.notes;
    if (u.status === 'Done') cols[curlIdx] = '';
    if (u.status === 'Done') done += 1;
    else open += 1;
  }
  out.push(cols.map(escapeCsv).join(','));
}

fs.writeFileSync(CSV_PATH, out.join('\n') + '\n', 'utf8');
console.log(`Updated sheet — Done: ${done} | Not Fixed: ${open}`);

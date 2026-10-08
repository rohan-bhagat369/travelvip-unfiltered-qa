/**
 * Build TravelVIP execution tracker from Centvis validated TCs.
 * Adds column: "Rohan TravelVIP Status"
 *
 * node scripts/build-byufuel-execution-tracker.js
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SRC = 'd:/Travel VIP API Automation/reports/byufuel-drive/validated-tcs-2026-09-25';
const OUT_DIR = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const ENV_URL = 'https://gather-tvs-reproduced-subdivision.trycloudflare.com';
const STATUS_COL = 'Rohan TravelVIP Status';
const ACTUAL_COL = 'Rohan TravelVIP Actual';
const EVIDENCE_COL = 'Evidence / Notes';
const DATE_COL = 'Executed Date (TravelVIP)';

fs.mkdirSync(OUT_DIR, { recursive: true });

function blankStatus() {
  return 'NOT TESTED';
}

function addTrackerCols(headerRow, valuesByHeader = {}) {
  const hdr = [...headerRow];
  const extras = [STATUS_COL, ACTUAL_COL, EVIDENCE_COL, DATE_COL];
  for (const e of extras) {
    if (!hdr.includes(e)) hdr.push(e);
  }
  return hdr;
}

function padRow(row, len) {
  const r = [...row];
  while (r.length < len) r.push('');
  return r;
}

/** Checklist: feature list with Works? - Krishna */
function buildChecklist() {
  const wb = XLSX.readFile(path.join(SRC, 'Byufuel-Check-list-Doc.xlsx'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' });
  const out = [];
  // Keep original columns + tracker
  const maxCols = Math.max(...rows.map((r) => r.length), 6);
  const header = padRow(
    ['#', 'Section', 'Feature / Case', 'Comments (Centvis)', 'Status (Centvis)', 'Works? - Krishna', STATUS_COL, ACTUAL_COL, EVIDENCE_COL, DATE_COL],
    10,
  );
  out.push(header);

  let section = '';
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const feat = String(rows[i][1] || '').trim();
    const comments = String(rows[i][3] || '').trim();
    const status = String(rows[i][4] || '').trim();
    const works = String(rows[i][5] || '').trim();
    if (!feat && !works) continue;
    if (/Features for Verification/i.test(feat)) {
      section = feat.replace(/\s+/g, ' ').trim();
      continue;
    }
    if (!feat) continue;
    n += 1;
    out.push([n, section, feat, comments, status, works, blankStatus(), '', '', '']);
  }
  return { name: '01-Checklist', rows: out, count: n };
}

/** Detailed TC sheets */
function buildDetailedTCs() {
  const wb = XLSX.readFile(path.join(SRC, 'Byufuel-TCs.xlsx'));
  const sheets = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    // Find header row
    let hi = 0;
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const j = rows[i].map(String).join('|');
      if (/Test script name|Expected Result|Works\?/i.test(j)) {
        hi = i;
        break;
      }
    }
    const baseHdr = rows[hi].map((c) => String(c || '').trim());
    while (baseHdr.length < 13) baseHdr.push('');
    // Ensure Works column label
    if (!baseHdr[12]) baseHdr[12] = 'Works? - Krishna';
    const hdr = [...baseHdr.slice(0, 13), STATUS_COL, ACTUAL_COL, EVIDENCE_COL, DATE_COL];

    const out = [];
    // meta
    out.push(['Pack', 'Byufuel-TCs', 'Sheet', sn, 'Env', ENV_URL]);
    out.push(hdr);

    let caseCount = 0;
    for (const r of rows.slice(hi + 1)) {
      if (!r.some((c) => String(c).trim())) continue;
      const row = padRow(r.slice(0, 13), 13);
      // count case when step is 1 or script name present with empty step start
      const step = String(row[5] || '').trim();
      const script = String(row[1] || '').trim();
      if (script && (step === '1' || step === '')) caseCount += step === '1' ? 1 : 0;
      out.push([...row, blankStatus(), '', '', '']);
    }
    sheets.push({ name: `TC-${sn}`.slice(0, 31), rows: out, count: caseCount, stepRows: out.length - 2 });
  }
  return sheets;
}

/** Simple TC packs: Bulk / TSM */
function buildSimplePack(file, sheetOutName) {
  const wb = XLSX.readFile(path.join(SRC, file));
  const sn = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });

  // Find header-ish row
  let hi = 0;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if (rows[i].some((c) => /Test Case|Test Scenario|TC0/i.test(String(c)))) {
      hi = i;
      break;
    }
  }

  const out = [];
  out.push(['Pack', file, 'Env', ENV_URL, 'Centvis column Pass/Works kept; add TravelVIP status']);
  out.push(['#', 'TC ID', 'Test Case / Scenario', 'Centvis Pass/Works', STATUS_COL, ACTUAL_COL, EVIDENCE_COL, DATE_COL]);

  let n = 0;
  // Heuristic: rows with TC## in col0 or Verify in col1/col2
  for (let i = hi; i < rows.length; i++) {
    const r = rows[i];
    const c0 = String(r[0] || '').trim();
    const c1 = String(r[1] || '').trim();
    const c2 = String(r[2] || '').trim();
    // skip pure headers
    if (/^(URL|Test Case ID|Test Scenario|Test Case)$/i.test(c0) || /^(URL|Test Case ID|Test Scenario)$/i.test(c1)) continue;

    let id = '';
    let title = '';
    let centvis = '';

    if (/^TC\d+/i.test(c0)) {
      id = c0;
      title = c1 || c2;
      // look for Pass/Yes in later cols
      for (let k = 2; k < r.length; k++) {
        const v = String(r[k] || '').trim();
        if (/^(Pass|Yes|Fail|No)$/i.test(v)) {
          centvis = v;
          break;
        }
      }
    } else if (/^Verify/i.test(c1) || /^Verify/i.test(c2)) {
      n += 1;
      id = `TC${String(n).padStart(2, '0')}`;
      title = /^Verify/i.test(c1) ? c1 : c2;
      for (let k = 0; k < r.length; k++) {
        const v = String(r[k] || '').trim();
        if (/^(Pass|Yes|Fail|No)$/i.test(v)) {
          centvis = v;
          break;
        }
      }
    } else {
      continue;
    }
    if (!title) continue;
    n = Math.max(n, parseInt((id.match(/\d+/) || [n])[0], 10) || n);
    out.push([out.length - 1, id, title.replace(/\s+/g, ' ').trim(), centvis, blankStatus(), '', '', '']);
  }

  // If heuristic failed, dump all non-empty as cases
  if (out.length <= 2) {
    let k = 0;
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].map((c) => String(c).trim()).filter(Boolean);
      if (cells.length < 1) continue;
      if (/^https?:/i.test(cells[0]) || /^URL$/i.test(cells[0])) continue;
      k += 1;
      const title = cells.find((c) => /verify|create|assign|login|menu/i.test(c)) || cells.join(' | ');
      const centvis = cells.find((c) => /^(Pass|Yes|Fail|No)$/i.test(c)) || '';
      out.push([k, `ROW${k}`, title.slice(0, 200), centvis, blankStatus(), '', '', '']);
    }
  }

  return { name: sheetOutName, rows: out, count: out.length - 2 };
}

function writeBook(sheets, filename) {
  const wb = XLSX.utils.book_new();
  // Summary first
  const summary = [
    ['Byufuel — TravelVIP execution tracker'],
    ['Env URL', ENV_URL],
    ['Built', new Date().toISOString()],
    ['Status values', 'PASS | FAIL | BLOCKED | NOT TESTED | PARTIAL'],
    ['Column', STATUS_COL, '← fill this for team report'],
    [],
    ['Sheet', 'Rows / Cases', 'Notes'],
  ];
  for (const s of sheets) {
    summary.push([s.name, s.count || s.rows.length - 2, '']);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), '00-Summary');

  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }

  const outPath = path.join(OUT_DIR, filename);
  XLSX.writeFile(wb, outPath);
  return outPath;
}

function alsoCsv(sheet, filename) {
  const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const p = path.join(OUT_DIR, filename);
  fs.writeFileSync(p, csv);
  return p;
}

const checklist = buildChecklist();
const tcSheets = buildDetailedTCs();
const bulk = buildSimplePack('Byufuel-Bulk-Schedule-web-TCs.xlsx', '02-Bulk-Schedule');
const tsmWeb = buildSimplePack('Byufuel-TSM-Web.xlsx', '03-TSM-Web');
const tsmMob = buildSimplePack('Byufuel-TSM-Mobile.xlsx', '04-TSM-Mobile');

const all = [checklist, bulk, tsmWeb, tsmMob, ...tcSheets];
const xlsxPath = writeBook(all, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
alsoCsv(checklist, '01-Checklist-tracker.csv');
alsoCsv(bulk, '02-Bulk-Schedule-tracker.csv');
alsoCsv(tsmWeb, '03-TSM-Web-tracker.csv');
alsoCsv(tsmMob, '04-TSM-Mobile-tracker.csv');

const meta = {
  env: ENV_URL,
  builtAt: new Date().toISOString(),
  xlsx: xlsxPath,
  sheets: all.map((s) => ({ name: s.name, count: s.count || s.rows.length - 2 })),
  totalRows: all.reduce((a, s) => a + (s.count || s.rows.length - 2), 0),
};
fs.writeFileSync(path.join(OUT_DIR, 'tracker-meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));

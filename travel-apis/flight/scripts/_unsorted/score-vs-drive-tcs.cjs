const XLSX = require('xlsx');
const path = require('path');

const TRACKER =
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx';
const DIR = 'd:/Travel VIP API Automation/reports/byufuel-drive';
const wb = XLSX.readFile(TRACKER);

function normStatus(s) {
  s = String(s || '')
    .trim()
    .toUpperCase();
  if (s === 'BUG') return 'FAIL';
  if (['PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT TESTED'].includes(s)) return s;
  return '';
}

function rollup(statuses) {
  // worst-first for a distinct TC made of steps
  const order = ['FAIL', 'BLOCKED', 'PARTIAL', 'NOT TESTED', 'PASS'];
  const set = new Set(statuses.map(normStatus).filter(Boolean));
  if (!set.size) return 'NOT TESTED';
  for (const o of order) if (set.has(o)) return o;
  return 'NOT TESTED';
}

function bump(map, st) {
  map[st] = (map[st] || 0) + 1;
}

const empty = () => ({
  PASS: 0,
  FAIL: 0,
  PARTIAL: 0,
  BLOCKED: 0,
  'NOT TESTED': 0,
});

const report = [];

// ---- 01 Checklist vs Drive checklist (feature rows) ----
{
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['01-Checklist'], {
    header: 1,
    defval: '',
  });
  const counts = empty();
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const feat = String(rows[i][2] || '').trim();
    if (!feat) continue;
    const st = normStatus(rows[i][6]) || 'NOT TESTED';
    bump(counts, st);
    n++;
  }
  report.push({ source: 'Check list Doc (56 features)', tracked: n, counts });
}

// ---- Bulk / TSM: distinct TC ID with status rollup ----
function packDistinct(sheetName, label, idCol, statusCol, headerRow) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
  });
  const by = new Map();
  for (let i = headerRow; i < rows.length; i++) {
    const id = String(rows[i][idCol] || '').trim();
    if (!id || /^#$/i.test(id) || /^tc id$/i.test(id) || /^pack$/i.test(id)) continue;
    // skip header-like
    if (/test case/i.test(id) && !/^TC\d+/i.test(id)) continue;
    const st = normStatus(rows[i][statusCol]);
    if (!by.has(id)) by.set(id, []);
    if (st) by.get(id).push(st);
  }
  const counts = empty();
  for (const [, sts] of by) bump(counts, rollup(sts));
  report.push({ source: label, tracked: by.size, counts, ids: [...by.keys()] });
}

// Inspect header positions
function findCols(sheetName, headerNeedle) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
  });
  let hi = rows.findIndex((r) =>
    r.some((c) => new RegExp(headerNeedle, 'i').test(String(c)))
  );
  if (hi < 0) hi = 1;
  const hdr = rows[hi].map(String);
  return {
    hi,
    hdr,
    iId: hdr.findIndex((h) => /TC ID|Test Case ID|#/i.test(h)),
    iStatus: hdr.findIndex((h) => /Rohan TravelVIP Status/i.test(h)),
    iCase: hdr.findIndex((h) => /^Test Case$/i.test(h.trim()) || /Test Case \/ Scenario/i.test(h)),
  };
}

{
  const c = findCols('02-Bulk-Schedule', 'Rohan TravelVIP Status|Test Case');
  packDistinct(
    '02-Bulk-Schedule',
    'Bulk Schedule web TC\'s',
    c.iId >= 0 ? c.iId : 1,
    c.iStatus,
    c.hi + 1
  );
}
{
  const c = findCols('03-TSM-Web', 'Rohan TravelVIP Status');
  packDistinct('03-TSM-Web', 'TSM (Web)', c.iId >= 0 ? c.iId : 1, c.iStatus, c.hi + 1);
}
{
  const c = findCols('04-TSM-Mobile', 'Rohan TravelVIP Status');
  packDistinct(
    '04-TSM-Mobile',
    'TSM (Mobile)',
    c.iId >= 0 ? c.iId : 1,
    c.iStatus,
    c.hi + 1
  );
}

// ---- Byufuel-TCs: distinct Test Case name, rollup Rohan status from steps ----
{
  const sheets = [
    'TC-Sheet1',
    'TC-Admin- Creation of Users',
    'TC-Supplier',
    'TC-Driver',
    'TC-WH User',
    'TC-Change Password',
    'TC-Rate Configuration',
  ];
  const allBy = new Map(); // key = sheet::tcName
  const perSheet = [];
  for (const sn of sheets) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    const hi = rows.findIndex((r) => r.some((c) => String(c).trim() === 'Test Case'));
    if (hi < 0) continue;
    const hdr = rows[hi].map(String);
    const iTC = hdr.findIndex((h) => /^Test Case$/i.test(h.trim()));
    const iStatus = hdr.findIndex((h) => /Rohan TravelVIP Status/i.test(h));
    const iStep = hdr.findIndex((h) => /Step Description/i.test(h));
    const by = new Map();
    let lastTC = '';
    for (let i = hi + 1; i < rows.length; i++) {
      let tc = String(rows[i][iTC] || '').trim();
      if (tc) lastTC = tc;
      else tc = lastTC;
      const step = String(rows[i][iStep] || '').trim();
      if (!tc || !step) continue;
      const st = normStatus(rows[i][iStatus]);
      if (!by.has(tc)) by.set(tc, []);
      if (st) by.get(tc).push(st);
      const key = sn + '::' + tc;
      if (!allBy.has(key)) allBy.set(key, []);
      if (st) allBy.get(key).push(st);
    }
    const counts = empty();
    for (const [, sts] of by) bump(counts, rollup(sts));
    perSheet.push({ sheet: sn, tracked: by.size, counts });
  }
  const counts = empty();
  for (const [, sts] of allBy) bump(counts, rollup(sts));
  report.push({
    source: "Byufuel-TC's (7 tabs, distinct Test Case)",
    tracked: allBy.size,
    counts,
    perSheet,
  });
}

// Grand total
const grand = empty();
let trackedTotal = 0;
for (const r of report) {
  trackedTotal += r.tracked;
  for (const k of Object.keys(grand)) grand[k] += r.counts[k] || 0;
}

const decided =
  grand.PASS + grand.FAIL + grand.PARTIAL + grand.BLOCKED;
const driveExpected = 221;

console.log(
  JSON.stringify(
    {
      driveExpectedDistinct: driveExpected,
      ourTrackedDistinct: trackedTotal,
      againstDrive: grand,
      passRateOfDecided: decided
        ? ((100 * grand.PASS) / decided).toFixed(1) + '%'
        : 'n/a',
      passRateOfDriveTotal: ((100 * grand.PASS) / driveExpected).toFixed(1) + '%',
      executedVsDrive:
        (
          (100 * (driveExpected - grand['NOT TESTED'])) /
          driveExpected
        ).toFixed(1) + '% have a non-NOT-TESTED status',
      byFile: report,
    },
    null,
    2
  )
);

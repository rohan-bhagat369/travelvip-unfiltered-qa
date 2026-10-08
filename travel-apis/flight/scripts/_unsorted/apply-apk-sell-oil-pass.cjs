const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'Nothing A015 + supplier APK · SCH-000006651';
const TODAY = '2026-09-25';
const wb = XLSX.readFile(TRACKER);

const map = [
  [
    /Sell Oil/i,
    'PASS',
    'PASS — Request new Pickup 26-Sep-26 · 8AM–11PM · Grade A · 10kg · Confirm → SCH-000006651 (₹1274.40). apk-sell-confirmed.png',
  ],
  [
    /Pickup|Drop/i,
    'PASS',
    'PASS — Pickup selected on Sell Oil; booked SCH-000006651 (Drop not used). apk-sell-ready.png / apk-sell-confirmed.png',
  ],
];

const sn = '01-Checklist';
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
const hdr = rows[hi].map(String);
const iStatus = hdr.indexOf('Rohan TravelVIP Status');
const iActual = hdr.indexOf('Rohan TravelVIP Actual');
const iEv = hdr.indexOf('Evidence / Notes');
const iDate = hdr.indexOf('Executed Date (TravelVIP)');
const iFeat = hdr.findIndex((h) => /Feature|Test Case/i.test(h));
const iSec = hdr.findIndex((h) => /^Section$/i.test(h));

let n = 0;
for (let r = hi + 1; r < rows.length; r++) {
  const sec = String(rows[r][iSec] || '');
  if (!/Supplier Features/i.test(sec)) continue;
  const feat = String(rows[r][iFeat] || '');
  for (const [re, status, actual] of map) {
    if (!re.test(feat)) continue;
    rows[r][iStatus] = status;
    rows[r][iActual] = actual;
    if (iEv >= 0) rows[r][iEv] = ENV;
    if (iDate >= 0) rows[r][iDate] = TODAY;
    n++;
    break;
  }
}
wb.Sheets[sn] = XLSX.utils.aoa_to_sheet(rows);
XLSX.writeFile(wb, TRACKER);

const tot = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
const checklistPending = [];
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const rs = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const h = rs.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (h < 0) continue;
  const is = rs[h].indexOf('Rohan TravelVIP Status');
  for (let r = h + 1; r < rs.length; r++) {
    const st = String(rs[r][is] || '').trim();
    if (tot.hasOwnProperty(st)) tot[st]++;
    if (name === '01-Checklist' && st === 'NOT TESTED') {
      checklistPending.push([rs[r][0], rs[r][1], rs[r][2]].join(' | '));
    }
  }
}
console.log(JSON.stringify({ patched: n, totals: tot, checklistPending }, null, 2));

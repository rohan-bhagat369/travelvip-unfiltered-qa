const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const TODAY = '2026-09-28';
const EV = 'APK 1.0.8 com.byufuel.mobile Nothing 00117648V003247 qa.supplier.byufuel@yopmail.com';

// Excel row number -> [status, actual]
const byRow = {
  14: [
    'PASS',
    'Contact 12345 shows Please enter a valid phone number.',
  ],
  15: [
    'PASS',
    'Email bademail shows Please enter a valid email address.',
  ],
  16: [
    'BUG',
    'Existing phone 9876501001 and qa.supplier.byufuel@yopmail.com were accepted on the form. Submit leaves the BYUFUEL splash on Sign Up. No already-in-use message after waiting.',
  ],
  18: [
    'PASS',
    'Different confirm password shows Passwords do not match.',
  ],
  21: [
    'PASS',
    'Establishment section shows Establishment Name, Country (India), GSTIN Number, Restaurant ID, Establishment Type, Restaurant Contact Number, Restaurant Email, and Submit.',
  ],
  22: [
    'FAIL',
    'Sign Up has no Mark Your Location section. After the account fields the form goes to Establishment Profile, then Submit.',
  ],
  23: [
    'FAIL',
    'No interactive map on Sign Up.',
  ],
  24: [
    'FAIL',
    'No address fields and no map, so a mismatch between address and pin cannot be shown.',
  ],
  25: [
    'FAIL',
    'No map pin to place.',
  ],
  28: [
    'FAIL',
    'No location-based services section on Sign Up.',
  ],
  29: [
    'FAIL',
    'No bank details section on Sign Up. Account Number, Re-enter Account Number, IFSC, and Branch are not on the form.',
  ],
  30: [
    'FAIL',
    'Account Number field is not on Sign Up.',
  ],
  31: [
    'FAIL',
    'Re-enter Account Number field is not on Sign Up.',
  ],
  32: [
    'FAIL',
    'IFSC field is not on Sign Up.',
  ],
  33: [
    'FAIL',
    'Branch field is not on Sign Up.',
  ],
  34: [
    'FAIL',
    'Bank details cannot be submitted. That section is not on Sign Up.',
  ],
  35: [
    'FAIL',
    'Invalid IFSC cannot be entered. The bank section is not on Sign Up.',
  ],
  36: [
    'FAIL',
    'Bank verification confirmation is not reachable. Sign Up has no bank form.',
  ],
};

const wb = XLSX.readFile(TRACKER);
const sn = 'TC-Sheet1';
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
const hdr = rows[hi].map(String);
const iStatus = hdr.indexOf('Rohan TravelVIP Status');
const iActual = hdr.indexOf('Rohan TravelVIP Actual');
const iEv = hdr.indexOf('Evidence / Notes');
const iDate = hdr.indexOf('Executed Date (TravelVIP)');

let n = 0;
for (const [rowNo, pair] of Object.entries(byRow)) {
  const r = Number(rowNo) - 1;
  const [status, actual] = pair;
  rows[r][iStatus] = status;
  rows[r][iActual] = actual;
  if (iEv >= 0) rows[r][iEv] = EV;
  if (iDate >= 0) rows[r][iDate] = TODAY;
  n++;
}
wb.Sheets[sn] = XLSX.utils.aoa_to_sheet(rows);

function countSheet(name) {
  const rs = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const h = rs.findIndex((row) => row.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (h < 0) return null;
  const is = rs[h].map(String).indexOf('Rohan TravelVIP Status');
  const tally = { PASS: 0, FAIL: 0, PARTIAL: 0, BUG: 0, BLOCKED: 0, 'NOT TESTED': 0 };
  for (let r = h + 1; r < rs.length; r++) {
    if (!rs[r].some((x) => String(x).trim())) continue;
    const st = String(rs[r][is] || '').trim() || 'NOT TESTED';
    if (tally[st] == null) tally[st] = 0;
    tally[st] += 1;
  }
  return tally;
}

const bySheet = {};
const tot = { PASS: 0, FAIL: 0, PARTIAL: 0, BUG: 0, BLOCKED: 0, 'NOT TESTED': 0 };
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const tally = countSheet(name);
  if (!tally) continue;
  bySheet[name] = tally;
  for (const k of Object.keys(tot)) tot[k] += tally[k] || 0;
}

const sum = XLSX.utils.sheet_to_json(wb.Sheets['00-Summary'], { header: 1, defval: '' });
sum[2][1] = TODAY;
sum[6][0] = tot.PASS;
sum[6][1] = tot.FAIL;
sum[6][2] = tot.PARTIAL;
sum[6][3] = tot.BLOCKED;
sum[6][4] = tot['NOT TESTED'];
sum[6][5] = tot.PASS + tot.FAIL + tot.PARTIAL + tot.BUG + tot.BLOCKED + tot['NOT TESTED'];
for (let r = 0; r < sum.length; r++) {
  const name = String(sum[r][0] || '');
  if (!bySheet[name]) continue;
  const t = bySheet[name];
  sum[r][1] = t.PASS || 0;
  sum[r][2] = t.FAIL || 0;
  sum[r][3] = t.PARTIAL || 0;
  sum[r][4] = t.BLOCKED || 0;
  sum[r][5] = t['NOT TESTED'] || 0;
  sum[r][6] = t.BUG || 0;
}
const note = [
  'Supplier Sign Up APK',
  TODAY,
  'Contact, email, and password-mismatch PASS. Duplicate submit stuck on BYUFUEL splash (BUG). Location, map, and bank sections are not on Sign Up (FAIL). OTP and password-reset rows still NOT TESTED. Supplier logged back in. Password unchanged.',
  EV,
  '',
  '',
];
const noteAt = sum.findIndex((r) => String(r[0]).startsWith('Supplier Sign Up APK'));
if (noteAt >= 0) sum[noteAt] = note;
else sum.push(note);
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);

const tmp = TRACKER.replace(/\.xlsx$/, '.tmp.xlsx');
XLSX.writeFile(wb, tmp);
fs.copyFileSync(tmp, TRACKER);
fs.unlinkSync(tmp);
console.log(JSON.stringify({ updated: n, tot, total: sum[6][5], sheet1: bySheet['TC-Sheet1'] }, null, 2));

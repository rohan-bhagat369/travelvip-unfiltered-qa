const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const TODAY = '2026-09-28';

const sheets = {
  'TC-WH User': {
    ev: 'https://yopmail.com/rohan.wh.byufuel',
    rows: {
      10: ['PASS', 'Inbox now has 1 mail from no-reply@byufuel.in: Access Granted to BYUFUEL Platform, 14:40. It was empty on the earlier check.'],
    },
  },
  'TC-Admin- Creation of Users': {
    ev: 'https://yopmail.com/rohan.wh.byufuel',
    rows: {
      27: ['PASS', 'WH worker mail arrived: Access Granted to BYUFUEL Platform. Supplier inbox rohan.supplier.byufuel is still empty.'],
    },
  },
  'TC-Sheet1': {
    ev: 'APK 1.0.8 com.byufuel.mobile Nothing 00117648V003247',
    rows: {
      10: ['PASS', 'Retest: Sign Up opens and scrolls. Account fields and Establishment Profile are on the form. Splash did not block this pass.'],
      11: ['FAIL', 'Retest: form order is account, then Establishment, then Submit. Location and bank sections are still not on Sign Up.'],
      17: ['FAIL', 'Rule note is shown. Change Password Update of abcdef plus a different confirm shows no error. Password was not changed.'],
      19: ['PASS', 'Unchecking I represent an establishment hides Establishment Profile. Submit stays.'],
      20: ['PASS', 'Establishment Profile is visible while the box is checked and hidden after uncheck.'],
      38: ['BUG', 'Retest: Forgot Password OTP still ends on The {name} with the identifier {id} was not found. Password unchanged.'],
    },
  },
  'TC-Supplier': {
    ev: 'APK 1.0.8 com.byufuel.mobile Nothing 00117648V003247',
    rows: {
      3: ['PASS', 'Retest: Sign Up scrolls from account fields through Establishment to Submit. Splash did not block.'],
      5: ['FAIL', 'Retest: location and bank are still missing from the signup sequence.'],
      10: ['FAIL', 'Rule note is shown. Weak and mismatched Change Password values produce no error.'],
      12: ['PASS', 'Uncheck hides Establishment Profile.'],
      13: ['PASS', 'Establishment section follows the checkbox and disappears when it is unchecked.'],
    },
  },
  'TC-Change Password': {
    ev: 'APK 1.0.8 com.byufuel.mobile Nothing 00117648V003247',
    rows: {
      3: ['BUG', 'Retest: OTP submit still shows the broken {name}/{id} message. New-password step is not reached. Password unchanged.'],
    },
  },
};

const wb = XLSX.readFile(TRACKER);
let updated = 0;
for (const [name, spec] of Object.entries(sheets)) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  for (const [rowNo, pair] of Object.entries(spec.rows)) {
    const r = Number(rowNo) - 1;
    rows[r][iStatus] = pair[0];
    rows[r][iActual] = pair[1];
    if (iEv >= 0) rows[r][iEv] = spec.ev;
    if (iDate >= 0) rows[r][iDate] = TODAY;
    updated++;
  }
  wb.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
}

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
  'Fail partial blocked retest',
  TODAY,
  'Ngrok still ERR_NGROK_3200. UCO Pickup stays BLOCKED. Azure Grade A only, QR still count+warehouse, UCO config does not open. WH Access Granted mail now PASS. Supplier registration mail still empty. Signup checkbox PASS. Map, bank-on-signup, OTP template, and password rules still fail. TSM prospect and supplier lists still empty.',
  'https://u-byufuel.azurewebsites.net + APK 1.0.8',
  '',
  '',
];
const noteAt = sum.findIndex((row) => String(row[0]).startsWith('Fail partial blocked'));
if (noteAt >= 0) sum[noteAt] = note;
else sum.push(note);
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);
const tmp = TRACKER.replace(/\.xlsx$/, '.tmp.xlsx');
XLSX.writeFile(wb, tmp);
try {
  fs.copyFileSync(tmp, TRACKER);
  fs.unlinkSync(tmp);
  console.log('WROTE ' + JSON.stringify({ updated, tot, total: sum[6][5] }));
} catch (e) {
  console.log('LOCKED ' + e.code);
  console.log(JSON.stringify({ updated, tot, total: sum[6][5] }));
}

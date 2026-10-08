const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const TODAY = '2026-09-28';
const EV = 'APK 1.0.8 Nothing 00117648V003247 qa.supplier.byufuel@yopmail.com';

const SIGN_LINK = 'Sign Up opens Create your account.';
const SIGN_FIELDS =
  'Form shows First Name, Last Name, Contact +91, Email, Operational Area, Password, Confirm Password. Password note: 8 characters with a number, upper, lower, and one special character. A splash logo covers the form, so the fields could not be typed.';
const SIGN_PAGE =
  'Account fields then Establishment Profile are on screen. Location and Bank were not reached. The splash blocked scroll and typing.';
const SIGN_CHECK =
  'I represent an establishment is checked and Establishment Profile is visible. Uncheck was not completed. The splash blocked typing.';
const FORM =
  'Forgot Password form has an email/phone field and Send OTP. The button label is Send OTP.';
const UNREG = 'nobody.notreal@yopmail.com shows User not registered. Sign up now.';
const REG =
  'qa.supplier.byufuel@yopmail.com returns HTTP 201. Verification Code screen asks for a 6-digit code. A timer is shown.';
const BAD = '000000 shows Invalid OTP.';
const RESEND = 'Resend OTP returns HTTP 201 and restarts the timer.';
const LOC1 = 'Location menu lists Andheri, FC Road, and Add/Edit Location.';
const LOC2 = 'Selected FC Road. Home header changed to 12, FC Road. Switched back to Andheri.';
const NAV = 'Chat opens a thread. The bell opens Notifications with Unread and All. Profile shows QA Supplier.';
const ICONS = 'Bottom bar is labeled Home, Upcoming, History, Reports. Top icons are chat, bell, and profile.';
const DASH =
  'Reports Revenue summary shows Apr-Sep 2026, Sep 5900. Pickup details shows Sep 4. There is no last-month or last-quarter picker.';
const UP = 'Upcoming tab shows Filter, Reset, and No schedules found. Home also shows Upcoming Schedules and No schedules found.';
const LOGIN = 'Logged in as qa.supplier.byufuel@yopmail.com. Home shows Hi QA.';

const wb = XLSX.readFile(TRACKER);

function cols(rows) {
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  const hdr = rows[hi].map(String);
  return {
    hi,
    iStatus: hdr.indexOf('Rohan TravelVIP Status'),
    iActual: hdr.indexOf('Rohan TravelVIP Actual'),
    iEv: hdr.indexOf('Evidence / Notes'),
    iDate: hdr.indexOf('Executed Date (TravelVIP)'),
  };
}

function load(sheet) {
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
}

const cache = {};
function rowsOf(sheet) {
  if (!cache[sheet]) cache[sheet] = load(sheet);
  return cache[sheet];
}

function setRow(sheet, index, status, actual) {
  const rows = rowsOf(sheet);
  const c = cols(rows);
  rows[index][c.iStatus] = status;
  rows[index][c.iActual] = actual;
  rows[index][c.iEv] = EV;
  rows[index][c.iDate] = TODAY;
}

function applySignup(sheet, map) {
  for (const [index, hit] of Object.entries(map)) setRow(sheet, Number(index), hit[0], hit[1]);
}

applySignup('TC-Sheet1', {
  7: ['PASS', FORM],
  8: ['PASS', SIGN_LINK],
  9: ['PARTIAL', SIGN_FIELDS],
  10: ['PARTIAL', SIGN_PAGE],
  12: ['PASS', SIGN_FIELDS],
  16: ['PARTIAL', 'Password rule text is shown on the form. A weak password was not submitted. The splash blocked typing.'],
  18: ['PARTIAL', SIGN_CHECK],
  19: ['PARTIAL', SIGN_CHECK],
  37: ['PARTIAL', 'OTP path PASS. Expiry wait and new-password steps were not run, so the login password is unchanged.'],
  38: ['PASS', FORM],
  39: ['PASS', FORM],
  40: ['PASS', UNREG],
  41: ['PASS', REG],
  42: ['PASS', BAD],
  43: ['PASS', RESEND],
  68: ['PASS', LOC1],
  69: ['PASS', LOC2],
  75: ['PASS', ICONS],
});

applySignup('TC-Supplier', {
  2: ['PARTIAL', SIGN_FIELDS],
  3: ['PASS', SIGN_LINK],
  4: ['PARTIAL', SIGN_PAGE],
  5: ['PASS', SIGN_FIELDS],
  11: ['PARTIAL', SIGN_CHECK],
  12: ['PARTIAL', SIGN_CHECK],
  41: ['PASS', LOGIN],
  42: ['PASS', LOGIN],
  51: ['PASS', NAV],
  52: ['PASS', ICONS],
  54: ['PASS', NAV],
  55: ['PASS', 'Profile opens QA Supplier, phone 9876501001, qa.supplier.byufuel@yopmail.com.'],
  56: ['PARTIAL', DASH],
  57: ['PASS', DASH],
  58: ['PASS', UP],
});

applySignup('TC-Change Password', {
  2: ['PARTIAL', 'OTP path PASS. Expiry wait and new-password steps were not run, so the login password is unchanged.'],
  3: ['PASS', FORM],
  4: ['PASS', FORM],
  5: ['PASS', FORM],
  6: ['PASS', UNREG],
  7: ['PASS', REG],
  8: ['PASS', BAD],
  9: ['PASS', RESEND],
});

for (const name of Object.keys(cache)) {
  wb.Sheets[name] = XLSX.utils.aoa_to_sheet(cache[name]);
}

function countSheet(name) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const c = cols(rows);
  if (c.hi < 0 || c.iStatus < 0) return null;
  const tally = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
  for (let r = c.hi + 1; r < rows.length; r++) {
    if (!rows[r].some((x) => String(x).trim())) continue;
    const st = String(rows[r][c.iStatus] || '').trim() || 'NOT TESTED';
    if (!tally[st]) tally[st] = 0;
    tally[st] += 1;
  }
  return tally;
}

const bySheet = {};
const tot = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
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
sum[6][5] = Object.values(tot).reduce((a, b) => a + b, 0);
for (let r = 0; r < sum.length; r++) {
  const name = String(sum[r][0] || '');
  if (!bySheet[name]) continue;
  const t = bySheet[name];
  sum[r][1] = t.PASS || 0;
  sum[r][2] = t.FAIL || 0;
  sum[r][3] = t.PARTIAL || 0;
  sum[r][4] = t.BLOCKED || 0;
  sum[r][5] = t['NOT TESTED'] || 0;
}
const note = [
  'APK safe cases',
  TODAY,
  'Supplier APK: location PASS, chat/bell/profile PASS, reports charts PASS (no quarter picker), forgot-password OTP PASS, sign-up form PARTIAL (splash blocked typing). Password was not changed.',
  EV,
  '',
  '',
];
const noteAt = sum.findIndex((r) => String(r[0]).startsWith('APK safe cases'));
if (noteAt >= 0) sum[noteAt] = note;
else sum.push(note);
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);

const tmp = TRACKER.replace(/\.xlsx$/, '.tmp.xlsx');
XLSX.writeFile(wb, tmp);
fs.copyFileSync(tmp, TRACKER);
fs.unlinkSync(tmp);
console.log(JSON.stringify({ tot, total: sum[6][5], bySheet }, null, 2));

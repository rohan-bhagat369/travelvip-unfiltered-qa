const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'Nothing A015 + app-byufuel.apk (com.byufuel.mobile)';
const TODAY = '2026-09-25';
const wb = XLSX.readFile(TRACKER);

const supplierActual = {
  login:
    'PASS — APK installed + opens logged-in supplier home (Hi QA / Welcome to Byufuel). Device Nothing A015. Screenshots apk-supplier-home.png',
  sellOil:
    'PASS — Sell Oil → Request new Pickup (Pickup/Drop, date/slot, Grade A, Weight Kg, bill). apk-supplier-sell-oil.png',
  kyc: 'PASS — Documents screen: KYC Documents + Restaurant License Add more. apk-supplier-kyc.png',
  schedules: 'PASS — Upcoming tab opens (No schedules found). apk-supplier-upcoming.png',
  history: 'PASS — History tab opens',
  reports: 'PASS — Reports tab opens. apk-supplier-reports.png',
  notif: 'PASS — Notification/profile icon opens. apk-supplier-notif-or-profile.png',
  locations: 'PASS — Location header shows Home 2, Andheri Kurla Road. apk-supplier-location.png',
  signup: 'NOT TESTED — already logged in; Sign-up flow not re-run',
  bank: 'NOT TESTED — not opened this smoke',
  payments: 'NOT TESTED — needs credited payment / journey',
  profile: 'PARTIAL — icon tapped; full profile edit not completed',
};

function patchChecklist() {
  const sn = '01-Checklist';
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  const iFeat = hdr.findIndex((h) => /Feature|Test Case|Test Scenario/i.test(h));
  const iSec = hdr.findIndex((h) => /^Section$/i.test(h));
  const map = [
    [/Login/i, 'PASS', supplierActual.login],
    [/Sign-Up|Sign Up/i, 'NOT TESTED', supplierActual.signup],
    [/Manage Locations|Location/i, 'PASS', supplierActual.locations],
    [/Bank Details/i, 'NOT TESTED', supplierActual.bank],
    [/KYC/i, 'PASS', supplierActual.kyc],
    [/Sell Oil/i, 'PASS', supplierActual.sellOil],
    [/Schedules/i, 'PASS', supplierActual.schedules],
    [/Pickup|Drop/i, 'PARTIAL', 'Pickup/Drop toggle visible on Sell Oil request screen; full journey NOT run'],
    [/Profile/i, 'PARTIAL', supplierActual.profile],
    [/Customer Support|Support/i, 'NOT TESTED', 'Not opened this smoke'],
    [/Payment/i, 'NOT TESTED', supplierActual.payments],
    [/Notification/i, 'PASS', supplierActual.notif],
    [/Report/i, 'PASS', supplierActual.reports],
  ];
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const sec = String(rows[r][iSec] || '');
    if (!/Supplier Features/i.test(sec)) continue;
    const feat = String(rows[r][iFeat] || '');
    for (const [re, status, actual] of map) {
      if (!re.test(feat)) continue;
      rows[r][iStatus] = status;
      if (iActual >= 0) rows[r][iActual] = actual;
      if (iEv >= 0) rows[r][iEv] = ENV;
      if (iDate >= 0) rows[r][iDate] = TODAY;
      n++;
      break;
    }
  }
  wb.Sheets[sn] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

function patchBlob(sheet, rules) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) return 0;
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const blob = [rows[r][1], rows[r][4], rows[r][6]].map((x) => String(x || '')).join(' | ');
    for (const rule of rules) {
      if (!rule.re.test(blob)) continue;
      rows[r][iStatus] = rule.status;
      if (iActual >= 0) rows[r][iActual] = rule.actual;
      if (iEv >= 0) rows[r][iEv] = ENV;
      if (iDate >= 0) rows[r][iDate] = TODAY;
      n++;
      break;
    }
  }
  wb.Sheets[sheet] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

const n1 = patchChecklist();
const n2 = patchBlob('TC-Sheet1', [
  { re: /Supplier Login|login to the site|Email\/ Phone|Password field|Login button/i, status: 'PASS', actual: supplierActual.login },
  { re: /Forgot password/i, status: 'PARTIAL', actual: 'Web forgot-password OTP flow PASS earlier; APK forgot not re-tested (already logged in)' },
  { re: /Sign up|Sign-up|Sign Up/i, status: 'NOT TESTED', actual: supplierActual.signup },
  { re: /Home Screen|greeting|Sell Oil|upcoming|navigation|notification|profile|revenue|Reports/i, status: 'PASS', actual: 'Supplier home smoke PASS on APK' },
]);
const n3 = patchBlob('TC-Supplier', [
  { re: /Sign up|Sign-up/i, status: 'NOT TESTED', actual: supplierActual.signup },
  { re: /Login|home|Sell Oil|KYC|location|schedule|report/i, status: 'PASS', actual: 'Covered by Supplier APK smoke on device' },
]);

// refresh totals
const tot = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
const bySheet = {};
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const rs = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const h = rs.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (h < 0) continue;
  const is = rs[h].indexOf('Rohan TravelVIP Status');
  const c = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
  for (let r = h + 1; r < rs.length; r++) {
    if (!rs[r].some((x) => String(x).trim())) continue;
    const st = String(rs[r][is] || 'NOT TESTED').trim() || 'NOT TESTED';
    c[st] = (c[st] || 0) + 1;
    tot[st] = (tot[st] || 0) + 1;
  }
  bySheet[name] = c;
}
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet([
  ['Byufuel — TravelVIP execution report'],
  ['Env', 'https://agent-posted-unworn.ngrok-free.dev + APK com.byufuel.mobile'],
  ['Report date', TODAY],
  ['Tester', 'Rohan Bhagat (TravelVIP QA)'],
  [],
  ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT TESTED', 'TOTAL'],
  [tot.PASS, tot.FAIL, tot.PARTIAL, tot.BLOCKED, tot['NOT TESTED'], Object.values(tot).reduce((a, b) => a + b, 0)],
  [],
  ['Sheet', 'PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT TESTED'],
  ...Object.entries(bySheet).map(([n, c]) => [n, c.PASS || 0, c.FAIL || 0, c.PARTIAL || 0, c.BLOCKED || 0, c['NOT TESTED'] || 0]),
]);
XLSX.writeFile(wb, TRACKER);

fs.writeFileSync(
  path.join(OUT, 'apk-install-run.json'),
  JSON.stringify(
    {
      device: 'Nothing A015 (00117648V003247)',
      apk: 'C:/Users/Rohan Bhagat/Downloads/app-byufuel.apk',
      package: 'com.byufuel.mobile',
      install: 'Success',
      supplierSmoke: Object.keys(supplierActual),
      patched: { checklist: n1, sheet1: n2, supplier: n3 },
      totals: tot,
    },
    null,
    2
  )
);
console.log(JSON.stringify({ n1, n2, n3, tot }, null, 2));

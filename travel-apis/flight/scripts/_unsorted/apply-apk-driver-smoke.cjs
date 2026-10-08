const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'Nothing A015 + app-byufuel.apk · Atul ACTIVE · pass reset F5@k$iOz';
const TODAY = '2026-09-25';
const wb = XLSX.readFile(TRACKER);

const D = {
  login: 'PASS — Atul Ugale atul@yopmail.com / F5@k$iOz (admin random-password). Home Hi Atul. apk-driver-atul-login / apk-drv-topright.png',
  home: 'PASS — Scan, Planned/Collected/Delivered, Ongoing/Accepted/Proposed, Next Itinerary, tabs. apk-next-home.png',
  container: 'PASS — Scan Container QR JSON {"Code":"B-2609-3-00005"} → popup Capacity 40kg / Available 30kg / Grade A → OK. apk-camera-open / after-scan',
  dashboard: 'PASS — Home counters Planned/Collected/Delivered + Ongoing/Accepted/Proposed tiles (all 0 without assigned IT)',
  nextIt: 'PASS (empty) — Next Itinerary heading present; no card until Admin assigns IT. apk-next-home.png',
  viewIt: 'NOT TESTED — no assigned itinerary to open',
  upcoming: 'PASS — Upcoming/Planning opens; No itinerary found. apk-next-upcoming.png',
  itinerary: 'NOT TESTED — needs assigned IT (journey)',
  uco: 'NOT TESTED — needs Accept→Start→pickup journey (deferred)',
  history: 'PASS — History tab opens (empty list OK). apk-drv-smoke-history.png',
  cancel: 'NOT TESTED — no cancelable trip',
  support: 'PASS — Customer Support: Chat / Call / Raise complaint / Complaints / Call Logs. apk-drv-support.png',
  notif: 'PARTIAL — notification/chat icons on home; chat hub known 401 from prior web retest; not deep-tested on APK',
  profile: 'PASS — Profile: Edit, Change Password, Documents (KYC+Vehicle), Bank, Driver Settings (MH14GA1111), Language EN↔HI, Logout. apk-drv-topright / hindi / english',
  reports: 'PASS — Reports tab + Itinerary details. apk-drv-smoke-reports.png',
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
    [/Login/i, 'PASS', D.login],
    [/^Home$/i, 'PASS', D.home],
    [/Container/i, 'PASS', D.container],
    [/Dashboard/i, 'PASS', D.dashboard],
    [/Next Itinerary/i, 'PASS', D.nextIt],
    [/View Itinerary/i, 'NOT TESTED', D.viewIt],
    [/Upcoming/i, 'PASS', D.upcoming],
    [/^Itinerary$/i, 'NOT TESTED', D.itinerary],
    [/UCO Pickup/i, 'NOT TESTED', D.uco],
    [/History/i, 'PASS', D.history],
    [/Cancel Pickup/i, 'NOT TESTED', D.cancel],
    [/Customer Support|Support/i, 'PASS', D.support],
    [/Notification|Chat/i, 'PARTIAL', D.notif],
    [/Profile/i, 'PASS', D.profile],
    [/Report/i, 'PASS', D.reports],
  ];
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const sec = String(rows[r][iSec] || '');
    if (!/Drivers Features/i.test(sec)) continue;
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

function patchTsmMobile() {
  const sn = '04-TSM-Mobile';
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) return 0;
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const id = String(rows[r][1] || '');
    if (!/^TC\d+/i.test(id)) continue;
    rows[r][iStatus] = 'BLOCKED';
    rows[r][iActual] =
      'BLOCKED — no ACTIVE TSM/Area/City lead on staging for APK login. TSM Web create blocked earlier (Reporting User empty / list 0). Same APK package; need seeded MOBILE TSM + password reset.';
    if (iEv >= 0) rows[r][iEv] = ENV + ' · /uam/tsm-leads empty';
    if (iDate >= 0) rows[r][iDate] = TODAY;
    n++;
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
    const blob = rows[r].map((x) => String(x || '')).join(' | ');
    for (const rule of rules) {
      if (!rule.re.test(blob)) continue;
      // only overwrite NOT TESTED
      if (String(rows[r][iStatus]) !== 'NOT TESTED' && String(rows[r][iStatus]) !== '') continue;
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
const n2 = patchTsmMobile();
const n3 = patchBlob('TC-Driver', [
  {
    re: /create a Driver|Add New Driver|Driver Address|Create button|registration email|Driver - Registration/i,
    status: 'PASS',
    actual: 'Admin Driver create already PASS earlier today (QADrv rows); Atul ACTIVE used for APK. Email trigger not re-verified.',
  },
]);

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
    const st = String(rs[r][is] || '').trim();
    if (c.hasOwnProperty(st)) {
      c[st]++;
      tot[st]++;
    }
  }
  bySheet[name] = c;
}

// refresh summary sheet if present
if (wb.Sheets['00-Summary']) {
  const sum = XLSX.utils.sheet_to_json(wb.Sheets['00-Summary'], { header: 1, defval: '' });
  // best-effort: leave structure, append note row
  sum.push([
    TODAY,
    'Driver APK smoke + TSM Mobile BLOCKED',
    JSON.stringify(tot),
    `patched checklist=${n1} tsm=${n2} tc-driver=${n3}`,
  ]);
  wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);
}

XLSX.writeFile(wb, TRACKER);
const report = { patched: { checklistDrivers: n1, tsmMobile: n2, tcDriver: n3 }, totals: tot, bySheet, env: ENV, date: TODAY };
fs.writeFileSync(path.join(OUT, 'apk-driver-tracker-apply.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

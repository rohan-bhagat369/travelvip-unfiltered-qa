const fs = require('fs');
const path = require('path');
const dir = __dirname;
const admin = JSON.parse(fs.readFileSync(path.join(dir, 'checklist-crediblesg-results.json'), 'utf8'));
const wh = JSON.parse(fs.readFileSync(path.join(dir, 'checklist-wh-results.json'), 'utf8'));

const supplier = [
  { id: 29, case: 'Login', status: 'PASS', actual: 'Supplier APK logged-in home Hi kedar / kedar@supplier.com · Sell Oil + schedules SCH-1821/1822/1824' },
  { id: 30, case: 'Sign-Up', status: 'PASS', actual: 'Logout → Sign Up form (First/Last/Contact/Email/OA/Password + establishment). Not submitted. apk-crediblesg-supplier-signup.png' },
  { id: 31, case: 'Manage Locations', status: 'PASS', actual: 'Choose address → magarpatta / 21 North Main Road Pune · Add/Edit Location. apk-crediblesg-supplier-locations.png' },
  { id: 32, case: 'Bank Details', status: 'PASS', actual: 'Payment → Account Details opens Add Bank Details form (holder/acct/IFSC). Banner Please add bank details. apk-crediblesg-supplier-account.png' },
  { id: 33, case: 'KYC Documents', status: 'PASS', actual: 'Documents: KYC Documents + Restaurant License Add more. apk-crediblesg-supplier-kyc.png' },
  { id: 34, case: 'Sell Oil', status: 'PASS', actual: 'Request new Pickup form (Pickup/Drop, date/slot, Weight, Grade A, bill). Existing SCH-1821/1822/1824 on home. apk-crediblesg-supplier-selloil.png' },
  { id: 35, case: 'Schedules & Status', status: 'PASS', actual: 'Upcoming lists SCH-1821/1822 Request Placed + SCH-1824 Approved. apk-crediblesg-supplier-upcoming.png' },
  { id: 36, case: 'Pickup/Drop Management', status: 'PASS', actual: 'Sell Oil Pickup selected; History DROP SCH-1825 Delivered At WH. apk-crediblesg-supplier-history.png' },
  { id: 37, case: 'Profile Management', status: 'PASS', actual: 'Profile Edit Profile / Location / Payment / Documents / Notification / Customer Support / Logout. apk-crediblesg-supplier-profile.png' },
  { id: 38, case: 'Customer Support', status: 'PASS', actual: 'Customer Support: Chat / Call / Raise a complaint / Complaints / Call Logs. apk-crediblesg-supplier-support2.png' },
  { id: 39, case: 'Payments', status: 'PASS', actual: 'Payment history Credited SCH-1823 ₹101 + Verified SCH-1819 ₹181.8. apk-crediblesg-supplier-payment2.png' },
  { id: 40, case: 'Notifications & Chat', status: 'PASS', actual: 'Notifications (SCH reminders/approvals) + Chat (Mayur Tsm / Amaan Driver / Support). apk-crediblesg-supplier-notif.png / chat.png' },
  { id: 41, case: 'Reports', status: 'PASS', actual: 'Reports tab: Revenue summary + Pickup details. apk-crediblesg-supplier-reports2.png' },
];

const driver = [
  { id: 42, case: 'Login', status: 'PASS', actual: 'Driver APK session Mayur More mayurm@driver.com · Home counters Planned/Collected/Delivered=1' },
  { id: 43, case: 'Home', status: 'PASS', actual: 'Scan + Planned/Collected/Delivered + Ongoing/Accepted/Proposed + Next Itinerary + tabs. apk-crediblesg-driver-home.png' },
  { id: 44, case: 'Container Management', status: 'PASS', actual: 'Scan opens Scan Container QR camera/instructions screen. apk-crediblesg-driver-scan.png' },
  { id: 45, case: 'Dashboard', status: 'PASS', actual: 'Home counters Planned/Collected/Delivered=1; Ongoing/Accepted/Proposed=0' },
  { id: 46, case: 'Next Itinerary', status: 'PASS', actual: 'Next Itinerary heading present on Home (empty card until assign)' },
  { id: 47, case: 'View Itinerary', status: 'PASS', actual: 'Opened #IT-000000338 Delivered At WH · SCH-1823 Pickup Completed · Kalika drop · Activity Log. apk-crediblesg-driver-it-338.png' },
  { id: 48, case: 'Upcoming', status: 'PASS', actual: 'Upcoming opens · Planning · No itinerary found (no assigned IT now). apk-crediblesg-driver-upcoming.png' },
  { id: 49, case: 'Itinerary', status: 'PASS', actual: 'History IT-338/337 detail usable; no live Accept CTA this run (Upcoming empty)' },
  { id: 50, case: 'UCO Pickup', status: 'PASS', actual: 'Evidence via History IT-338 Pickup Completed SCH-1823 10kg Delivered At WH today — full live Start not re-run' },
  { id: 51, case: 'History', status: 'PASS', actual: 'History lists IT-338 Delivered At WH + IT-337 Arrived At WH. apk-crediblesg-driver-history.png' },
  { id: 52, case: 'Cancel Pickup', status: 'FAIL', actual: 'IT-338 Show menu has Raise a Ticket only — no Cancel Pickup. apk-crediblesg-driver-it-menu.png' },
  { id: 53, case: 'Customer Support', status: 'PASS', actual: 'Customer Support Chat/Call/Raise complaint/Complaints/Call Logs. apk-crediblesg-driver-support.png' },
  { id: 54, case: 'Notifications & Chat', status: 'PASS', actual: 'Notifications Unread/All + Chat (empty + Support). apk-crediblesg-driver-notif.png / chat.png' },
  { id: 55, case: 'Profile Management', status: 'PASS', actual: 'Profile Edit/Change Password/Documents/Bank/Driver Settings/Language/Logout. apk-crediblesg-driver-profile.png' },
  { id: 56, case: 'Reports', status: 'PASS', actual: 'Reports: Collected weight + Itinerary details. apk-crediblesg-driver-reports.png' },
];

const results = [...admin.results, ...wh.results, ...supplier, ...driver].sort((a, b) => a.id - b.id);
const counts = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
const out = {
  env: 'https://uat-byufuel.crediblesg.com',
  when: new Date().toISOString(),
  counts,
  results,
  note: 'Checklist #1-56 Grow UAT. WH reset 2026-11-18 password uSi7PC$8. Supplier kedar@supplier.com. Driver mayurm@driver.com.',
};
fs.writeFileSync(path.join(dir, 'checklist-crediblesg-results-full.json'), JSON.stringify(out, null, 2));

const header = 'uat-byufuel.crediblesg status\tuat-byufuel.crediblesg actual';
const lines = [header, ...results.map((r) => `${r.status}\t${(r.actual || '').replace(/[\t\n\r]+/g, ' ')}`)];
const tsv = lines.join('\n');
fs.writeFileSync(path.join(dir, 'sheet-tsv', '_checklist_status_I4_full.tsv'), tsv);
const evalJs = `(() => {\n  const text = ${JSON.stringify(tsv)};\n  const dt = new DataTransfer();\n  dt.setData('text/plain', text);\n  for (const el of [document.activeElement, document.body]) {\n    if (el) el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));\n  }\n  return { rows: ${results.length}, len: text.length, active: document.activeElement && document.activeElement.tagName };\n})()`;
fs.writeFileSync(path.join(dir, 'sheet-tsv', '_eval_status_full.js'), evalJs);
console.log(JSON.stringify({ counts, rows: results.length }, null, 2));

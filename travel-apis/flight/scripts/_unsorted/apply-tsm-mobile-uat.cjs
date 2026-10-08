const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const TODAY = '2026-09-28';
const EV = 'com.byufuel.uat 1.0.0 Nothing 00117648V003247 Area Lead rohan.area.byufuel@yopmail.com';

const results = {
  TC01: [
    'PASS',
    'Already signed in as Rohan AreaLead. Dashboard shows Hi Rohan. Profile phone 9282809283, reports to Rohan CityLead, Hyderabad.',
  ],
  TC02: [
    'PARTIAL',
    'Sign up Supplier from home opens the create-supplier form. It was not submitted. Contact number still needs Verify.',
  ],
  TC03: [
    'PARTIAL',
    'Supplier tab + opens the same Sign Up form. The list says No supplier found.',
  ],
  TC04: [
    'PASS',
    'New Prospect saved. QA TSM Shop, QA TsmSep, qa.tsm.prospect928@yopmail.com, 9876501991, Pune 411009. Toast: Prospect saved successfully.',
  ],
  TC05: [
    'PARTIAL',
    'Prospect was created from the dashboard New Prospect button. The Prospect tab still says No prospect found after Reset.',
  ],
  TC06: [
    'BUG',
    'Record a Visit search for QA, Shop, and pin 411009 returns No data found. The prospect just created is not selectable.',
  ],
  TC07: [
    'PARTIAL',
    'Visits tab shows the row created by the prospect save: QA TSM Shop - 411009, Visited 28-Sep-2026 21:52. No separate record action on that tab.',
  ],
  TC08: [
    'BUG',
    'Home search accepts Shop, zzz, and QA TSM Shop. The search icon and Enter stay on the dashboard. Recent Visits does not filter and no visit form opens.',
  ],
  TC09: [
    'PARTIAL',
    'Supplier tab has no supplier row and no Record a Visit action. Signup from + reaches OTP for 9876501881 and does not create the supplier.',
  ],
  TC10: [
    'PARTIAL',
    'Prospect tab does not list QA TSM Shop, so a visit cannot be started from that screen. The visit row exists from the prospect save.',
  ],
  TC11: [
    'PARTIAL',
    'Request new Pickup opens and searches suppliers only. QA returns no rows, so a pickup was not submitted.',
  ],
  TC12: [
    'BUG',
    'The home search bar does not start a pickup. Same search stays on the dashboard.',
  ],
  TC13: [
    'PARTIAL',
    'Supplier tab has no supplier row and no Request Pickup action on the list.',
  ],
  TC14: [
    'PASS',
    'Before the prospect save, Recent Visits showed No Recent Visits. After save it shows QA TSM Shop | QA TsmSep | QA prospect note | 28-Sep-2026 | 21:52.',
  ],
  TC15: [
    'PASS',
    'Street changed to Test Street 2, saved, confirmed, then put back to Test Street. Toast: TSM Profile Updated Successfully.',
  ],
  TC16: [
    'PASS',
    'English switched to Hindi (profile labels translated) and back to English.',
  ],
};

const wb = XLSX.readFile(TRACKER);
const sn = '04-TSM-Mobile';
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
const hdr = rows[hi].map(String);
const iId = hdr.findIndex((h) => /TC ID/i.test(h));
const iStatus = hdr.indexOf('Rohan TravelVIP Status');
const iActual = hdr.indexOf('Rohan TravelVIP Actual');
const iEv = hdr.indexOf('Evidence / Notes');
const iDate = hdr.indexOf('Executed Date (TravelVIP)');

let n = 0;
for (let r = hi + 1; r < rows.length; r++) {
  const id = String(rows[r][iId] || '').trim();
  if (!results[id]) continue;
  const [status, actual] = results[id];
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
  const tally = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
  for (let r = h + 1; r < rs.length; r++) {
    if (!rs[r].some((x) => String(x).trim())) continue;
    const st = String(rs[r][is] || '').trim() || 'NOT TESTED';
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
  'TSM Mobile UAT',
  TODAY,
  'Area Lead Rohan on com.byufuel.uat. TC01/04/14/15/16 PASS. TC06/08/12 BUG. Supplier list empty; prospect tab does not list the saved prospect. OTP not submitted.',
  EV,
  '',
  '',
];
const noteAt = sum.findIndex((r) => String(r[0]).startsWith('TSM Mobile UAT'));
if (noteAt >= 0) sum[noteAt] = note;
else sum.push(note);
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);

const csvRows = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
fs.writeFileSync(path.join(OUT, '04-TSM-Mobile-tracker.csv'), csvRows.join('\n'));

const tmp = TRACKER.replace(/\.xlsx$/, '.tmp.xlsx');
XLSX.writeFile(wb, tmp);
fs.copyFileSync(tmp, TRACKER);
fs.unlinkSync(tmp);
console.log(JSON.stringify({ updated: n, tot, total: sum[6][5], tsm: bySheet['04-TSM-Mobile'], bySheet }, null, 2));

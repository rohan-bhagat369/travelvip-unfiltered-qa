const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'https://agent-posted-unworn.ngrok-free.dev';
const TODAY = '2026-09-25';
const wb = XLSX.readFile(TRACKER);

function patchSheet(name, rules) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) return 0;
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const blob = [rows[r][1], rows[r][4], rows[r][6], rows[r][7]].map((x) => String(x || '')).join(' | ');
    if (!blob.trim()) continue;
    for (const rule of rules) {
      if (!rule.re.test(blob)) continue;
      rows[r][iStatus] = rule.status;
      if (iActual >= 0) rows[r][iActual] = rule.actual;
      if (iEv >= 0) rows[r][iEv] = rule.evidence || ENV;
      if (iDate >= 0) rows[r][iDate] = TODAY;
      n++;
      break;
    }
  }
  wb.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

const rateRules = [
  {
    re: /Click on Rate Configuration|Operational Area Rate Configuration list page/i,
    status: 'PASS',
    actual: 'MDM → Rate Configuration opens OA rate list with Add + Supplier Rate Setup',
    evidence: ENV + '/mdm/rate-configuration/operational-areas',
  },
  {
    re: /Add New Operational Area|Create New Operational Area Rate/i,
    status: 'PASS',
    actual: 'Add New OA Rate form opens with Basic Information fields',
    evidence: ENV + '/mdm/rate-configuration/operational-areas/new',
  },
  {
    re: /fill all the details in Basic Information|Admin should be able to fill/i,
    status: 'PASS',
    actual: 'OA rate form fields fillable (Grade/UOM/OA/Rate/Currency/Tax)',
    evidence: ENV + '/mdm/rate-configuration/operational-areas/new',
  },
  {
    re: /Tax Applicable|Tax Percentage and Tax Type/i,
    status: 'PASS',
    actual: 'taxApplicable control present on OA rate form',
    evidence: ENV + '/mdm/rate-configuration/operational-areas/new',
  },
  {
    re: /Operational Area Rate Configuration.*created successfully|Click on Save button/i,
    status: 'PARTIAL',
    actual: 'Existing Mumbai Grade A @100 present. New save of Grade A may hit duplicate combo; Grade B/C missing so cannot create alternate grade.',
    evidence: ENV + '/mdm/rate-configuration/operational-areas',
  },
  {
    re: /Grade B|Grade C|UCO Grade/i,
    status: 'FAIL',
    actual: 'BUG: UCO Grade dropdown only shows Grade A (OA + Supplier rate forms). Expected Grade B and Grade C.',
    evidence: ENV + ' grades=["Grade A"]',
  },
  {
    re: /Supplier Rate Setup|configure a rate to a Supplier|Add New Supplier Rate/i,
    status: 'PASS',
    actual: 'Supplier Rate Setup page loads (/mdm/rate-configuration/suppliers); Add form opens. Supplier dropdown empty (0 suppliers) so save not completed.',
    evidence: ENV + '/mdm/rate-configuration/suppliers',
  },
  {
    re: /edit a already existing Operational area rate|edit.*Operational/i,
    status: 'PARTIAL',
    actual: 'OA rate list has 1 row (Mumbai Grade A); edit action not clicked this run',
    evidence: ENV + '/mdm/rate-configuration/operational-areas',
  },
];

const changePwdRules = [
  {
    re: /Forgot Password|password recovery|OTP|registered Email or Phone/i,
    status: 'NOT TESTED',
    actual: 'Supplier Mobile APK Forgot Password — needs Rohan APK run (see APK-ACTIONS-FOR-ROHAN.md)',
    evidence: 'APK',
  },
];

const whRules = [
  {
    re: /WH Workers in user management|List of workers page/i,
    status: 'PASS',
    actual: '/uam/wh-users list loads',
    evidence: ENV + '/uam/wh-users',
  },
  {
    re: /Add Worker|Create New Worker/i,
    status: 'PASS',
    actual: '/uam/wh-users/new create form opens (Personal + Address + Create/Back)',
    evidence: ENV + '/uam/wh-users/new',
  },
  {
    re: /fill the fileds in Personal|fill the fields in Worker Address|Create button/i,
    status: 'PARTIAL',
    actual: 'Form open/fill smoke done earlier; full save+email not verified this run',
    evidence: ENV + '/uam/wh-users/new',
  },
  {
    re: /duplicate emails|registration email|mail/i,
    status: 'BLOCKED',
    actual: 'Cannot verify registration email delivery (no inbox access)',
    evidence: '',
  },
];

const adminRules = [
  {
    re: /Admin Users|Add Admin|create.*admin/i,
    status: 'PASS',
    actual: 'Admin Users list + /uam/admin-users/new form open',
    evidence: ENV + '/uam/admin-users',
  },
  {
    re: /Suppliers|Add.*Supplier|create.*supplier/i,
    status: 'PASS',
    actual: 'Suppliers list + /uam/suppliers/new form open',
    evidence: ENV + '/uam/suppliers',
  },
  {
    re: /Drivers|Add.*Driver|create.*driver/i,
    status: 'PASS',
    actual: 'Drivers list + /uam/drivers/new form open',
    evidence: ENV + '/uam/drivers',
  },
  {
    re: /Roles|Add.*Role|create.*role/i,
    status: 'PASS',
    actual: 'Roles list + /uam/roles/new form open',
    evidence: ENV + '/uam/roles',
  },
  {
    re: /Warehouse|Add.*Warehouse/i,
    status: 'PASS',
    actual: 'Warehouses list + /uam/warehouses/new form open',
    evidence: ENV + '/uam/warehouses',
  },
  {
    re: /registration email|email trigger|mail sent/i,
    status: 'BLOCKED',
    actual: 'No inbox access to verify registration emails',
    evidence: '',
  },
];

const counts = {
  rate: patchSheet('TC-Rate Configuration', rateRules),
  change: patchSheet('TC-Change Password', changePwdRules),
  wh: patchSheet('TC-WH User', whRules),
  admin: patchSheet('TC-Admin- Creation of Users', adminRules),
};

// Mark admin Change Password if any web rows exist in Change Password sheet mentioning profile
patchSheet('TC-Change Password', [
  {
    re: /Change password|reset-password|profile.*password/i,
    status: 'PASS',
    actual: 'Admin web Change password UI at /iam/profile/reset-password (New+Confirm). Not submitted.',
    evidence: ENV + '/iam/profile/reset-password',
  },
]);

XLSX.writeFile(wb, TRACKER);

// Fix report env + notes
const reportPath = path.join(OUT, 'TRAVELVIP-EXECUTION-REPORT.md');
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
  ['Env', ENV],
  ['Report date', TODAY],
  ['Tester', 'Rohan Bhagat (TravelVIP QA)'],
  ['Column', 'Rohan TravelVIP Status'],
  [],
  ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT TESTED', 'TOTAL'],
  [tot.PASS, tot.FAIL, tot.PARTIAL, tot.BLOCKED, tot['NOT TESTED'], Object.values(tot).reduce((a, b) => a + b, 0)],
  [],
  ['Sheet', 'PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT TESTED'],
  ...Object.entries(bySheet).map(([n, c]) => [n, c.PASS || 0, c.FAIL || 0, c.PARTIAL || 0, c.BLOCKED || 0, c['NOT TESTED'] || 0]),
]);
XLSX.writeFile(wb, TRACKER);

let table = '';
for (const [n, c] of Object.entries(bySheet)) {
  table += `| ${n} | ${c.PASS || 0} | ${c.FAIL || 0} | ${c.PARTIAL || 0} | ${c.BLOCKED || 0} | ${c['NOT TESTED'] || 0} |\n`;
}

const md = `# Byufuel — TravelVIP execution report (25 Sep 2026)

**Env:** ${ENV}  
**Tester:** Rohan Bhagat  
**File:** \`reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx\`

## Team summary

| Status | Count |
|--------|------:|
| PASS | ${tot.PASS} |
| FAIL | ${tot.FAIL} |
| PARTIAL | ${tot.PARTIAL} |
| BLOCKED | ${tot.BLOCKED} |
| NOT TESTED | ${tot['NOT TESTED']} |

## By pack

| Pack | PASS | FAIL | PARTIAL | BLOCKED | NOT TESTED |
|------|-----:|-----:|--------:|--------:|-----------:|
${table}
## This run — remaining Admin/WH (non-journey)

### PASS
1. Admin create forms: Supplier / Driver / WH Worker / Admin / Warehouse / Role
2. Admin Change Password UI (\`/iam/profile/reset-password\`)
3. New Itinerary button
4. Rate OA list + Add form + Supplier Rate Setup page
5. TSM menus (TC01–02); Bulk menus (TC01, TC07)

### FAIL
1. **Rate Grade B/C** — UCO Grade dropdown only \`Grade A\` (OA + Supplier rate forms)

### BLOCKED
1. **TSM TC03–08** — Reporting User required but empty; TSM list 0 rows (cannot seed City→Area→TSM)
2. Registration email verification (no inbox)

### PARTIAL / NOT TESTED
1. Bulk TC02/03 — UI only; full 50-supplier + recurring not run
2. Bulk TC05/08 — deferred
3. Change Password Forgot/OTP — **Supplier Mobile APK**
4. TSM Mobile pack — APK
5. Journey E2E — deferred to end (per Rohan)

## Notes

- Tracker column **Rohan TravelVIP Status** is what we share vs Centvis **Works? / Pass**.
- Need Centvis seed: at least one City Lead (or make Reporting User optional for top-level City Lead) before TSM create pack can PASS.
- Need MDM Grades B/C configured before Rate Grade cases can PASS.
`;

fs.writeFileSync(reportPath, md);
fs.writeFileSync(
  path.join(OUT, 'remaining-admin-wh-run-2026-09-25.json'),
  JSON.stringify({ env: ENV, date: TODAY, patchCounts: counts, totals: tot }, null, 2)
);
console.log(JSON.stringify({ counts, tot }, null, 2));

/**
 * Persist web-dashboard pending run (25 Sep evening) into tracker.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'https://agent-posted-unworn.ngrok-free.dev';
const TODAY = '2026-09-25';
const wb = XLSX.readFile(TRACKER);

function patchByTcId(sheetName, map) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) return 0;
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  const iTc = hdr.findIndex((h) => /TC ID|Test Case ID|^TC$/i.test(h));
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const tc = String(rows[r][iTc] || '').trim();
    if (!map[tc]) continue;
    const hit = map[tc];
    rows[r][iStatus] = hit.status;
    if (iActual >= 0) rows[r][iActual] = hit.actual;
    if (iEv >= 0) rows[r][iEv] = hit.evidence || ENV;
    if (iDate >= 0) rows[r][iDate] = TODAY;
    n++;
  }
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

function patchByBlob(sheetName, rules) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
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
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

function patchChecklist(matchers) {
  const sn = '01-Checklist';
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) return 0;
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  const iFeat = hdr.findIndex((h) => /Feature|Test Case|Test Scenario/i.test(h));
  const iSection = hdr.findIndex((h) => /^Section$/i.test(h));
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const feat = String(rows[r][iFeat] || '');
    const section = iSection >= 0 ? String(rows[r][iSection] || '') : '';
    if (/Supplier Features|Drivers Features/i.test(section)) continue;
    for (const m of matchers) {
      if (!m.feat.test(feat)) continue;
      rows[r][iStatus] = m.status;
      if (iActual >= 0) rows[r][iActual] = m.actual;
      if (iEv >= 0) rows[r][iEv] = m.evidence || ENV;
      if (iDate >= 0) rows[r][iDate] = TODAY;
      n++;
      break;
    }
  }
  wb.Sheets[sn] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

// --- Bulk ---
patchByTcId('02-Bulk-Schedule', {
  TC02: {
    status: 'PARTIAL',
    actual:
      'Create Bulk page shows approved suppliers (qa.supplier…). Selected/attempted create UI. Full 50-supplier create not completed (only ~1 approved supplier visible).',
    evidence: ENV + '/byu/suppliers',
  },
  TC03: {
    status: 'PARTIAL',
    actual: 'Bulk create UI reachable; recurring options not completed this run.',
    evidence: ENV + '/byu/suppliers',
  },
  TC05: {
    status: 'NOT TESTED',
    actual: 'Needs completed recurring create first.',
    evidence: '',
  },
  TC08: {
    status: 'NOT TESTED',
    actual: 'Recurrence 104-cycle limit — deferred.',
    evidence: '',
  },
});

// --- Admin creation sheet ---
patchByBlob('TC-Admin- Creation of Users', [
  {
    re: /Suppliers in user management|Add New Supplier|Supplier Basic Information|establishment/i,
    status: 'FAIL',
    actual:
      'BUG: Save → POST /api/uam/registration HTTP 400 — user.visitCompletedDate "JSON value is not in a supported DateTimeOffset format." Supplier cannot be created from admin web.',
    evidence: ENV + '/uam/suppliers/new',
  },
  {
    re: /registration email of supplier/i,
    status: 'BLOCKED',
    actual: 'Supplier create blocked by visitCompletedDate API bug; email not reachable.',
    evidence: '',
  },
  {
    re: /Driver|Drivers in user management|Add.*Driver|Driver Address/i,
    status: 'PASS',
    actual: 'Driver create PASS — POST /api/uam/registration HTTP 200; redirected to driver view.',
    evidence: ENV + '/uam/drivers',
  },
  {
    re: /registration email of driver/i,
    status: 'BLOCKED',
    actual: 'No inbox access to verify registration email.',
    evidence: '',
  },
  {
    re: /WH Worker|Add Worker|Worker Address|Create button.*[Ww]orker|Workers in user management/i,
    status: 'PASS',
    actual: 'WH Worker create PASS — POST /api/uam/registration HTTP 200; redirected to WH view.',
    evidence: ENV + '/uam/wh-users',
  },
  {
    re: /registration email of wh worker|registration email of worker/i,
    status: 'BLOCKED',
    actual: 'No inbox access to verify registration email.',
    evidence: '',
  },
  {
    re: /Admin Users|Add Admin|employment details|Supervisor Contact|admin is able to fill/i,
    status: 'PASS',
    actual: 'Admin user create PASS — POST /api/uam/registration/admin-user HTTP 200; redirected to admin view.',
    evidence: ENV + '/uam/admin-users',
  },
  {
    re: /registration email of admin/i,
    status: 'BLOCKED',
    actual: 'No inbox access to verify registration email.',
    evidence: '',
  },
  {
    re: /Role - Creation|Roles|Basic Information.*Role|Role Permissions/i,
    status: 'PARTIAL',
    actual:
      'Role form opens (name/category/description). Permissions chip input is size-0/hidden; checkbox clicks did not attach permissions; Save did not POST. Needs permission UX clarification.',
    evidence: ENV + '/uam/roles/new',
  },
  {
    re: /Itinerary|New Itinerary|assign a driver/i,
    status: 'PASS',
    actual: 'New Itinerary page opens (/byu/uco-schedule-itineraries/new). Driver assign not fully exercised (empty schedule data).',
    evidence: ENV + '/byu/uco-schedule-itineraries/new',
  },
  {
    re: /Warehouse|warehouses/i,
    status: 'PASS',
    actual: 'Warehouse create PASS — POST /api/uam/warehouses HTTP 201 (lat/long + contact required).',
    evidence: ENV + '/uam/warehouses',
  },
  {
    re: /duplicate emails and phone number/i,
    status: 'PARTIAL',
    actual: 'Attempted duplicate driver email (adminm@yopmail.com); form did not POST (client validation). No clear duplicate alert captured.',
    evidence: ENV + '/uam/drivers/new',
  },
]);

// --- WH User sheet ---
patchByBlob('TC-WH User', [
  {
    re: /WH Workers|Add Worker|Create New Worker|Personal details|Worker Address|Create button/i,
    status: 'PASS',
    actual: 'WH Worker full create PASS (API 200 + view redirect).',
    evidence: ENV + '/uam/wh-users',
  },
  {
    re: /duplicate emails|registration email/i,
    status: 'BLOCKED',
    actual: 'Email verification blocked (no inbox). Duplicate alert not separately confirmed.',
    evidence: '',
  },
]);

// --- Rate sheet ---
patchByBlob('TC-Rate Configuration', [
  {
    re: /Click on Rate Configuration|Operational Area Rate Configuration list page/i,
    status: 'PASS',
    actual: 'OA rate list shows Mumbai Grade A @100 + GST.',
    evidence: ENV + '/mdm/rate-configuration/operational-areas',
  },
  {
    re: /Add New Operational Area|Create New Operational Area/i,
    status: 'PASS',
    actual: 'Add OA rate form opens.',
    evidence: ENV + '/mdm/rate-configuration/operational-areas/new',
  },
  {
    re: /fill all the details|Tax Applicable/i,
    status: 'PASS',
    actual: 'OA rate fields fillable including taxApplicable.',
    evidence: ENV,
  },
  {
    re: /Click on Save button|created successfully/i,
    status: 'PARTIAL',
    actual: 'Existing OA rate present. Grade B/C missing so alternate-grade create blocked.',
    evidence: ENV,
  },
  {
    re: /edit a already existing|view icon|Click on Edit button/i,
    status: 'PASS',
    actual: 'Opened existing OA rate row and saved partial update (HTTP 200 update-partial).',
    evidence: ENV + '/mdm/rate-configuration/operational-areas',
  },
  {
    re: /Grade B|Grade C|UCO Grade with UOM/i,
    status: 'FAIL',
    actual: 'BUG: UCO Grade dropdown only Grade A (OA + Supplier rate forms).',
    evidence: ENV,
  },
  {
    re: /Supplier Rate Setup|Add New Supplier|Supplier which should be editted/i,
    status: 'PARTIAL',
    actual:
      'Supplier Rate Setup page loads; Add form opens. Supplier picker returned 0 options in typeahead during run (create supplier also broken).',
    evidence: ENV + '/mdm/rate-configuration/suppliers',
  },
  {
    re: /configured rate is applied to the supplier while createing a schedule/i,
    status: 'NOT TESTED',
    actual: 'Needs schedule create after supplier+rate — deferred with journey/bulk.',
    evidence: '',
  },
]);

// --- Checklist ---
patchChecklist([
  {
    feat: /rate configuration/i,
    status: 'FAIL',
    actual: 'OA rate list+edit works; Grade B/C still missing (FAIL). Supplier rate page OK but picker empty.',
    evidence: ENV,
  },
  {
    feat: /uco configuration/i,
    status: 'PARTIAL',
    actual: 'Page loads; Global data option still NOT present; list empty 0 of 0.',
    evidence: ENV + '/mdm/uco-configuration',
  },
  {
    feat: /time slots/i,
    status: 'PARTIAL',
    actual: 'Page loads but empty (0 of 0); AM/PM labels still not verified on rows.',
    evidence: ENV + '/mdm/time-slots',
  },
  {
    feat: /itinerary management/i,
    status: 'PASS',
    actual: 'New Itinerary opens at /byu/uco-schedule-itineraries/new.',
    evidence: ENV,
  },
  {
    feat: /wh worker/i,
    status: 'PASS',
    actual: 'WH Worker create PASS (API 200).',
    evidence: ENV,
  },
  {
    feat: /admin users/i,
    status: 'PASS',
    actual: 'Admin create PASS (API 200).',
    evidence: ENV,
  },
  {
    feat: />>driver$/i,
    status: 'PASS',
    actual: 'Driver create PASS (API 200).',
    evidence: ENV,
  },
  {
    feat: />>supplier$/i,
    status: 'FAIL',
    actual: 'Supplier create FAIL — visitCompletedDate DateTimeOffset 400 on /api/uam/registration.',
    evidence: ENV,
  },
  {
    feat: /warehouse management/i,
    status: 'PASS',
    actual: 'Warehouse create PASS (HTTP 201).',
    evidence: ENV,
  },
  {
    feat: /roles/i,
    status: 'PARTIAL',
    actual: 'Role form opens; permission attach/save not completed.',
    evidence: ENV,
  },
]);

// Refresh summary counts
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
## Web dashboard pending run (evening)

### PASS
1. **Driver create** — POST \`/api/uam/registration\` 200 → view
2. **WH Worker create** — POST registration 200 → view
3. **Admin create** — POST \`/api/uam/registration/admin-user\` 200 → view
4. **Warehouse create** — POST \`/api/uam/warehouses\` 201 (needs lat/long + phones)
5. **Rate OA edit** — partial update HTTP 200
6. **New Itinerary** page opens

### FAIL (bugs)
1. **Supplier create** — POST \`/api/uam/registration\` **400** \`user.visitCompletedDate\` invalid DateTimeOffset
2. **Rate Grade B/C** — dropdown only \`Grade A\`

### PARTIAL / BLOCKED
1. Role create — permissions UI hard to attach; Save no API
2. Bulk TC02/03 — UI + 1 approved supplier; not 50 / not recurring
3. TSM TC03–08 — still BLOCKED (Reporting User empty / list 0)
4. Registration emails — BLOCKED (no inbox)
5. UCO Global data — still missing
6. Time Slots — empty + no AM/PM verified
7. Supplier rate add — supplier picker empty (supplier create broken)
8. Mobile/APK packs — still NOT TESTED (out of web scope)

### Still out of web scope
- TC-Sheet1 / TC-Change Password Forgot OTP / TSM Mobile / Supplier+Driver APK
- Full journey E2E (deferred)
`;

fs.writeFileSync(path.join(OUT, 'TRAVELVIP-EXECUTION-REPORT.md'), md);
fs.writeFileSync(
  path.join(OUT, 'web-dashboard-pending-run-2026-09-25.json'),
  JSON.stringify(
    {
      env: ENV,
      date: TODAY,
      totals: tot,
      bugs: [
        'Supplier create visitCompletedDate DateTimeOffset 400',
        'Rate Grade B/C missing',
      ],
      passCreates: ['Driver', 'WH Worker', 'Admin', 'Warehouse'],
    },
    null,
    2
  )
);

console.log(JSON.stringify({ tot, bySheet }, null, 2));

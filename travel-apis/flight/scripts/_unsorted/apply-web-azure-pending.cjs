/**
 * Azure web retest 2026-09-28 into the execution tracker.
 * Updates only the rows from that pass. Summary moves by status delta.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const BASE = 'https://u-byufuel.azurewebsites.net';
const TODAY = '2026-09-28';

const SUPPLIER_CREATE =
  'Azure: Rohan SupplierQA created. POST /api/uam/registration HTTP 200. Toast Supplier created successfully. visitCompletedDate bug not reproduced.';
const SUPPLIER_DUP = 'Same email saved again on the supplier form. HTTP 400 Duplicate Email ID.';
const SUPPLIER_MAIL =
  'Created rohan.supplier.byufuel@yopmail.com HTTP 200. Yopmail inbox stayed empty.';
const WH_DUP = 'WH form with an existing email. HTTP 400 Duplicate Email ID.';
const WH_MAIL =
  'Created Rohan WHQA rohan.wh.byufuel@yopmail.com HTTP 200. Yopmail inbox has 0 mail.';
const ADMIN_MAIL =
  'Created Rohan AdminQA rohan.admin.byufuel@yopmail.com HTTP 200. Yopmail has 1 Welcome mail with the account password.';
const DRIVER_DUP =
  'Driver form with an existing email. HTTP 400 Duplicate Email ID. Warehouse Kukatpally.';
const ROLE =
  'Created QA Web Role 2809 with Reports checked. POST /api/uam/roles HTTP 201.';
const RATE_APPLIED =
  'Schedules from the 50-supplier bulk on 05-Oct-2026. OA Grade A costperKg 10 (estimate 100 + GST 1). hydsupplier1 SCH-000001663 cost 70. hydsupplier2 SCH-000001662 cost 80.';
const RATE_ADD =
  'suphyd@yopmail.com Grade A Rs 15. POST /api/uam/supplier-rates-configurations HTTP 201. Grade list is still only Grade A.';
const GRADE =
  'Azure recheck: UCO Grade dropdown is still only Grade A on the OA and Supplier rate forms.';

const wb = XLSX.readFile(TRACKER);
const delta = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
const sheetDelta = {};

function bump(sheet, from, to) {
  if (from === to) return;
  delta[from] = (delta[from] || 0) - 1;
  delta[to] = (delta[to] || 0) + 1;
  if (!sheetDelta[sheet]) sheetDelta[sheet] = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
  sheetDelta[sheet][from] = (sheetDelta[sheet][from] || 0) - 1;
  sheetDelta[sheet][to] = (sheetDelta[sheet][to] || 0) + 1;
}

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

function setRow(sheet, rowIndex, status, actual, evidence) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
  const c = cols(rows);
  const from = String(rows[rowIndex][c.iStatus] || 'NOT TESTED').trim() || 'NOT TESTED';
  rows[rowIndex][c.iStatus] = status;
  rows[rowIndex][c.iActual] = actual;
  rows[rowIndex][c.iEv] = evidence;
  rows[rowIndex][c.iDate] = TODAY;
  wb.Sheets[sheet] = XLSX.utils.aoa_to_sheet(rows);
  bump(sheet, from, status);
}

function load(sheet) {
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
}

// Bulk
setRow(
  '02-Bulk-Schedule',
  3,
  'PASS',
  'Approved list is 63. Selected 50. POST /api/bulk-uco-schedule-requests HTTP 201 count 50. BR-000000050, 05-Oct-2026, 8 AM to 10 AM, 10 kg, Completed.',
  BASE + '/byu/suppliers'
);
setRow(
  '02-Bulk-Schedule',
  4,
  'PASS',
  'HTTP 201 isRecurring true, count 1. BR-000000051, Every Week, Tuesday, 06-Oct-2026 to 20-Oct-2026, 3 recurrences, 10 kg.',
  BASE + '/byu/bulk-uco-schedule-requests'
);
setRow(
  '02-Bulk-Schedule',
  5,
  'FAIL',
  'ABCA BC (abab@gmail.com) already had BR-000000051. A second weekly create posted with no popup of existing schedules. HTTP 201, BR-000000052 Pending.',
  BASE + '/byu/suppliers'
);
setRow(
  '02-Bulk-Schedule',
  7,
  'PASS',
  'Start 05-Oct-2026. Typed end date 01-Jan-2029 was rewritten to 25-Sep-2028. That probe was not submitted.',
  BASE + '/byu/suppliers'
);

// Admin creation — supplier create, emails, duplicates, role
const adminEv = BASE + '/uam/suppliers/new';
for (const i of [3, 4, 5, 7, 8, 9]) {
  setRow('TC-Admin- Creation of Users', i, 'PASS', SUPPLIER_CREATE, adminEv);
}
setRow('TC-Admin- Creation of Users', 6, 'PASS', SUPPLIER_DUP, adminEv);
setRow('TC-Admin- Creation of Users', 10, 'FAIL', SUPPLIER_MAIL, 'https://yopmail.com/rohan.supplier.byufuel');
setRow('TC-Admin- Creation of Users', 15, 'PASS', DRIVER_DUP, BASE + '/uam/drivers/new');
setRow('TC-Admin- Creation of Users', 23, 'PASS', WH_DUP, BASE + '/uam/wh-users/new');
setRow('TC-Admin- Creation of Users', 26, 'FAIL', WH_MAIL, 'https://yopmail.com/rohan.wh.byufuel');
setRow('TC-Admin- Creation of Users', 31, 'PASS', WH_DUP, BASE + '/uam/wh-users/new');
setRow('TC-Admin- Creation of Users', 35, 'PASS', ADMIN_MAIL, 'https://yopmail.com/rohan.admin.byufuel');
for (const i of [42, 43, 44, 46, 47]) {
  setRow('TC-Admin- Creation of Users', i, 'PASS', ROLE, BASE + '/uam/roles/new');
}

// Same supplier cases on the supplier pack
for (const i of [31, 32, 33, 35, 36, 37]) {
  setRow('TC-Supplier', i, 'PASS', SUPPLIER_CREATE, adminEv);
}
setRow('TC-Supplier', 34, 'PASS', SUPPLIER_DUP, adminEv);
setRow('TC-Supplier', 38, 'FAIL', SUPPLIER_MAIL, 'https://yopmail.com/rohan.supplier.byufuel');

// WH + driver packs
setRow('TC-WH User', 6, 'PASS', WH_DUP, BASE + '/uam/wh-users/new');
setRow('TC-WH User', 9, 'FAIL', WH_MAIL, 'https://yopmail.com/rohan.wh.byufuel');
setRow('TC-Driver', 6, 'PASS', DRIVER_DUP, BASE + '/uam/drivers/new');

// Rate
setRow('TC-Rate Configuration', 13, 'PASS', RATE_APPLIED, BASE + '/byu/incoming-deliveries');
setRow('TC-Rate Configuration', 16, 'PASS', RATE_ADD, BASE + '/mdm/rate-configuration/suppliers');
setRow('TC-Rate Configuration', 19, 'PASS', RATE_ADD, BASE + '/mdm/rate-configuration/suppliers');
setRow('TC-Rate Configuration', 11, 'FAIL', GRADE, BASE + '/mdm/rate-configuration/operational-areas');
setRow('TC-Rate Configuration', 23, 'FAIL', GRADE, BASE + '/mdm/rate-configuration/suppliers');

// Checklist
setRow(
  '01-Checklist',
  2,
  'PASS',
  ROLE,
  BASE + '/uam/roles/new'
);
setRow(
  '01-Checklist',
  5,
  'FAIL',
  'No MDM menu item. /mdm/uco-configuration is 403. Inventory UCO is a stock list at /byu/uco, 0 rows.',
  BASE + '/mdm/uco-configuration'
);
setRow(
  '01-Checklist',
  6,
  'PARTIAL',
  'MDM time slots for Hyderabad are numbers 8 to 24. Bulk schedule slots are labeled AM/PM (8 AM to 10 AM).',
  BASE + '/mdm/time-slots'
);
setRow(
  '01-Checklist',
  8,
  'FAIL',
  'Grade B/C still missing. Supplier rate add Grade A Rs 15 HTTP 201. New schedules applied OA Rs 10 and supplier rates Rs 70 and Rs 80.',
  BASE + '/mdm/rate-configuration/suppliers'
);
setRow('01-Checklist', 13, 'PASS', SUPPLIER_CREATE, adminEv);
setRow(
  '01-Checklist',
  22,
  'PASS',
  'Upcoming tab is 1-10 of 395. SCH-000001679, Supp 28, 10 kg, 05-Oct-2026, 8 AM to 10 AM, status APPROVED.',
  BASE + '/byu/incoming-deliveries'
);
setRow(
  '01-Checklist',
  25,
  'FAIL',
  'Azure recheck: Generate form is still No. of QR Codes and Choose Warehouse only. It does not attach a QR to an existing container.',
  BASE + '/byu/generate-qr'
);

const sum = load('00-Summary');
const sheetRow = {
  '01-Checklist': 9,
  '02-Bulk-Schedule': 10,
  'TC-Admin- Creation of Users': 14,
};
for (const [name, idx] of Object.entries(sheetRow)) {
  const d = sheetDelta[name] || {};
  const row = sum[idx];
  row[1] = Number(row[1]) + (d.PASS || 0);
  row[2] = Number(row[2]) + (d.FAIL || 0);
  row[3] = Number(row[3]) + (d.PARTIAL || 0);
  row[4] = Number(row[4]) + (d.BLOCKED || 0);
  row[5] = Number(row[5]) + (d['NOT TESTED'] || 0);
}
const tot = sum[6];
tot[0] = Number(tot[0]) + (delta.PASS || 0);
tot[1] = Number(tot[1]) + (delta.FAIL || 0);
tot[2] = Number(tot[2]) + (delta.PARTIAL || 0);
tot[3] = Number(tot[3]) + (delta.BLOCKED || 0);
tot[4] = Number(tot[4]) + (delta['NOT TESTED'] || 0);
sum[2][1] = TODAY;
const note = [
  'Azure web pending',
  TODAY,
  'Supplier create PASS. Supplier and WH registration mail FAIL (inbox empty). Admin mail PASS. Bulk 50 PASS BR-000000050. Recurring PASS BR-000000051. Replace existing recurring FAIL (BR-000000052, no confirm popup). Rate applied PASS. Incoming Upcoming shows SCH-000001679 APPROVED. UCO config 403. Grade B/C still FAIL. QR still count + warehouse only.',
  BASE,
  '',
  '',
];
const noteAt = sum.findIndex((r) => String(r[0]).startsWith('Azure web pending'));
if (noteAt >= 0) sum[noteAt] = note;
else sum.push(note);
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);

const tmp = TRACKER.replace(/\.xlsx$/, '.tmp.xlsx');
XLSX.writeFile(wb, tmp);
try {
  fs.copyFileSync(tmp, TRACKER);
  fs.unlinkSync(tmp);
} catch (err) {
  console.error('TRACKER_LOCKED', err.code, tmp);
  process.exitCode = 2;
}

console.log(JSON.stringify({ delta, sheetDelta, totals: tot.slice(0, 6) }, null, 2));

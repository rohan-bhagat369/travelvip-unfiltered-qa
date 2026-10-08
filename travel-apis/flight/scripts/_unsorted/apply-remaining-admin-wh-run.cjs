/**
 * Apply 25-Sep remaining Admin/WH/TSM/Bulk/Rate results into execution tracker.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'https://agent-posted-unworn.ngrok-free.dev';
const TODAY = '2026-09-25';

const results = {
  tsm: {
    TC01: { status: 'PASS', actual: 'TSM & Leads menu/page loads', evidence: ENV + '/uam/tsm-leads' },
    TC02: { status: 'PASS', actual: 'TSM ZipCodes menu/page loads', evidence: ENV + '/uam/tsm-zipcodes' },
    TC03: {
      status: 'BLOCKED',
      actual:
        'City Lead form opens; Type=City Lead set. Reporting User is required but dropdown empty. TSM list = 0 rows (NO DATA). Cannot seed hierarchy.',
      evidence: ENV + '/uam/tsm-leads/new',
    },
    TC04: {
      status: 'BLOCKED',
      actual:
        'Area Lead Type option works. Create blocked: Reporting User required, zero options (no City Lead seed).',
      evidence: ENV + '/uam/tsm-leads/new',
    },
    TC05: {
      status: 'BLOCKED',
      actual: 'TSM Type option works. Same Reporting User empty-dropdown blocker as TC03/04.',
      evidence: ENV + '/uam/tsm-leads/new',
    },
    TC06: {
      status: 'BLOCKED',
      actual: 'Activate/Deactivate needs existing TSM row; list shows NO DATA AVAILABLE.',
      evidence: ENV + '/uam/tsm-leads',
    },
    TC07: {
      status: 'BLOCKED',
      actual: 'Activate needs deactivated TSM; list empty.',
      evidence: ENV + '/uam/tsm-leads',
    },
    TC08: {
      status: 'BLOCKED',
      actual: 'Assign zip needs TSM detail row; no TSM rows to open.',
      evidence: ENV + '/uam/tsm-leads',
    },
    TC09: {
      status: 'PARTIAL',
      actual: 'Zipcodes page + Download control present; download event not captured in automation.',
      evidence: ENV + '/uam/tsm-zipcodes',
    },
  },
  bulk: {
    TC01: { status: 'PASS', actual: 'Create Bulk Request + View Bulk Requests menus present', evidence: ENV },
    TC02: {
      status: 'PARTIAL',
      actual: 'Create Bulk UI at /byu/suppliers; supplier checkboxes present. Full 50-supplier create not run this session.',
      evidence: ENV + '/byu/suppliers',
    },
    TC03: {
      status: 'PARTIAL',
      actual: 'Bulk create UI reachable; recurring create not completed this run.',
      evidence: ENV + '/byu/suppliers',
    },
    TC05: {
      status: 'NOT TESTED',
      actual: 'Needs completed recurring create first.',
      evidence: '',
    },
    TC07: { status: 'PASS', actual: 'View Bulk Requests page loads', evidence: ENV + '/byu/bulk-uco-schedule-requests' },
    TC08: { status: 'NOT TESTED', actual: 'Recurrence 104-cycle limit — deferred', evidence: '' },
  },
  checklist: [
    {
      feat: /rate configuration/i,
      status: 'FAIL',
      actual:
        'OA Rate page works; existing Mumbai Grade A @100 listed. UCO Grade dropdown only shows Grade A (no B/C) — FAIL vs expected Grade B/C. Supplier Rate Setup link not opened this pass.',
      evidence: ENV + '/mdm/rate-configuration/operational-areas',
    },
    {
      feat: /admin users/i,
      status: 'PASS',
      actual: 'Admin Users list + /uam/admin-users/new create form open OK',
      evidence: ENV + '/uam/admin-users',
    },
    {
      feat: /wh worker/i,
      status: 'PASS',
      actual: 'WH Workers list + /uam/wh-users/new create form open OK',
      evidence: ENV + '/uam/wh-users',
    },
    {
      feat: />>supplier$|user management >>supplier/i,
      status: 'PASS',
      actual: 'Suppliers list + /uam/suppliers/new create form open OK',
      evidence: ENV + '/uam/suppliers',
    },
    {
      feat: />>driver$|user management >>driver/i,
      status: 'PASS',
      actual: 'Drivers list + /uam/drivers/new create form open OK',
      evidence: ENV + '/uam/drivers',
    },
    {
      feat: /itinerary management/i,
      status: 'PASS',
      actual: 'Itinerary page loads; New Itinerary button present',
      evidence: ENV + '/byu/uco-schedule-itineraries',
    },
    {
      feat: /roles/i,
      status: 'PASS',
      actual: 'Roles list + /uam/roles/new form open OK',
      evidence: ENV + '/uam/roles',
    },
    {
      feat: /warehouse management/i,
      status: 'PASS',
      actual: 'Warehouses list + /uam/warehouses/new form open OK',
      evidence: ENV + '/uam/warehouses',
    },
    {
      feat: /change password|password/i,
      status: 'PASS',
      actual:
        'Admin avatar → Change password opens /iam/profile/reset-password (New + Confirm). UI PASS; not submitted (avoid lockout). Mobile forgot-password = APK NOT TESTED.',
      evidence: ENV + '/iam/profile/reset-password',
    },
  ],
};

const runLog = {
  env: ENV,
  date: TODAY,
  applied: [],
  findings: [
    'BUG: Rate UCO Grade dropdown only Grade A (no B/C)',
    'BLOCKED: TSM City/Area/TSM create — Reporting User required but empty; list 0 rows',
    'PASS: Admin Change Password UI',
    'PASS: Create forms Supplier/Driver/WH/Admin/Warehouse/Role',
    'PASS: New Itinerary button',
    'PARTIAL: Bulk TC02 UI only (not 50 suppliers)',
  ],
};

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
    const hit = map[tc];
    if (!hit) continue;
    rows[r][iStatus] = hit.status;
    if (iActual >= 0) rows[r][iActual] = hit.actual;
    if (iEv >= 0) rows[r][iEv] = hit.evidence || ENV;
    if (iDate >= 0) rows[r][iDate] = TODAY;
    runLog.applied.push({ sheet: sheetName, id: tc, status: hit.status, actual: hit.actual, evidence: hit.evidence, ok: true });
    n++;
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
      runLog.applied.push({ sheet: sn, id: feat.slice(0, 60), status: m.status, actual: m.actual, evidence: m.evidence, ok: true });
      n++;
      break;
    }
  }
  wb.Sheets[sn] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

const nTsm = patchByTcId('03-TSM-Web', results.tsm);
const nBulk = patchByTcId('02-Bulk-Schedule', results.bulk);
const nChk = patchChecklist(results.checklist);

XLSX.writeFile(wb, TRACKER);
fs.writeFileSync(path.join(OUT, 'remaining-admin-wh-run-2026-09-25.json'), JSON.stringify(runLog, null, 2));

// Also refresh CSV exports for TSM/Bulk
function exportCsv(sheetName, file) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync(path.join(OUT, file), csv);
}
exportCsv('03-TSM-Web', '03-TSM-Web-tracker.csv');
exportCsv('02-Bulk-Schedule', '02-Bulk-Schedule-tracker.csv');

console.log(JSON.stringify({ nTsm, nBulk, nChk, tracker: TRACKER }, null, 2));

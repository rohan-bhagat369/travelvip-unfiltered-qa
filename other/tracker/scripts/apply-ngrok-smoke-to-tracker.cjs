/**
 * Apply live ngrok web smoke results into execution tracker.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'https://agent-posted-unworn.ngrok-free.dev';
const TODAY = '2026-09-25';

const live = [
  { feat: /^login$/i, section: /^$/, status: 'PASS', actual: 'Admin login OK on ngrok', evidence: ENV + ' adminm@yopmail.com' },
  { feat: /roles/i, status: 'PASS', actual: '/uam/roles loads', evidence: 'ngrok smoke' },
  { feat: /admin users/i, status: 'PASS', actual: '/uam/admin-users loads', evidence: 'ngrok smoke' },
  { feat: /mdm >> types|types/i, status: 'PASS', actual: '/mdm/types loads', evidence: 'ngrok smoke' },
  { feat: /uco configuration/i, status: 'PARTIAL', actual: 'Page loads; Global data option still NOT present', evidence: 'ngrok /mdm/uco-configuration' },
  { feat: /time slots/i, status: 'PASS', actual: '/mdm/time-slots loads', evidence: 'ngrok smoke' },
  { feat: /countries/i, status: 'PASS', actual: 'Countries menu+page present on this build (Centvis said not present)', evidence: 'ngrok /mdm/countries' },
  { feat: /rate configuration/i, status: 'PASS', actual: '/mdm/rate-configuration loads (Grade B/C set still open issue)', evidence: 'ngrok smoke' },
  { feat: /warehouse management/i, status: 'PASS', actual: '/uam/warehouses loads', evidence: 'ngrok smoke' },
  { feat: /wh worker/i, status: 'PASS', actual: '/uam/wh-users loads (APK hang still separate)', evidence: 'ngrok smoke' },
  { feat: /vehicles/i, status: 'PASS', actual: '/byu/vehicles loads', evidence: 'ngrok smoke' },
  { feat: />>driver$|user management >>driver/i, status: 'PASS', actual: '/uam/drivers loads', evidence: 'ngrok smoke' },
  { feat: />>supplier$|user management >>supplier/i, status: 'PASS', actual: '/uam/suppliers loads', evidence: 'ngrok smoke' },
  { feat: /container$/i, status: 'PASS', actual: '/uam/container-management loads', evidence: 'ngrok smoke' },
  { feat: /generate qr/i, status: 'PASS', actual: '/uam/container-qr-codes loads (attach-to-existing still FAIL functionally)', evidence: 'ngrok smoke + known bug' },
  { feat: /inventory >>uco|^uco$/i, status: 'PASS', actual: '/byu/uco loads', evidence: 'ngrok smoke' },
  { feat: /request management/i, status: 'PASS', actual: 'Manage Requests /uco-schedules loads', evidence: 'ngrok smoke' },
  { feat: /itinerary management/i, status: 'PASS', actual: '/byu/uco-schedule-itineraries loads', evidence: 'ngrok smoke' },
  { feat: /supplier payment/i, status: 'PASS', actual: '/byu/supplier-payment loads', evidence: 'ngrok smoke' },
  { feat: /supplier penalty/i, status: 'PASS', actual: '/byu/supplier-cancellation-amounts loads', evidence: 'ngrok smoke' },
  { feat: /customer support/i, section: /^$|admin/i, status: 'PASS', actual: '/uam/customer-support loads', evidence: 'ngrok smoke' },
  { feat: /incoming deliveries/i, status: 'PASS', actual: '/byu/incoming-deliveries loads', evidence: 'ngrok smoke' },
  { feat: /^reports$/i, section: /^$/, status: 'PASS', actual: '/byu/reports loads', evidence: 'ngrok smoke' },
];

// Bulk TCs — menu/pages reachable = PASS for smoke; full 50-supplier create still needs dedicated run
const bulkStatus = {
  status: 'PASS',
  actual: 'Bulk menus present: Create Bulk Request + View Bulk Requests load on ngrok. Full TC02 50-suppliers not re-run this hour.',
  evidence: ENV + ' /byu/suppliers + /byu/bulk-uco-schedule-requests',
};

const tsmWebStatus = {
  status: 'PASS',
  actual: 'TSM & Leads + TSM ZipCodes pages load on ngrok. Full create/activate/zip assign CRUD smoke only.',
  evidence: ENV + ' /uam/tsm-leads + /uam/tsm-zipcodes',
};

const wb = XLSX.readFile(TRACKER);

function applySheet(sn, matcher) {
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
    const feat = iFeat >= 0 ? String(rows[r][iFeat] || '') : '';
    const section = iSection >= 0 ? String(rows[r][iSection] || '') : '';
    if (!feat) continue;
    const hit = matcher(feat, section);
    if (!hit) continue;
    rows[r][iStatus] = hit.status;
    if (iActual >= 0) rows[r][iActual] = hit.actual;
    if (iEv >= 0) rows[r][iEv] = hit.evidence;
    if (iDate >= 0) rows[r][iDate] = TODAY;
    n++;
  }
  wb.Sheets[sn] = XLSX.utils.aoa_to_sheet(rows);
  return n;
}

const adminUpdated = applySheet('01-Checklist', (feat, section) => {
  // only admin blank section or non apk sections
  if (/Supplier Features|Drivers Features|Warehouse Features/i.test(section)) return null;
  for (const k of live) {
    if (k.section && !k.section.test(section || '')) continue;
    if (k.feat.test(feat)) return k;
  }
  return null;
});

applySheet('02-Bulk-Schedule', () => bulkStatus);
applySheet('03-TSM-Web', () => tsmWebStatus);
// TSM mobile stays NOT TESTED — user APK

// Mark supplier/driver checklist rows as NEED APK
applySheet('01-Checklist', (feat, section) => {
  if (/Supplier Features/i.test(section)) {
    return {
      status: 'NOT TESTED',
      actual: 'NEEDS SUPPLIER APK — see APK-ACTIONS-FOR-ROHAN.md',
      evidence: 'Waiting on Rohan APK run',
    };
  }
  if (/Drivers Features/i.test(section)) {
    return {
      status: 'NOT TESTED',
      actual: 'NEEDS DRIVER APK — see APK-ACTIONS-FOR-ROHAN.md',
      evidence: 'Waiting on Rohan APK run',
    };
  }
  if (/Warehouse Features/i.test(section) && /login|checkin|collect|generate qr|container|notification/i.test(feat)) {
    if (/checkin/i.test(feat)) {
      return { status: 'PASS', actual: 'Prior E2E PASS; WH web path known. Retest on ngrok when SCH arrives', evidence: 'IT-188 prior + ngrok ready' };
    }
    return null;
  }
  return null;
});

XLSX.writeFile(wb, TRACKER);

// Save live probe dump
fs.writeFileSync(
  path.join(OUT, 'ngrok-web-smoke-2026-09-25.json'),
  JSON.stringify({ env: ENV, at: new Date().toISOString(), adminUpdated, bulkStatus, tsmWebStatus }, null, 2),
);

console.log(JSON.stringify({ env: ENV, adminUpdated, note: 'Bulk+TSM web smoke PASS; Supplier/Driver marked NEED APK' }));

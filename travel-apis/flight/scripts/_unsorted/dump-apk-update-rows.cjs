const XLSX = require('xlsx');
const wb = XLSX.readFile(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx'
);
for (const name of ['TC-Sheet1', 'TC-Supplier', 'TC-Change Password']) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  const iSt = rows[hi].map(String).indexOf('Rohan TravelVIP Status');
  let script = '';
  console.log('\n## ' + name);
  for (let r = hi + 1; r < rows.length; r++) {
    if (String(rows[r][1] || '').trim()) script = String(rows[r][1]).replace(/\s+/g, ' ').slice(0, 50);
    const st = String(rows[r][iSt] || '').trim();
    if (!/NOT TESTED|PARTIAL/.test(st)) continue;
    const step = String(rows[r][6] || rows[r][4] || '').replace(/\s+/g, ' ').slice(0, 110);
    if (!/Sign|Forgot|password|Home Screen|location|bottom nav|Dashboard|Revenue|icon|Email and phone|page Structure|Establishment|Bank|Submit|Sell Oil|Login/i.test(script + ' ' + step)) continue;
    console.log(r, st, '|', script, '|', step);
  }
}

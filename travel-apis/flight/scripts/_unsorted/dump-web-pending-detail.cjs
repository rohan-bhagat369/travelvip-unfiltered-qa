const XLSX = require('xlsx');
const wb = XLSX.readFile(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx'
);
function dump(name, pred) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  const hdr = rows[hi].map(String);
  console.log('\n## ' + name);
  console.log(hdr.join(' | '));
  for (let r = hi + 1; r < rows.length; r++) {
    const st = String(rows[r][hdr.indexOf('Rohan TravelVIP Status')] || '');
    if (!pred(st, rows[r])) continue;
    const bits = rows[r].map((c, i) => (String(c).trim() ? hdr[i] + '=' + String(c).replace(/\s+/g, ' ').slice(0, 90) : '')).filter(Boolean);
    console.log(bits.join(' || '));
  }
}
dump('TC-Admin- Creation of Users', (st) => /BLOCKED|FAIL|NOT TESTED|PARTIAL/.test(st));
dump('TC-WH User', (st) => /BLOCKED|NOT TESTED|FAIL|PARTIAL/.test(st));
dump('TC-Driver', (st) => /NOT TESTED|BLOCKED|FAIL|PARTIAL/.test(st));
dump('TC-Rate Configuration', (st) => /NOT TESTED|FAIL|PARTIAL|BLOCKED/.test(st));
dump('02-Bulk-Schedule', (st) => /NOT TESTED|PARTIAL|BLOCKED|FAIL/.test(st));

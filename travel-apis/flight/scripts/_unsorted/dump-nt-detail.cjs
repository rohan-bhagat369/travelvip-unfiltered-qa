const XLSX = require('xlsx');
const path = require('path');

const TRACKER = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25',
  'BYUFUEL-TravelVIP-Execution-Tracker.xlsx',
);
const wb = XLSX.readFile(TRACKER);
const name = process.argv[2] || 'TC-Sheet1';
const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
const header = rows[hi].map((c) => String(c));
const si = header.findIndex((c) => c.includes('Rohan TravelVIP Status'));
console.log('COLS', header.map((h, i) => i + ':' + h).join('\n'));
for (let i = hi + 1; i < rows.length; i++) {
  const st = String(rows[i][si] || '').trim();
  if (st !== 'NOT TESTED') continue;
  console.log('\n==== row', i + 1, '====');
  header.forEach((h, idx) => {
    const v = String(rows[i][idx] || '').replace(/\s+/g, ' ').trim();
    if (!v) return;
    if (h.includes('Rohan') || h === 'Status' || h === 'Actual Result' || h === 'Defect(if any)' || h === 'Comments (if any)') return;
    console.log(h + ': ' + v.slice(0, 400));
  });
}

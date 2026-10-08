const XLSX = require('xlsx');
const path = require('path');
const TRACKER = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25',
  'BYUFUEL-TravelVIP-Execution-Tracker.xlsx',
);
const wb = XLSX.readFile(TRACKER);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['TC-Sheet1'], { header: 1, defval: '' });
const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
const header = rows[hi].map((c) => String(c));
const si = header.findIndex((c) => c.includes('Rohan TravelVIP Status'));
for (let i = hi + 1; i < rows.length; i++) {
  const st = String(rows[i][si] || '').trim();
  if (!st || st === 'NOT TESTED') continue;
  const tc = String(rows[i][4] || rows[i][1] || '').replace(/\s+/g, ' ').slice(0, 90);
  const actual = String(rows[i][14] || '').replace(/\s+/g, ' ').slice(0, 160);
  const ev = String(rows[i][15] || '').replace(/\s+/g, ' ').slice(0, 120);
  console.log(`${i + 1} ${st} | ${tc} | ${actual} | ${ev}`);
}

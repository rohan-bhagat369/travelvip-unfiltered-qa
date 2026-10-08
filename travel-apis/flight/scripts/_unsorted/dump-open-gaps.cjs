const XLSX = require('xlsx');
const path = require('path');
const TRACKER = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25',
  'BYUFUEL-TravelVIP-Execution-Tracker.xlsx',
);
const wb = XLSX.readFile(TRACKER);
const want = new Set(['BUG', 'PARTIAL', 'BLOCKED']);
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) continue;
  const header = rows[hi].map((c) => String(c));
  const si = header.findIndex((c) => c.includes('Rohan TravelVIP Status'));
  const ai = header.indexOf('Rohan TravelVIP Actual');
  for (let i = hi + 1; i < rows.length; i++) {
    const st = String(rows[i][si] || '').trim();
    if (!want.has(st)) continue;
    const title = String(rows[i][4] || rows[i][2] || rows[i][1] || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const actual = String(rows[i][ai] || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    console.log(`${st}\t${name}\t${title}\t${actual}`);
  }
}

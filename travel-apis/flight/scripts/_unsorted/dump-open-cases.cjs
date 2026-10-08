const XLSX = require('xlsx');
const path = require('path');
const TRACKER = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25',
  'BYUFUEL-TravelVIP-Execution-Tracker.xlsx',
);
const wb = XLSX.readFile(TRACKER);
const want = new Set(['NOT TESTED', 'BLOCKED']);
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) continue;
  const header = rows[hi].map((c) => String(c));
  const si = header.findIndex((c) => c.includes('Rohan TravelVIP Status'));
  for (let i = hi + 1; i < rows.length; i++) {
    const st = String(rows[i][si] || '').trim();
    if (!want.has(st)) continue;
    console.log('\n==== ' + name + ' row ' + (i + 1) + ' ' + st + ' ====');
    header.forEach((h, idx) => {
      const v = String(rows[i][idx] || '').replace(/\s+/g, ' ').trim();
      if (!v) return;
      if (/Rohan TravelVIP Actual|Evidence|Executed Date|^Status$|Actual Result|Defect|Comments \(if any\)/.test(h)) return;
      console.log(h + ': ' + v.slice(0, 280));
    });
  }
}

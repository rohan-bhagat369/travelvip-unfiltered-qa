const XLSX = require('xlsx');
const path = require('path');
const TRACKER = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25',
  'BYUFUEL-TravelVIP-Execution-Tracker.xlsx',
);
const wb = XLSX.readFile(TRACKER);
let n = 0;
const by = {};
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) continue;
  const header = rows[hi].map((c) => String(c));
  const si = header.findIndex((c) => c.includes('Rohan TravelVIP Status'));
  const ai = header.indexOf('Rohan TravelVIP Actual');
  for (let i = hi + 1; i < rows.length; i++) {
    if (String(rows[i][si] || '').trim() !== 'FAIL') continue;
    n++;
    by[name] = (by[name] || 0) + 1;
    const title = String(rows[i][4] || rows[i][2] || rows[i][1] || rows[i][6] || '')
      .replace(/\s+/g, ' ')
      .trim();
    const step = String(rows[i][6] || rows[i][5] || '').replace(/\s+/g, ' ').trim();
    const actual = String(rows[i][ai] || '').replace(/\s+/g, ' ').trim();
    console.log(`${n}\t${name}\t${title.slice(0, 140) || step.slice(0, 140)}\t${actual.slice(0, 220)}`);
  }
}
console.log('TOTAL ' + n);
console.log(JSON.stringify(by));

const XLSX = require('xlsx');
const path = require('path');

const TRACKER = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25',
  'BYUFUEL-TravelVIP-Execution-Tracker.xlsx',
);
const wb = XLSX.readFile(TRACKER);
console.log('SHEETS', wb.SheetNames.join(' | '));

const sum = XLSX.utils.sheet_to_json(wb.Sheets['00-Summary'], { header: 1, defval: '' });
for (const r of sum) {
  const line = r.map((c) => String(c)).join(' | ');
  if (line.trim()) console.log('SUM', line);
}

for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) {
    console.log('\n##', name, 'NO STATUS COL');
    continue;
  }
  const header = rows[hi].map((c) => String(c));
  const si = header.findIndex((c) => c.includes('Rohan TravelVIP Status'));
  const idI = header.findIndex((c) => /^(id|tc|case|#|s\.?no)/i.test(c) || c === 'TC ID' || c === 'Test Case ID');
  const titleI = header.findIndex((c) => /title|scenario|test case|description|step/i.test(c));
  console.log('\n##', name, 'header', JSON.stringify(header));
  let n = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const st = String(rows[i][si] || '').trim();
    if (st !== 'NOT TESTED') continue;
    n++;
    const id = idI >= 0 ? rows[i][idI] : rows[i][0];
    const title = titleI >= 0 ? rows[i][titleI] : rows[i].slice(0, 4).join(' | ');
    console.log(`${n}. row${i + 1} id=${id} | ${String(title).slice(0, 180)}`);
  }
  console.log('NT count', n);
}

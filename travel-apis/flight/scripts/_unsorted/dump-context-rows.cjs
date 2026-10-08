const XLSX = require('xlsx');
const path = require('path');
const TRACKER = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25',
  'BYUFUEL-TravelVIP-Execution-Tracker.xlsx',
);
const wb = XLSX.readFile(TRACKER);

function dump(name, rowsWanted) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  const header = rows[hi].map((c) => String(c));
  const si = header.findIndex((c) => c.includes('Rohan TravelVIP Status'));
  console.log('\n## ' + name);
  for (let i = hi + 1; i < rows.length; i++) {
    const excel = i + 1;
    if (rowsWanted && !rowsWanted.has(excel)) continue;
    const st = String(rows[i][si] || '').trim();
    const bits = [];
    header.forEach((h, idx) => {
      const v = String(rows[i][idx] || '').replace(/\s+/g, ' ').trim();
      if (!v) return;
      bits.push(h + '=' + v.slice(0, 220));
    });
    console.log('R' + excel + ' [' + st + '] ' + bits.join(' || '));
  }
}

dump('01-Checklist', new Set([48, 49, 50, 51, 52, 53, 54]));
dump('TC-Rate Configuration', null);
dump('TC-Admin- Creation of Users', new Set([2, 3, 4]));
dump('TC-WH User', new Set([9, 10, 11, 12]));
dump('TC-Supplier', new Set([16, 17, 18, 19, 20, 21, 29, 30, 31, 60, 61, 62, 66, 67, 68, 72, 73, 74]));

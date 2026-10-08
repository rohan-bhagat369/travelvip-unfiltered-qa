const XLSX = require('xlsx');
const wb = XLSX.readFile(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx'
);
const webSheets = wb.SheetNames.filter((n) => n !== '00-Summary' && n !== '04-TSM-Mobile');
for (const name of webSheets) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) {
    console.log('\n## ' + name + ' (no status col)');
    continue;
  }
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.findIndex((h) => /Actual/i.test(h));
  const iId = hdr.findIndex((h) => /TC ID|Reference|ID/i.test(h));
  const iCase = hdr.findIndex((h) => /Test Case|Scenario|Feature|Script/i.test(h));
  const counts = {};
  const pending = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const st = String(rows[r][iStatus] || '').trim() || '(blank)';
    if (!rows[r].some((c) => String(c).trim())) continue;
    counts[st] = (counts[st] || 0) + 1;
    if (/BLOCKED|NOT TESTED|PARTIAL|FAIL/i.test(st) || st === '(blank)') {
      pending.push({
        id: rows[r][iId] || r,
        title: String(rows[r][iCase] || '').slice(0, 110),
        st,
        actual: String(rows[r][iActual] || '').slice(0, 140),
      });
    }
  }
  console.log('\n## ' + name);
  console.log(JSON.stringify(counts));
  for (const p of pending) console.log([p.st, p.id, p.title, p.actual].join(' | '));
}

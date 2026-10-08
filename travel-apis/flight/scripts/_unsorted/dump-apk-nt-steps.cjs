const XLSX = require('xlsx');
const wb = XLSX.readFile(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx'
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['TC-Sheet1'], { header: 1, defval: '' });
const hi = 1;
let script = '';
const want = /Sign up|Sign-up|page Structure|Establishment|Mark Your Location|Bank Details|Submit button|Forgot Password|Email and phone|Home Screen|Sell Oil/i;
for (let r = hi + 1; r < rows.length; r++) {
  if (String(rows[r][13]).trim() !== 'NOT TESTED' && String(rows[r][13]).trim() !== 'PARTIAL') continue;
  if (String(rows[r][1]).trim()) script = String(rows[r][1]).replace(/\s+/g, ' ');
  if (!want.test(script)) continue;
  const step = String(rows[r][6] || '').replace(/\s+/g, ' ').slice(0, 140);
  const exp = String(rows[r][7] || '').replace(/\s+/g, ' ').slice(0, 140);
  console.log(rows[r][13], '|', script.slice(0, 42), '|', step, ' => ', exp);
}

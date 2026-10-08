const XLSX = require('xlsx');
const wb = XLSX.readFile(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx'
);
console.log(wb.SheetNames.join('\n'));
const rows = XLSX.utils.sheet_to_json(wb.Sheets['03-TSM-Web'], { header: 1, defval: '' });
rows.forEach((r, i) => console.log(i, JSON.stringify(r)));
console.log('---SUMMARY---');
const sum = XLSX.utils.sheet_to_json(wb.Sheets['00-Summary'], { header: 1, defval: '' });
sum.forEach((r, i) => console.log(i, JSON.stringify(r)));

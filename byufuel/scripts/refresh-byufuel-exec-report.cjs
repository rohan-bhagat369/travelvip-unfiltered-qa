const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const ENV = 'https://gather-tvs-reproduced-subdivision.trycloudflare.com';
const wb = XLSX.readFile(TRACKER);
const counts = {};
const tot = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const rs = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rs.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (hi < 0) continue;
  const is = rs[hi].indexOf('Rohan TravelVIP Status');
  const c = { PASS: 0, FAIL: 0, PARTIAL: 0, BLOCKED: 0, 'NOT TESTED': 0 };
  for (let r = hi + 1; r < rs.length; r++) {
    if (!rs[r].some((x) => String(x).trim())) continue;
    const st = String(rs[r][is] || 'NOT TESTED').trim() || 'NOT TESTED';
    c[st] = (c[st] || 0) + 1;
    tot[st] = (tot[st] || 0) + 1;
  }
  counts[name] = c;
}
const sum = [
  ['Byufuel — TravelVIP execution report'],
  ['Env', ENV],
  ['Report date', '2026-09-25'],
  ['Tester', 'Rohan Bhagat (TravelVIP QA)'],
  ['Column', 'Rohan TravelVIP Status'],
  [],
  ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT TESTED', 'TOTAL'],
  [tot.PASS, tot.FAIL, tot.PARTIAL, tot.BLOCKED, tot['NOT TESTED'], Object.values(tot).reduce((a, b) => a + b, 0)],
  [],
  ['Sheet', 'PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT TESTED'],
];
for (const [n, c] of Object.entries(counts)) {
  sum.push([n, c.PASS || 0, c.FAIL || 0, c.PARTIAL || 0, c.BLOCKED || 0, c['NOT TESTED'] || 0]);
}
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);
XLSX.writeFile(wb, TRACKER);

let table = '';
for (const [n, c] of Object.entries(counts)) {
  table += `| ${n} | ${c.PASS || 0} | ${c.FAIL || 0} | ${c.PARTIAL || 0} | ${c.BLOCKED || 0} | ${c['NOT TESTED'] || 0} |\n`;
}
const md = `# Byufuel — TravelVIP execution report (25 Sep 2026)

**Env:** ${ENV}  
**Tester:** Rohan Bhagat  
**File:** \`reports/byufuel-drive/execution-2026-09-25/BYUFUEL-TravelVIP-Execution-Tracker.xlsx\`

## Team summary

| Status | Count |
|--------|------:|
| PASS | ${tot.PASS} |
| FAIL | ${tot.FAIL} |
| PARTIAL | ${tot.PARTIAL} |
| BLOCKED | ${tot.BLOCKED} |
| NOT TESTED | ${tot['NOT TESTED']} |

## By pack

| Pack | PASS | FAIL | PARTIAL | BLOCKED | NOT TESTED |
|------|-----:|-----:|--------:|--------:|-----------:|
${table}
## Notes

- Tracker column **Rohan TravelVIP Status** is what we share vs Centvis **Works? / Pass**.
- Checklist largely filled from E2E + prior runs; Bulk/TSM were blocked by tunnel 530 mid-session — retest when stable.
- Detailed TC sheets still mostly NOT TESTED (step-level).
`;
fs.writeFileSync(path.join(OUT, 'TRAVELVIP-EXECUTION-REPORT.md'), md);
console.log(JSON.stringify(tot));

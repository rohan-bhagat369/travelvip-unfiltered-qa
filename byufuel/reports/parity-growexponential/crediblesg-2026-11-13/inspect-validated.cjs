const path = require('path');
const XLSX = require(path.join('d:\\Travel VIP API Automation\\node_modules', 'xlsx'));
const src = 'd:\\Travel VIP API Automation\\byufuel\\reports\\byufuel-drive\\BYUFUEL-Validated-TCs-live.xlsx';
const wb = XLSX.readFile(src);

for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  // find first 12 non-empty-ish rows
  console.log('\n========', name, 'rawRows', rows.length);
  let shown = 0;
  for (let i = 0; i < rows.length && shown < 8; i++) {
    const r = rows[i];
    if (!r.some((c) => String(c).trim())) continue;
    console.log(i, JSON.stringify(r.slice(0, 14)));
    shown++;
  }
  // count rows that look like test cases (have numeric-ish id in col A or B)
  let caseLike = 0;
  for (const r of rows) {
    const a = String(r[0] || '').trim();
    if (/^\d+$/.test(a) || /^TC[-_]?\d+/i.test(a)) caseLike++;
  }
  console.log('caseLikeIds', caseLike);
}

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const fp = path.join(process.env.USERPROFILE, 'Downloads', 'Byufuel - Check list Doc.xlsx');
const wb = XLSX.readFile(fp);
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' });

console.log('TOTAL_ROWS', rows.length);
console.log('FULL_SHEET:');
for (let i = 0; i < rows.length; i++) {
  const cells = rows[i].map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!cells.length) continue;
  console.log(String(i + 1).padStart(3), cells.join(' || ').slice(0, 220));
}

// Also scan other xlsx in Downloads for literal ADM-47
const downloads = path.join(process.env.USERPROFILE, 'Downloads');
for (const f of fs.readdirSync(downloads).filter((x) => /\.xlsx$/i.test(x) && /byu|check|bulk|support|tsm|tc/i.test(x))) {
  const w = XLSX.readFile(path.join(downloads, f));
  for (const sn of w.SheetNames) {
    const r = XLSX.utils.sheet_to_json(w.Sheets[sn], { header: 1, defval: '' });
    for (let i = 0; i < r.length; i++) {
      const line = r[i].map(String).join(' | ');
      if (/ADM-47|ADM 47|ADM_47/i.test(line) || (/47/.test(line) && /recurring/i.test(line))) {
        console.log('HIT', f, sn, i + 1, line.slice(0, 250));
      }
    }
  }
}

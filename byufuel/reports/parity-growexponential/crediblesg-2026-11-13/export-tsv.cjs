const fs = require('fs');
const path = require('path');
const XLSX = require(path.join('d:\\Travel VIP API Automation\\node_modules', 'xlsx'));

const src =
  'd:\\Travel VIP API Automation\\byufuel\\reports\\parity-growexponential\\crediblesg-2026-11-13\\BYUFUEL-Crediblesg-UAT-TCs.xlsx';
const outDir =
  'd:\\Travel VIP API Automation\\byufuel\\reports\\parity-growexponential\\crediblesg-2026-11-13\\sheet-tsv';

fs.mkdirSync(outDir, { recursive: true });
const wb = XLSX.readFile(src);
const manifest = [];

for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const tsv = rows
    .map((r) =>
      r
        .map((c) => {
          let s = String(c ?? '');
          // Sheets paste: keep tabs/newlines escaped lightly
          s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ');
          return s;
        })
        .join('\t')
    )
    .join('\n');
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const file = path.join(outDir, `${safe}.tsv`);
  fs.writeFileSync(file, tsv, 'utf8');
  manifest.push({ name, file, rows: rows.length, cols: Math.max(...rows.map((r) => r.length)) });
  console.log(name, rows.length, '->', file);
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('done', manifest.length);

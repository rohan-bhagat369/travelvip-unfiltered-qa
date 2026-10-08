const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const downloads = path.join(process.env.USERPROFILE, 'Downloads');
const targets = [
  'reports/byufuel-drive/BYUFUEL-Validated-TCs-live.xlsx',
  path.join(downloads, "Byufuel - Bulk Schedule web TC's.xlsx"),
  path.join(downloads, 'Byufuel - Check list Doc.xlsx'),
  path.join(downloads, "Byufuel-TC's.xlsx"),
  path.join(downloads, 'Byufuel- TSM (Web).xlsx'),
];

for (const fp of targets) {
  if (!fs.existsSync(fp)) {
    console.log('missing', fp);
    continue;
  }
  const wb = XLSX.readFile(fp);
  console.log('\nFILE', path.basename(fp));
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i].map(String).join(' | ');
      if (/reschedul|Suggest a new time|replaced upon confirmation|Bulk Recurring|bulk schedule/i.test(line)) {
        console.log(`  [${sn}] R${i + 1}: ${line.replace(/\s+/g, ' ').slice(0, 200)}`);
      }
    }
  }
}

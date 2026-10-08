const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const downloads = path.join(process.env.USERPROFILE, 'Downloads');
const files = [
  'Byufuel - Check list Doc.xlsx',
  "Byufuel-TC's.xlsx",
  'Byufuel Support Tickets Overview.xlsx',
  "Byufuel - Bulk Schedule web TC's.xlsx",
  'Byufuel- TSM (Web).xlsx',
  'Byufuel-TSM (Mobile).xlsx',
  'bulk-schedule.xlsx',
];

function scan(file) {
  const fp = path.join(downloads, file);
  if (!fs.existsSync(fp)) return { missing: true };
  const wb = XLSX.readFile(fp);
  const hits = [];
  const allIds = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map((c) => String(c ?? ''));
      const line = cells.join(' | ');
      for (const v of cells) {
        const t = v.trim();
        if (/^(ADM|WH|SUP|DRV|TSM|BULK)[-_\s]?\d+/i.test(t)) {
          allIds.push({ sheet: sn, row: i + 1, id: t });
        }
      }
      if (/\bADM[-_\s]?47\b/i.test(line) || /\bWH[-_\s]?11\b/i.test(line)) {
        hits.push({
          sheet: sn,
          row: i + 1,
          cells: cells.map((c) => c.slice(0, 140)).filter(Boolean),
        });
      }
    }
  }
  return {
    hits,
    admIds: allIds.filter((x) => /^ADM/i.test(x.id)).slice(0, 80),
    whIds: allIds.filter((x) => /^WH/i.test(x.id)).slice(0, 80),
    adm47: allIds.filter((x) => /ADM[-_\s]?47\b/i.test(x.id)),
    wh11: allIds.filter((x) => /WH[-_\s]?11\b/i.test(x.id)),
  };
}

const out = {};
for (const f of files) out[f] = scan(f);
fs.writeFileSync(
  path.join('reports', 'byufuel-adm47-wh11-scan.json'),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));

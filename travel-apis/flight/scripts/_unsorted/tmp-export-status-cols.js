import XLSX from 'xlsx';
import fs from 'fs';

const wb = XLSX.readFile('Final production globaltix sheet - globaltix_products_full (1).csv', { raw: false });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const lines = ['working_qa_status\tprice_mismatch'];
for (const r of rows) {
  lines.push(`${r.working_qa_status || ''}\t${r.price_mismatch || ''}`);
}
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/globaltix-status-columns.tsv', lines.join('\n'), 'utf8');
console.log('wrote', lines.length, 'lines');

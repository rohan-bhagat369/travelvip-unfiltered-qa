import fs from 'fs';
import full from '../src/regression/cab-error-contract-full.json' with { type: 'json' };

function esc(s) {
  return `"${String(s ?? '').replaceAll('"', '""')}"`;
}

const rows = [['Id', 'Section', 'Method', 'Path', 'HTTP', 'Code', 'Message', 'Automated', 'Needs/Notes']];
for (const ep of full.endpoints) {
  for (const v of ep.validations) {
    rows.push([
      v.id,
      String(ep.section),
      ep.method,
      ep.path,
      String(v.http),
      v.code ?? '',
      v.message || '',
      v.automated ? 'yes' : 'no',
      [v.needs, v.note, v.details].filter(Boolean).join(' | '),
    ]);
  }
}

const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
fs.writeFileSync('Cab API Error Contract - Validations.csv', csv);
fs.copyFileSync('src/cab/regression/cab-error-contract-full.json', 'docs/cab-error-contract-full.json');

const auto = rows.slice(1).filter((r) => r[7] === 'yes').length;
const pending = rows.slice(1).filter((r) => r[7] === 'no').length;
console.log(`CSV: ${rows.length - 1} validations | automated ${auto} | pending ${pending}`);

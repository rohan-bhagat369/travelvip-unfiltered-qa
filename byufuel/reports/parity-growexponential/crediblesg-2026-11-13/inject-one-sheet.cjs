/** Prints JSON {name, text} for one TSV so the agent can paste into Sheets */
const fs = require('fs');
const path = require('path');
const name = process.argv[2];
if (!name) {
  console.error('usage: node inject-one-sheet.cjs <SheetName>');
  process.exit(1);
}
const dir =
  'd:/Travel VIP API Automation/byufuel/reports/parity-growexponential/crediblesg-2026-11-13/sheet-tsv';
const file = path.join(dir, `${name}.tsv`);
const text = fs.readFileSync(file, 'utf8');
process.stdout.write(JSON.stringify({ name, text, len: text.length }));

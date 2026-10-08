import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(__dirname, '../reports/combined');

function autoWidth(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => ({
    wch: Math.min(Math.max(rows.reduce((m, r) => Math.max(m, String(r[key] ?? '').length, key.length), key.length) + 2, 12), 80),
  }));
}

function groupFails(rows, nameField) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row['IATA Code']}|${row['Sheet Terminal']}`;
    if (!map.has(key)) {
      map.set(key, {
        'Airport Name': row['Airport Name'],
        'IATA Code': row['IATA Code'],
        Terminal: row['Sheet Terminal'],
        'Not Available Count': 0,
        [nameField]: [],
        Notes: [],
      });
    }
    const entry = map.get(key);
    entry['Not Available Count'] += 1;
    entry[nameField].push(row[nameField] || row['Sheet Lounge Name'] || row['Sheet Fasttrack Name']);
    if (row.Notes) entry.Notes.push(row.Notes);
  }

  return [...map.values()].map((entry) => ({
    ...entry,
    [nameField]: entry[nameField].join('; '),
    Notes: [...new Set(entry.Notes)].join(' | '),
  }));
}

const loungeRows = XLSX.utils.sheet_to_json(
  XLSX.readFile(path.resolve(__dirname, '../reports/lounge/latest-lounge-availability-report.xlsx')).Sheets['Lounge Validation'],
);
const ftRows = XLSX.utils.sheet_to_json(
  XLSX.readFile(path.resolve(__dirname, '../reports/fasttrack/latest-fasttrack-availability-report.xlsx')).Sheets['Fasttrack Validation'],
);

const loungeFails = loungeRows.filter((row) => row.Status === 'FAIL');
const ftFails = ftRows.filter((row) => row.Status === 'FAIL');
const loungeByTerminal = groupFails(loungeFails, 'Sheet Lounge Names');
const ftByTerminal = groupFails(ftFails, 'Sheet Fasttrack Names');

const summary = [{
  'Generated At': new Date().toISOString(),
  'Lounge - Airports/Terminals Not Available': loungeByTerminal.length,
  'Lounge - Total Sheet Items Not Available': loungeFails.length,
  'Fasttrack - Airports/Terminals Not Available': ftByTerminal.length,
  'Fasttrack - Total Sheet Items Not Available': ftFails.length,
}];

const workbook = XLSX.utils.book_new();
for (const [name, rows] of [
  ['Summary', summary],
  ['Lounge Not Available', loungeByTerminal],
  ['Fasttrack Not Available', ftByTerminal],
  ['Lounge Not Available Detail', loungeFails],
  ['Fasttrack Not Available Detail', ftFails],
]) {
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'No data' }]);
  sheet['!cols'] = autoWidth(rows.length ? rows : [{ Info: '' }]);
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

fs.mkdirSync(reportsDir, { recursive: true });
const latestPath = path.join(reportsDir, 'latest-not-available-by-service.xlsx');
XLSX.writeFile(workbook, latestPath);
console.log('Report:', latestPath);
console.log('Lounge terminals not available:', loungeByTerminal.length);
console.log('Fasttrack terminals not available:', ftByTerminal.length);

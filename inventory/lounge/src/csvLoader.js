import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.resolve(
  __dirname,
  '../../Product DP-lounge Data(live) - dragonpass_lounge_locations.csv',
);

export function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function loadLoungeSheet(csvPath = DEFAULT_CSV) {
  const workbook = XLSX.readFile(csvPath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  return rows
    .map((row) => ({
      resourceId: String(row.resourceId ?? '').trim(),
      loungeName: String(row.loungeName ?? '').trim(),
      iata: String(row.iata ?? '').trim().toUpperCase(),
      location: String(row.location ?? '').trim(),
      terminal: String(row.terminal ?? '').trim(),
      airportName: String(row.airportName ?? '').trim(),
      available: String(row['Available '] ?? row.Available ?? '').trim(),
      issue: String(row.ISSUE ?? '').trim(),
    }))
    .filter((row) => row.iata);
}

export function groupSheetByAirport(rows) {
  const airports = new Map();

  for (const row of rows) {
    if (!airports.has(row.iata)) {
      airports.set(row.iata, {
        iata: row.iata,
        airportNames: new Set(),
        lounges: [],
        terminals: new Map(),
      });
    }

    const airport = airports.get(row.iata);
    if (row.airportName) airport.airportNames.add(row.airportName);
    airport.lounges.push(row);

    const terminalKey = normalizeText(row.terminal || 'Unknown');
    if (!airport.terminals.has(terminalKey)) {
      airport.terminals.set(terminalKey, {
        terminal: row.terminal || 'Unknown',
        lounges: [],
      });
    }
    airport.terminals.get(terminalKey).lounges.push(row);
  }

  return airports;
}

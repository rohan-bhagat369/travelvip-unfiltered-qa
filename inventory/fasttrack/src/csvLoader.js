import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.resolve(
  __dirname,
  '../../Production DP-fasttrack data(live) - Sheet2.csv',
);

export function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function loadFasttrackSheet(csvPath = DEFAULT_CSV) {
  const workbook = XLSX.readFile(csvPath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  return rows
    .map((row) => ({
      resourceId: String(row.resourceId ?? '').trim(),
      resourceName: String(row.resourceName ?? '').trim(),
      iata: String(row.iata ?? '').trim().toUpperCase(),
      location: String(row.location ?? '').trim(),
      terminal: String(row.terminal ?? '').trim(),
      airportName: String(row.airportName ?? '').trim(),
      routeTypes: String(row.routeTypes ?? '').trim(),
    }))
    .filter((row) => row.iata);
}

export function routeTypesToSides(routeTypes) {
  const text = String(routeTypes ?? '').toUpperCase();
  const sides = new Set();
  if (text.includes('DEPARTURE')) sides.add('Departure');
  if (text.includes('ARRIVAL')) sides.add('Arrival');
  return [...sides];
}

export function groupSheetByAirport(rows) {
  const airports = new Map();

  for (const row of rows) {
    if (!airports.has(row.iata)) {
      airports.set(row.iata, {
        iata: row.iata,
        airportNames: new Set(),
        fasttracks: [],
        terminals: new Map(),
      });
    }

    const airport = airports.get(row.iata);
    if (row.airportName) airport.airportNames.add(row.airportName);
    airport.fasttracks.push(row);

    const terminalKey = normalizeText(row.terminal || 'Unknown');
    if (!airport.terminals.has(terminalKey)) {
      airport.terminals.set(terminalKey, {
        terminal: row.terminal || 'Unknown',
        fasttracks: [],
      });
    }
    airport.terminals.get(terminalKey).fasttracks.push(row);
  }

  return airports;
}

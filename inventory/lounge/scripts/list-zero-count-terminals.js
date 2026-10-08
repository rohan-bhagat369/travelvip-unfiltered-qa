import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { loadLoungeSheet } from '../../../../inventory/lounge/src/csvLoader.js';
import { loadFasttrackSheet } from '../../../../inventory/fasttrack/src/csvLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(__dirname, '../../reports/combined');

const BASE_URL = 'https://preprod-next-api.travelvip.ai/api/airportServices';
const QUERY = {
  key: process.env.LOUNGE_API_KEY || 'palsgcvgscvvs',
  pid: process.env.LOUNGE_PID || 'smt',
  platform: 'web',
  client: 'web',
  lang: 'en',
  currency: 'USD',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(type, iata) {
  const params = new URLSearchParams({
    ...QUERY,
    q: iata,
    page: '0',
    size: '20',
    type,
  });
  return `${BASE_URL}/airport-services?${params.toString()}`;
}

async function fetchAirportServices(type, iata, token) {
  const response = await fetch(buildUrl(type, iata), {
    headers: {
      accept: 'application/json, text/plain, */*',
      authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
  }
  await sleep(80);
  return data;
}

function getAirportResult(data, iata) {
  return data?.results?.find(
    (item) => String(item.airportCode || '').toUpperCase() === iata,
  ) || data?.results?.[0] || null;
}

function autoWidth(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => ({
    wch: Math.min(
      Math.max(
        rows.reduce((max, row) => Math.max(max, String(row[key] ?? '').length, key.length), key.length) + 2,
        12,
      ),
      80,
    ),
  }));
}

async function main() {
  const token = process.env.FASTTRACK_BEARER_TOKEN || process.env.LOUNGE_BEARER_TOKEN;
  if (!token) throw new Error('Missing LOUNGE_BEARER_TOKEN');

  const iataCodes = [...new Set([
    ...loadLoungeSheet().map((row) => row.iata),
    ...loadFasttrackSheet().map((row) => row.iata),
  ])].sort();

  const zeroLoungeTerminals = [];
  const zeroFasttrackTerminals = [];
  const loungeAirportNotFound = [];
  const fasttrackAirportNotFound = [];
  const loungeAirportZeroTotal = [];
  const fasttrackAirportZeroTotal = [];
  const errors = [];

  for (let index = 0; index < iataCodes.length; index += 1) {
    const iata = iataCodes[index];
    if (index === 0 || (index + 1) % 50 === 0 || index + 1 === iataCodes.length) {
      console.log(`[${index + 1}/${iataCodes.length}] ${iata}`);
    }

    try {
      const loungeData = await fetchAirportServices('lounge', iata, token);
      const loungeAirport = getAirportResult(loungeData, iata);
      if (!loungeAirport) {
        loungeAirportNotFound.push({ 'IATA Code': iata, 'Airport Name': '', 'Lounge Count': 0, Notes: 'Airport not found in lounge API' });
      } else if (!loungeAirport.terminalInfo?.length || Number(loungeAirport.availableCount ?? 0) === 0) {
        loungeAirportZeroTotal.push({
          'Airport Name': loungeAirport.title,
          'IATA Code': iata,
          'Available Count': loungeAirport.availableCount ?? 0,
          Terminals: (loungeAirport.terminals || []).join(', '),
          Notes: 'Airport found but total lounge count is 0',
        });
      } else {
        for (const terminal of loungeAirport.terminalInfo) {
          if (Number(terminal.count ?? 0) === 0) {
            zeroLoungeTerminals.push({
              'Airport Name': loungeAirport.title,
              'IATA Code': iata,
              Terminal: terminal.name,
              'Lounge Count': 0,
              Sides: (terminal.sides || []).join(', '),
            });
          }
        }
      }
    } catch (error) {
      errors.push({ iata, step: 'lounge', error: error.message });
    }

    try {
      const fasttrackData = await fetchAirportServices('fasttrack', iata, token);
      const fasttrackAirport = getAirportResult(fasttrackData, iata);
      if (!fasttrackAirport) {
        fasttrackAirportNotFound.push({ 'IATA Code': iata, 'Airport Name': '', 'Fasttrack Count': 0, Notes: 'Airport not found in fasttrack API' });
      } else if (!fasttrackAirport.terminalInfo?.length || Number(fasttrackAirport.availableCount ?? 0) === 0) {
        fasttrackAirportZeroTotal.push({
          'Airport Name': fasttrackAirport.title,
          'IATA Code': iata,
          'Available Count': fasttrackAirport.availableCount ?? 0,
          Terminals: (fasttrackAirport.terminals || []).join(', '),
          Notes: 'Airport found but total fasttrack count is 0',
        });
      } else {
        for (const terminal of fasttrackAirport.terminalInfo) {
          if (Number(terminal.count ?? 0) === 0) {
            zeroFasttrackTerminals.push({
              'Airport Name': fasttrackAirport.title,
              'IATA Code': iata,
              Terminal: terminal.name,
              'Fasttrack Count': 0,
              Sides: (terminal.sides || []).join(', '),
            });
          }
        }
      }
    } catch (error) {
      errors.push({ iata, step: 'fasttrack', error: error.message });
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const latestPath = path.join(reportsDir, 'latest-zero-count-by-service.xlsx');
  const outputPath = path.join(reportsDir, `zero-count-by-service-${timestamp}.xlsx`);

  const summary = [{
    'Generated At': new Date().toISOString(),
    'Airports Checked': iataCodes.length,
    'Zero Lounge Terminals (API)': zeroLoungeTerminals.length,
    'Zero Fasttrack Terminals (API)': zeroFasttrackTerminals.length,
    'Lounge Airport Not Found': loungeAirportNotFound.length,
    'Fasttrack Airport Not Found': fasttrackAirportNotFound.length,
    'Lounge Airport Total Count 0': loungeAirportZeroTotal.length,
    'Fasttrack Airport Total Count 0': fasttrackAirportZeroTotal.length,
    'API Errors': errors.length,
  }];

  const workbook = XLSX.utils.book_new();
  const sheets = [
    ['Summary', summary],
    ['Zero Lounge Terminals', zeroLoungeTerminals],
    ['Zero Fasttrack Terminals', zeroFasttrackTerminals],
    ['Lounge Airport Not Found', loungeAirportNotFound],
    ['Fasttrack Airport Not Found', fasttrackAirportNotFound],
    ['Lounge Airport Count 0', loungeAirportZeroTotal],
    ['Fasttrack Airport Count 0', fasttrackAirportZeroTotal],
    ['Errors', errors],
  ];

  for (const [name, rows] of sheets) {
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'No data' }]);
    sheet['!cols'] = autoWidth(rows.length ? rows : [{ Info: '' }]);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  XLSX.writeFile(workbook, outputPath);
  XLSX.writeFile(workbook, latestPath);

  console.log('\nReport:', latestPath);
  console.log('Zero lounge terminals:', zeroLoungeTerminals.length);
  console.log('Zero fasttrack terminals:', zeroFasttrackTerminals.length);
  console.log('Lounge airport not found:', loungeAirportNotFound.length);
  console.log('Fasttrack airport not found:', fasttrackAirportNotFound.length);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { LoungeApiClient, extractLoungesFromCarousel } from './apiClient.js';
import { groupSheetByAirport, loadLoungeSheet, normalizeText } from './csvLoader.js';

function loungeNameMatches(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function terminalMatches(sheetTerminal, apiTerminal) {
  const sheetKey = normalizeText(sheetTerminal);
  const apiKey = normalizeText(apiTerminal);
  if (!sheetKey || !apiKey) return false;
  return sheetKey === apiKey || sheetKey.includes(apiKey) || apiKey.includes(sheetKey);
}

function findSheetTerminalInApi(sheetTerminal, apiTerminals) {
  return apiTerminals.find((terminal) => terminalMatches(sheetTerminal, terminal.name)) || null;
}

function findLoungeInApiLounges(loungeName, apiLounges) {
  return apiLounges.find((lounge) => loungeNameMatches(lounge.title, loungeName)) || null;
}

function autoWidth(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    const maxLen = rows.reduce((max, row) => {
      const len = String(row[key] ?? '').length;
      return Math.max(max, len, key.length);
    }, key.length);
    return { wch: Math.min(Math.max(maxLen + 2, 12), 80) };
  });
}

async function fetchAirportApiData(client, iata, sheetAirport, errorRows) {
  const airportNameFromSheet = [...sheetAirport.airportNames][0] || '';

  let airportResult;
  try {
    airportResult = await client.getAirportServices(iata);
  } catch (error) {
    errorRows.push({
      'IATA Code': iata,
      'Airport Name': airportNameFromSheet,
      Step: 'airport-services',
      Error: error.message,
    });
    return { error: error.message };
  }

  const airport = airportResult?.results?.find(
    (item) => normalizeText(item.airportCode) === normalizeText(iata),
  ) || airportResult?.results?.[0];

  if (!airport) {
    return { error: 'Airport not found in API' };
  }

  const airportName = airport.title || airportNameFromSheet;
  const terminalInfo = airport.terminalInfo ?? [];
  const terminals = [];
  const allLounges = [];

  for (const terminal of terminalInfo) {
    let carouselData = { totalCount: 0, lounges: [] };
    let carouselError = null;

    try {
      const carouselResponse = await client.getTerminalLounges(airport.entityId, terminal.name);
      carouselData = extractLoungesFromCarousel(carouselResponse);
    } catch (error) {
      carouselError = error.message;
      errorRows.push({
        'IATA Code': iata,
        'Airport Name': airportName,
        Step: `carousels:${terminal.name}`,
        Error: error.message,
      });
    }

    const terminalData = {
      name: terminal.name,
      sides: terminal.sides || [],
      count: terminal.count ?? 0,
      lounges: carouselData.lounges,
      error: carouselError,
    };

    terminals.push(terminalData);
    for (const lounge of carouselData.lounges) {
      allLounges.push({
        ...lounge,
        apiTerminal: terminal.name,
      });
    }
  }

  return {
    airportName,
    entityId: airport.entityId,
    terminals,
    allLounges,
  };
}

function validateSheetLounge(sheetLounge, apiData) {
  if (apiData.error) {
    return {
      status: 'FAIL',
      apiTerminalMatched: '',
      apiLoungeNameMatched: '',
      notes: apiData.error,
    };
  }

  if (!apiData.terminals.length) {
    return {
      status: 'FAIL',
      apiTerminalMatched: '',
      apiLoungeNameMatched: '',
      notes: 'No terminals returned by API',
    };
  }

  const matchedTerminal = findSheetTerminalInApi(sheetLounge.terminal, apiData.terminals);

  if (matchedTerminal) {
    const loungeInTerminal = findLoungeInApiLounges(sheetLounge.loungeName, matchedTerminal.lounges);
    if (loungeInTerminal) {
      return {
        status: 'PASS',
        apiTerminalMatched: matchedTerminal.name,
        apiLoungeNameMatched: loungeInTerminal.title,
        notes: '',
      };
    }

    if (matchedTerminal.error) {
      return {
        status: 'FAIL',
        apiTerminalMatched: matchedTerminal.name,
        apiLoungeNameMatched: '',
        notes: `Terminal API error: ${matchedTerminal.error}`,
      };
    }
  }

  const loungeAnywhere = findLoungeInApiLounges(sheetLounge.loungeName, apiData.allLounges);
  if (loungeAnywhere) {
    return {
      status: 'PASS',
      apiTerminalMatched: loungeAnywhere.apiTerminal,
      apiLoungeNameMatched: loungeAnywhere.title,
      notes: matchedTerminal
        ? 'Lounge found in API but under a different terminal'
        : 'Lounge found in API but sheet terminal did not match',
    };
  }

  const availableApiLounges = apiData.allLounges.map((lounge) => lounge.title).join('; ');
  return {
    status: 'FAIL',
    apiTerminalMatched: matchedTerminal?.name || '',
    apiLoungeNameMatched: '',
    notes: availableApiLounges
      ? `Lounge not found in API. Available lounges: ${availableApiLounges}`
      : 'Lounge not found in API and no lounges returned',
  };
}

export async function generateLoungeAvailabilityReport(options = {}) {
  const sheetRows = loadLoungeSheet(options.csvPath);
  const sheetAirports = groupSheetByAirport(sheetRows);
  const client = new LoungeApiClient(options);
  const iataCodes = [...sheetAirports.keys()].sort();
  const limitedIataCodes = options.airportLimit
    ? iataCodes.slice(0, options.airportLimit)
    : iataCodes;

  const validationRows = [];
  const terminalSummaryRows = [];
  const errorRows = [];
  const apiCache = new Map();
  let processedAirports = 0;

  for (const iata of limitedIataCodes) {
    processedAirports += 1;
    const sheetAirport = sheetAirports.get(iata);

    if (options.onProgress) {
      options.onProgress({
        current: processedAirports,
        total: limitedIataCodes.length,
        iata,
      });
    }

    const apiData = await fetchAirportApiData(client, iata, sheetAirport, errorRows);
    apiCache.set(iata, apiData);

    for (const terminal of apiData.terminals || []) {
      terminalSummaryRows.push({
        'Airport Name': apiData.airportName || '',
        'IATA Code': iata,
        Terminal: terminal.name,
        'Terminal Sides': (terminal.sides || []).join(', '),
        'API Lounge Count': terminal.count ?? terminal.lounges.length,
        'Lounge Names (API)': terminal.lounges.map((lounge) => lounge.title).join('; '),
      });
    }
  }

  const loungesToValidate = options.airportLimit
    ? sheetRows.filter((row) => limitedIataCodes.includes(row.iata))
    : sheetRows;

  for (const sheetLounge of loungesToValidate) {
    const apiData = apiCache.get(sheetLounge.iata) || { error: 'Airport not processed' };
    const result = validateSheetLounge(sheetLounge, apiData);

    validationRows.push({
      'Resource ID': sheetLounge.resourceId,
      'Airport Name': sheetLounge.airportName || apiData.airportName || '',
      'IATA Code': sheetLounge.iata,
      'Sheet Terminal': sheetLounge.terminal,
      'Sheet Lounge Name': sheetLounge.loungeName,
      'Sheet Available': sheetLounge.available,
      'API Terminal Matched': result.apiTerminalMatched,
      'API Lounge Name Matched': result.apiLoungeNameMatched,
      Status: result.status,
      Notes: result.notes,
      'Sheet Issue': sheetLounge.issue,
    });
  }

  const passCount = validationRows.filter((row) => row.Status === 'PASS').length;
  const failCount = validationRows.filter((row) => row.Status === 'FAIL').length;

  const summaryRows = [{
    'Generated At': new Date().toISOString(),
    'Total Sheet Lounges Validated': validationRows.length,
    PASS: passCount,
    FAIL: failCount,
    'Pass %': validationRows.length
      ? `${((passCount / validationRows.length) * 100).toFixed(1)}%`
      : '0%',
    'Unique Airports Processed': limitedIataCodes.length,
    'API Errors': errorRows.length,
  }];

  return {
    summaryRows,
    validationRows,
    terminalSummaryRows,
    errorRows,
  };
}

export function writeLoungeReportExcel(reportData, outputPath) {
  const workbook = XLSX.utils.book_new();

  const sheets = [
    ['Summary', reportData.summaryRows],
    ['Lounge Validation', reportData.validationRows],
    ['Terminal Summary', reportData.terminalSummaryRows],
    ['Errors', reportData.errorRows],
  ];

  for (const [name, rows] of sheets) {
    const safeRows = rows.length
      ? rows
      : [{ Info: `No ${name.toLowerCase()} data` }];
    const sheet = XLSX.utils.json_to_sheet(safeRows);
    sheet['!cols'] = autoWidth(safeRows);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}

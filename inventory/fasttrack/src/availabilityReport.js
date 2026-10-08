import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { FasttrackApiClient, extractFasttracksFromCarousel } from './apiClient.js';
import {
  groupSheetByAirport,
  loadFasttrackSheet,
  normalizeText,
  routeTypesToSides,
} from './csvLoader.js';

function nameMatches(a, b) {
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

function findFasttrackInList(resourceName, fasttracks) {
  return fasttracks.find((item) => nameMatches(item.title, resourceName)) || null;
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
  const allFasttracks = [];

  for (const terminal of terminalInfo) {
    const sides = terminal.sides?.length ? terminal.sides : ['Departure'];
    const sideResults = [];

    for (const terminalSide of sides) {
      let carouselData = { totalCount: 0, fasttracks: [] };
      let carouselError = null;

      try {
        const carouselResponse = await client.getTerminalFasttracks(
          airport.entityId,
          terminal.name,
          terminalSide,
        );
        carouselData = extractFasttracksFromCarousel(carouselResponse);
      } catch (error) {
        carouselError = error.message;
        errorRows.push({
          'IATA Code': iata,
          'Airport Name': airportName,
          Step: `carousels:${terminal.name}:${terminalSide}`,
          Error: error.message,
        });
      }

      sideResults.push({
        terminalSide,
        fasttracks: carouselData.fasttracks,
        totalCount: carouselData.totalCount,
        error: carouselError,
      });

      for (const fasttrack of carouselData.fasttracks) {
        allFasttracks.push({
          ...fasttrack,
          apiTerminal: terminal.name,
          apiTerminalSide: terminalSide,
        });
      }
    }

    terminals.push({
      name: terminal.name,
      sides,
      count: terminal.count ?? 0,
      sideResults,
      fasttracks: sideResults.flatMap((side) => side.fasttracks),
    });
  }

  return {
    airportName,
    entityId: airport.entityId,
    terminals,
    allFasttracks,
  };
}

function validateSheetFasttrack(sheetRow, apiData) {
  if (apiData.error) {
    return {
      status: 'FAIL',
      apiTerminalMatched: '',
      apiTerminalSideMatched: '',
      apiFasttrackNameMatched: '',
      notes: apiData.error,
    };
  }

  if (!apiData.terminals.length) {
    return {
      status: 'FAIL',
      apiTerminalMatched: '',
      apiTerminalSideMatched: '',
      apiFasttrackNameMatched: '',
      notes: 'No terminals returned by API',
    };
  }

  const expectedSides = routeTypesToSides(sheetRow.routeTypes);
  const matchedTerminal = findSheetTerminalInApi(sheetRow.terminal, apiData.terminals);

  if (matchedTerminal) {
    const sideCandidates = expectedSides.length
      ? matchedTerminal.sideResults.filter((side) => expectedSides.includes(side.terminalSide))
      : matchedTerminal.sideResults;

    for (const side of sideCandidates) {
      const found = findFasttrackInList(sheetRow.resourceName, side.fasttracks);
      if (found) {
        return {
          status: 'PASS',
          apiTerminalMatched: matchedTerminal.name,
          apiTerminalSideMatched: side.terminalSide,
          apiFasttrackNameMatched: found.title,
          notes: '',
        };
      }
    }

    const foundInTerminal = findFasttrackInList(sheetRow.resourceName, matchedTerminal.fasttracks);
    if (foundInTerminal) {
      return {
        status: 'PASS',
        apiTerminalMatched: matchedTerminal.name,
        apiTerminalSideMatched: foundInTerminal.direction || '',
        apiFasttrackNameMatched: foundInTerminal.title,
        notes: expectedSides.length
          ? 'Fasttrack found in API but terminal side did not match sheet route type'
          : '',
      };
    }
  }

  const sideFiltered = expectedSides.length
    ? apiData.allFasttracks.filter((item) => expectedSides.includes(item.apiTerminalSide))
    : apiData.allFasttracks;

  const foundAnywhere = findFasttrackInList(sheetRow.resourceName, sideFiltered)
    || findFasttrackInList(sheetRow.resourceName, apiData.allFasttracks);

  if (foundAnywhere) {
    return {
      status: 'PASS',
      apiTerminalMatched: foundAnywhere.apiTerminal,
      apiTerminalSideMatched: foundAnywhere.apiTerminalSide,
      apiFasttrackNameMatched: foundAnywhere.title,
      notes: matchedTerminal
        ? 'Fasttrack found in API but under a different terminal/side'
        : 'Fasttrack found in API but sheet terminal did not match',
    };
  }

  const available = apiData.allFasttracks
    .map((item) => `${item.title} (${item.apiTerminal}, ${item.apiTerminalSide})`)
    .join('; ');

  return {
    status: 'FAIL',
    apiTerminalMatched: matchedTerminal?.name || '',
    apiTerminalSideMatched: expectedSides.join(', '),
    apiFasttrackNameMatched: '',
    notes: available
      ? `Fasttrack not found in API. Available: ${available}`
      : 'Fasttrack not found in API and no fasttracks returned',
  };
}

export async function generateFasttrackAvailabilityReport(options = {}) {
  const sheetRows = loadFasttrackSheet(options.csvPath);
  const sheetAirports = groupSheetByAirport(sheetRows);
  const client = new FasttrackApiClient(options);
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
      for (const side of terminal.sideResults || []) {
        terminalSummaryRows.push({
          'Airport Name': apiData.airportName || '',
          'IATA Code': iata,
          Terminal: terminal.name,
          'Terminal Side': side.terminalSide,
          'API Fasttrack Count': side.totalCount ?? side.fasttracks.length,
          'Fasttrack Names (API)': side.fasttracks.map((item) => item.title).join('; '),
        });
      }
    }
  }

  const rowsToValidate = options.airportLimit
    ? sheetRows.filter((row) => limitedIataCodes.includes(row.iata))
    : sheetRows;

  for (const sheetRow of rowsToValidate) {
    const apiData = apiCache.get(sheetRow.iata) || { error: 'Airport not processed' };
    const result = validateSheetFasttrack(sheetRow, apiData);

    validationRows.push({
      'Resource ID': sheetRow.resourceId,
      'Airport Name': sheetRow.airportName || apiData.airportName || '',
      'IATA Code': sheetRow.iata,
      'Sheet Terminal': sheetRow.terminal,
      'Sheet Fasttrack Name': sheetRow.resourceName,
      'Sheet Route Types': sheetRow.routeTypes,
      'API Terminal Matched': result.apiTerminalMatched,
      'API Terminal Side Matched': result.apiTerminalSideMatched,
      'API Fasttrack Name Matched': result.apiFasttrackNameMatched,
      Status: result.status,
      Notes: result.notes,
    });
  }

  const passCount = validationRows.filter((row) => row.Status === 'PASS').length;
  const failCount = validationRows.filter((row) => row.Status === 'FAIL').length;

  const summaryRows = [{
    'Generated At': new Date().toISOString(),
    'Total Sheet Fasttracks Validated': validationRows.length,
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

export function writeFasttrackReportExcel(reportData, outputPath) {
  const workbook = XLSX.utils.book_new();

  const sheets = [
    ['Summary', reportData.summaryRows],
    ['Fasttrack Validation', reportData.validationRows],
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

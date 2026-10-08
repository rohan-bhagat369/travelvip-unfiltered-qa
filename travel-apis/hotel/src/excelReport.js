import XLSX from 'xlsx';

const EXCEL_CELL_LIMIT = 32000;

function cellText(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= EXCEL_CELL_LIMIT) return text;
  return `${text.slice(0, EXCEL_CELL_LIMIT)}\n...[truncated]`;
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

export function buildExcelWorkbook(report) {
  const workbook = XLSX.utils.book_new();

  const summaryRows = [{
    Suite: report.suite || 'Hotel API Tests',
    'Started At': report.startedAt,
    'Finished At': report.finishedAt,
    Total: report.summary?.total ?? 0,
    Passed: report.summary?.passed ?? 0,
    Failed: report.summary?.failed ?? 0,
    Skipped: report.summary?.skipped ?? 0,
  }];
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = autoWidth(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  const testRows = (report.testCases || []).map((tc) => ({
    'Test Case': tc.name,
    Status: tc.status,
    'Started At': tc.startedAt,
    'Ended At': tc.endedAt,
    'Duration (ms)': tc.startedAt && tc.endedAt
      ? new Date(tc.endedAt) - new Date(tc.startedAt)
      : '',
    Error: tc.error || '',
    'API Calls': tc.apiCalls?.length ?? 0,
  }));
  const testSheet = XLSX.utils.json_to_sheet(testRows.length ? testRows : [{ 'Test Case': 'No tests recorded' }]);
  testSheet['!cols'] = autoWidth(testRows.length ? testRows : [{ 'Test Case': '' }]);
  XLSX.utils.book_append_sheet(workbook, testSheet, 'Test Cases');

  const apiRows = [];
  for (const tc of report.testCases || []) {
    (tc.apiCalls || []).forEach((api, index) => {
      apiRows.push({
        'Test Case': tc.name,
        'Test Status': tc.status,
        '#': index + 1,
        Timestamp: api.timestamp,
        Method: api.method,
        Path: api.path,
        URL: api.url,
        'HTTP Status': api.status,
        OK: api.ok ? 'YES' : 'NO',
        'Request Headers': cellText(api.requestHeaders),
        'Request Body': cellText(api.requestBody),
        'Response Body': cellText(api.responseBody),
      });
    });
  }

  const apiSheet = XLSX.utils.json_to_sheet(
    apiRows.length ? apiRows : [{ 'Test Case': 'No API calls recorded' }],
  );
  apiSheet['!cols'] = autoWidth(apiRows.length ? apiRows : [{ 'Test Case': '' }]);
  XLSX.utils.book_append_sheet(workbook, apiSheet, 'API Details');

  return workbook;
}

export function writeExcelReport(report, outputPath) {
  const workbook = buildExcelWorkbook(report);
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}

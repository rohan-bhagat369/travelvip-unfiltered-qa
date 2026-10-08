import fs from 'fs';
import path from 'path';
import { writeExcelReport } from './excelReport.js';

const REPORT_DIR = path.resolve('reports/flight');

function truncate(value, max = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} chars]`;
}

function sanitizeHeaders(headers = {}) {
  const copy = { ...headers };
  if (copy.Authorization) copy.Authorization = 'Bearer ***';
  if (copy['X-Signature']) copy['X-Signature'] = '***';
  if (copy['X-Partner-Key']) copy['X-Partner-Key'] = '***';
  return copy;
}

class FlightReporter {
  constructor() {
    this.reset();
  }

  reset() {
    this.suite = '';
    this.startedAt = new Date().toISOString();
    this.testCases = [];
    this.currentTest = null;
  }

  setSuite(name) {
    this.suite = name;
  }

  startTest(name) {
    this.currentTest = {
      name,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      endedAt: null,
      error: null,
      apiCalls: [],
    };
  }

  endTest(status, error = null) {
    if (!this.currentTest) return;
    this.currentTest.status = status;
    this.currentTest.endedAt = new Date().toISOString();
    this.currentTest.error = error ? String(error.message || error) : null;
    this.testCases.push(this.currentTest);
    this.currentTest = null;
  }

  logApi(entry) {
    if (!this.currentTest) return;
    this.currentTest.apiCalls.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  buildSummary() {
    const passed = this.testCases.filter((t) => t.status === 'PASSED').length;
    const failed = this.testCases.filter((t) => t.status === 'FAILED').length;
    const skipped = this.testCases.filter((t) => t.status === 'SKIPPED').length;
    return { total: this.testCases.length, passed, failed, skipped };
  }

  toJSON() {
    return {
      suite: this.suite,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      summary: this.buildSummary(),
      testCases: this.testCases,
    };
  }

  toHtml() {
    const report = this.toJSON();
    const rows = report.testCases.map((tc) => {
      const apis = tc.apiCalls.map((api, i) => `
        <details class="api-call">
          <summary>${i + 1}. ${api.method} ${api.path} — HTTP ${api.status} ${api.ok ? '✓' : '✗'}</summary>
          <h4>Request</h4>
          <pre>${truncate({ url: api.url, headers: api.requestHeaders, body: api.requestBody }, 4000)}</pre>
          <h4>Response</h4>
          <pre>${truncate(api.responseBody, 4000)}</pre>
        </details>
      `).join('');

      return `
        <section class="test-case ${tc.status.toLowerCase()}">
          <h3>${tc.status === 'PASSED' ? '✅' : tc.status === 'FAILED' ? '❌' : '⏭️'} ${tc.name}</h3>
          <p><strong>Status:</strong> ${tc.status} | <strong>APIs:</strong> ${tc.apiCalls.length}</p>
          ${tc.error ? `<p class="error"><strong>Error:</strong> ${tc.error}</p>` : ''}
          ${apis || '<p><em>No API calls recorded</em></p>'}
        </section>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Flight API Report</title>
<style>
  body { font-family:Segoe UI,Arial,sans-serif; margin:24px; background:#f5f7fb; }
  h1,h2 { color:#1a2b4a; }
  .summary { display:flex; gap:16px; margin-bottom:24px; }
  .card { background:#fff; padding:16px 20px; border-radius:8px; box-shadow:0 1px 4px #0001; }
  .test-case { background:#fff; margin:16px 0; padding:16px; border-radius:8px; border-left:4px solid #ccc; }
  .test-case.passed { border-left-color:#22c55e; }
  .test-case.failed { border-left-color:#ef4444; }
  .error { color:#b91c1c; }
  pre { background:#0f172a; color:#e2e8f0; padding:12px; border-radius:6px; overflow:auto; font-size:12px; }
  details { margin:8px 0; }
  summary { cursor:pointer; font-weight:600; }
</style></head><body>
  <h1>Flight API Test Report</h1>
  <p><strong>Suite:</strong> ${report.suite || 'Flight'} | <strong>Generated:</strong> ${report.finishedAt}</p>
  <div class="summary">
    <div class="card"><strong>Total</strong><br>${report.summary.total}</div>
    <div class="card"><strong>Passed</strong><br>${report.summary.passed}</div>
    <div class="card"><strong>Failed</strong><br>${report.summary.failed}</div>
    <div class="card"><strong>Skipped</strong><br>${report.summary.skipped}</div>
  </div>
  ${rows}
</body></html>`;
  }

  writeReports() {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const report = this.toJSON();

    const jsonPath = path.join(REPORT_DIR, `flight-report-${stamp}.json`);
    const htmlPath = path.join(REPORT_DIR, `flight-report-${stamp}.html`);
    const excelPath = path.join(REPORT_DIR, `flight-report-${stamp}.xlsx`);
    const latestJson = path.join(REPORT_DIR, 'latest-report.json');
    const latestHtml = path.join(REPORT_DIR, 'latest-report.html');
    const latestExcel = path.join(REPORT_DIR, 'latest-report.xlsx');

    const json = JSON.stringify(report, null, 2);
    const html = this.toHtml();

    fs.writeFileSync(jsonPath, json);
    fs.writeFileSync(htmlPath, html);
    fs.writeFileSync(latestJson, json);
    fs.writeFileSync(latestHtml, html);

    writeExcelReport(report, excelPath);
    writeExcelReport(report, latestExcel);

    return { jsonPath, htmlPath, excelPath, latestJson, latestHtml, latestExcel };
  }
}

export const flightReporter = new FlightReporter();

export function createApiLogEntry({
  method, path: apiPath, query, body, headers, status, ok, data, url,
}) {
  return {
    method,
    path: apiPath,
    url,
    requestHeaders: sanitizeHeaders(headers),
    requestBody: body,
    status,
    ok,
    responseBody: data,
  };
}

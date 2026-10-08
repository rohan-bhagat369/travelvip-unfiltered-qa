import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { tally, writeJson } from './report.js';

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

function mdCell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function htmlEsc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bugsOf(rows) {
  return (rows || []).filter((r) => r.status === 'BUG');
}

function notTestedOf(rows) {
  return (rows || []).filter((r) => r.status === 'NOT TESTED' || r.status === 'NOT_TESTED');
}

function tagsOf(rows) {
  return [...new Set((rows || []).map((r) => r.tag))];
}

export function enrichReport(report) {
  const rows = report.rows || [];
  const score = report.score || tally(rows);
  const bugs = bugsOf(rows).map((r, i) => ({
    n: i + 1,
    tag: r.tag,
    id: r.id,
    rule: r.rule,
    how: r.how,
    expected: r.expected,
    actual: r.actual,
    note: r.note || '',
    responseSnippet: r.responseSnippet || null,
  }));
  return { ...report, score, bugs, notTested: notTestedOf(rows) };
}

export function toMarkdown(report) {
  const r = enrichReport(report);
  const { score, rows = [] } = r;
  const title = r.suite || 'Hotel B2B regression';
  const lines = [];
  lines.push(`# ${title} — ${r.baseUrl || ''}`);
  lines.push('');
  lines.push(`**For:** Partner B2B APIs (pre-deploy)`);
  lines.push(`**QA:** TravelVIP API Automation`);
  lines.push(`**Ran at:** ${r.ranAt || ''}`);
  lines.push(`**Tags:** ${(r.tags || []).join(', ')}`);
  if (r.stoppedOn) lines.push(`**Stopped on:** ${r.stoppedOn} (fail-fast)`);
  lines.push('');
  lines.push('## Score');
  lines.push('');
  lines.push('| PASS | BUG | NOT TESTED | Total |');
  lines.push('|-----:|----:|-----------:|------:|');
  lines.push(`| ${score.PASS} | ${score.BUG} | ${score['NOT TESTED']} | ${score.total} |`);
  lines.push('');
  lines.push('| Tag | PASS | BUG | NOT TESTED | Total |');
  lines.push('|-----|-----:|----:|-----------:|------:|');
  for (const tag of tagsOf(rows)) {
    const t = tally(rows.filter((x) => x.tag === tag));
    lines.push(`| ${tag} | ${t.PASS} | ${t.BUG} | ${t['NOT TESTED']} | ${t.total} |`);
  }
  lines.push('');
  lines.push('## Environment');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Base URL | \`${r.baseUrl || ''}\` |`);
  lines.push(`| Correlation ID | \`${r.correlationId || ''}\` |`);
  lines.push(`| Booking BR | \`${r.bookingRefId || '—'}\` |`);
  lines.push(`| Booking status | ${r.bookingStatus || '—'} |`);
  lines.push(`| Elapsed | ${r.elapsedMs != null ? `${r.elapsedMs} ms` : '—'} |`);
  lines.push('');

  for (const tag of tagsOf(rows)) {
    const list = rows.filter((x) => x.tag === tag);
    const t = tally(list);
    lines.push(`## ${tag}`);
    lines.push('');
    lines.push(`Score: PASS **${t.PASS}** / BUG **${t.BUG}** / NOT TESTED **${t['NOT TESTED']}**`);
    lines.push('');
    lines.push('| # | Rule | How tested | Status |');
    lines.push('|---|------|------------|--------|');
    list.forEach((row, i) => {
      lines.push(`| ${i + 1} | ${mdCell(row.rule)} | ${mdCell(row.how)} | **${row.status}** |`);
    });
    lines.push('');
  }

  lines.push('## Bugs for Dev');
  lines.push('');
  if (!r.bugs.length) {
    lines.push('None this run.');
    lines.push('');
  } else {
    for (const b of r.bugs) {
      lines.push(`### BUG ${b.n} — ${b.tag}.${b.id} ${b.rule}`);
      lines.push('');
      lines.push(`| | |`);
      lines.push(`|---|---|`);
      lines.push(`| How tested | ${mdCell(b.how)} |`);
      lines.push(`| Expected | ${mdCell(b.expected)} |`);
      lines.push(`| Actual | ${mdCell(b.actual)} |`);
      if (b.note) lines.push(`| Note | ${mdCell(b.note)} |`);
      lines.push('');
      if (b.responseSnippet) {
        lines.push('```json');
        lines.push(typeof b.responseSnippet === 'string' ? b.responseSnippet : JSON.stringify(b.responseSnippet, null, 2));
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (r.notTested.length) {
    lines.push('## Not tested');
    lines.push('');
    lines.push('| # | Tag | Rule | Why |');
    lines.push('|---|-----|------|-----|');
    r.notTested.forEach((row, i) => {
      lines.push(`| ${i + 1} | ${row.tag} | ${mdCell(row.rule)} | ${mdCell(row.actual || row.note)} |`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function toHtml(report) {
  const r = enrichReport(report);
  const { score, rows = [] } = r;
  const tagTables = tagsOf(rows).map((tag) => {
    const list = rows.filter((x) => x.tag === tag);
    const t = tally(list);
    const tr = list.map((row, i) => `
      <tr class="${String(row.status).replace(/\s+/g, '-').toLowerCase()}">
        <td>${i + 1}</td>
        <td>${htmlEsc(row.rule)}</td>
        <td>${htmlEsc(row.how)}</td>
        <td>${htmlEsc(row.expected)}</td>
        <td>${htmlEsc(row.actual)}</td>
        <td><strong>${htmlEsc(row.status)}</strong></td>
      </tr>`).join('');
    return `<h2>${htmlEsc(tag)} <small>${t.PASS} PASS / ${t.BUG} BUG / ${t['NOT TESTED']} NT</small></h2>
      <table>
        <thead><tr><th>#</th><th>Rule</th><th>How tested</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>
        <tbody>${tr}</tbody>
      </table>`;
  }).join('');

  const bugBlocks = r.bugs.length
    ? r.bugs.map((b) => `
      <section class="bug">
        <h3>BUG ${b.n} — ${htmlEsc(b.tag)}.${htmlEsc(b.id)} ${htmlEsc(b.rule)}</h3>
        <p><strong>How:</strong> ${htmlEsc(b.how)}</p>
        <p><strong>Expected:</strong> ${htmlEsc(b.expected)}</p>
        <p><strong>Actual:</strong> ${htmlEsc(b.actual)}</p>
        ${b.responseSnippet ? `<pre>${htmlEsc(typeof b.responseSnippet === 'string' ? b.responseSnippet : JSON.stringify(b.responseSnippet, null, 2))}</pre>` : ''}
      </section>`).join('')
    : '<p>None this run.</p>';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${htmlEsc(r.suite || 'Hotel B2B regression')}</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; background: #f5f7fb; color: #1a2b4a; }
  h1,h2,h3 { color: #1a2b4a; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0 24px; }
  .card { background: #fff; padding: 14px 18px; border-radius: 8px; box-shadow: 0 1px 4px #0001; min-width: 110px; }
  .card.bug { border-top: 4px solid #ef4444; }
  .card.pass { border-top: 4px solid #22c55e; }
  .card.nt { border-top: 4px solid #94a3b8; }
  table { border-collapse: collapse; width: 100%; background: #fff; margin: 8px 0 24px; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; font-size: 13px; vertical-align: top; }
  th { background: #1a2b4a; color: #fff; }
  tr.pass { background: #f0fdf4; }
  tr.bug { background: #fef2f2; }
  tr.not-tested { background: #f8fafc; }
  .bug { background: #fff; padding: 16px; border-left: 4px solid #ef4444; margin: 12px 0; border-radius: 6px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow: auto; font-size: 12px; }
  small { color: #64748b; font-weight: 400; }
</style></head><body>
  <h1>${htmlEsc(r.suite || 'Hotel B2B regression')}</h1>
  <p>${htmlEsc(r.baseUrl)} · ${htmlEsc(r.ranAt)} · tags ${htmlEsc((r.tags || []).join(', '))}</p>
  <div class="cards">
    <div class="card pass"><strong>PASS</strong><br>${score.PASS}</div>
    <div class="card bug"><strong>BUG</strong><br>${score.BUG}</div>
    <div class="card nt"><strong>NOT TESTED</strong><br>${score['NOT TESTED']}</div>
    <div class="card"><strong>Total</strong><br>${score.total}</div>
  </div>
  <p>Correlation <code>${htmlEsc(r.correlationId)}</code>
     · BR <code>${htmlEsc(r.bookingRefId || '—')}</code>
     · status ${htmlEsc(r.bookingStatus || '—')}</p>
  ${tagTables}
  <h2>Bugs for Dev</h2>
  ${bugBlocks}
</body></html>`;
}

export function writeExcel(report, outputPath) {
  const r = enrichReport(report);
  const rows = r.rows || [];
  const workbook = XLSX.utils.book_new();

  const summaryRows = [{
    Suite: r.suite || 'Hotel B2B regression',
    BaseURL: r.baseUrl || '',
    RanAt: r.ranAt || '',
    Tags: (r.tags || []).join(', '),
    CorrelationId: r.correlationId || '',
    BookingRefId: r.bookingRefId || '',
    BookingStatus: r.bookingStatus || '',
    PASS: r.score.PASS,
    BUG: r.score.BUG,
    'NOT TESTED': r.score['NOT TESTED'],
    Total: r.score.total,
    ElapsedMs: r.elapsedMs ?? '',
    StoppedOn: r.stoppedOn || '',
  }];
  const tagRows = tagsOf(rows).map((tag) => {
    const t = tally(rows.filter((x) => x.tag === tag));
    return { Tag: tag, PASS: t.PASS, BUG: t.BUG, 'NOT TESTED': t['NOT TESTED'], Total: t.total };
  });

  const resultRows = [];
  for (const tag of tagsOf(rows)) {
    rows.filter((x) => x.tag === tag).forEach((row, i) => {
      resultRows.push({
        Tag: tag,
        '#': i + 1,
        Id: row.id,
        Rule: row.rule,
        'How tested': row.how,
        Expected: row.expected,
        Actual: cellText(row.actual),
        Status: row.status,
        Note: row.note || '',
      });
    });
  }

  const bugRows = r.bugs.length
    ? r.bugs.map((b) => ({
      n: b.n,
      Tag: b.tag,
      Id: b.id,
      Rule: b.rule,
      'How tested': b.how,
      Expected: b.expected,
      Actual: cellText(b.actual),
      Note: b.note || '',
      Snippet: cellText(b.responseSnippet),
    }))
    : [{ n: '', Rule: 'None this run' }];

  const hopRows = (r.hops || []).map((h, i) => ({
    '#': i + 1,
    Step: h.step,
    Path: h.path,
    HTTP: h.http,
    OK: h.ok ? 'YES' : 'NO',
    SentCorrelationId: h.sentCorrelationId || '',
    ResponseCorrelationId: h.responseCorrelationId || '',
    SentPinned: h.sentPinned ? 'YES' : 'NO',
    EchoMatch: h.responseMatchesPinned == null ? '' : (h.responseMatchesPinned ? 'YES' : 'NO'),
    ErrorCode: h.errorCode || '',
  }));

  const sheets = [
    ['Score', summaryRows],
    ['By tag', tagRows.length ? tagRows : [{ Tag: 'none' }]],
    ['Results', resultRows.length ? resultRows : [{ Rule: 'No rows' }]],
    ['Bugs for Dev', bugRows],
    ['Hops', hopRows.length ? hopRows : [{ Step: 'No hops (listing/validate spawn only)' }]],
  ];
  for (const [name, data] of sheets) {
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = autoWidth(data);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}

export function writeRegressionReports(report, jsonPath, { latestFolder = 'hotel-regression' } = {}) {
  const full = enrichReport(report);
  const md = toMarkdown(full);
  const html = toHtml(full);
  const base = jsonPath.replace(/\.json$/i, '');
  const mdPath = `${base}.md`;
  const htmlPath = `${base}.html`;
  const xlsxPath = `${base}.xlsx`;

  writeJson(jsonPath, full);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(htmlPath, html);
  writeExcel(full, xlsxPath);

  const latestDir = path.join(path.dirname(jsonPath), latestFolder);
  fs.mkdirSync(latestDir, { recursive: true });
  const latest = {
    json: path.join(latestDir, 'latest.json'),
    md: path.join(latestDir, 'latest.md'),
    html: path.join(latestDir, 'latest.html'),
    xlsx: path.join(latestDir, 'latest.xlsx'),
  };
  fs.copyFileSync(jsonPath, latest.json);
  fs.copyFileSync(mdPath, latest.md);
  fs.copyFileSync(htmlPath, latest.html);
  fs.copyFileSync(xlsxPath, latest.xlsx);

  return { jsonPath, mdPath, htmlPath, xlsxPath, latest };
}

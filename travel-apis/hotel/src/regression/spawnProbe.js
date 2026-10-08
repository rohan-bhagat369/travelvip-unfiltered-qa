import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export function spawnNode(scriptRel, extraEnv = {}, { cwd } = {}) {
  const root = cwd || process.cwd();
  const script = path.isAbsolute(scriptRel) ? scriptRel : path.join(root, scriptRel);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function normalizeStatus(status) {
  const s = String(status || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (s === 'FAIL' || s === 'FAILED') return 'BUG';
  if (s === 'INFO' || s === 'SKIP' || s === 'SKIPPED') return 'NOT TESTED';
  if (s === 'NOT_TESTED') return 'NOT TESTED';
  return status || 'NOT TESTED';
}

function isRescheduleRow(r) {
  const blob = `${r.rule || ''} ${r.title || ''} ${r.area || ''} ${r.code || ''} ${r.section || ''}`;
  return /reschedul/i.test(blob);
}

export function mergeRowsFromReport(filePath, tag, { skipReschedule = true, skipInfo = true } = {}) {
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = data.rows || [];
  return rows
    .filter((r) => {
      if (skipReschedule && isRescheduleRow(r)) return false;
      if (skipInfo && String(r.status || '').toUpperCase() === 'INFO') return false;
      return true;
    })
    .map((r, i) => ({
      tag,
      section: r.section || r.area || tag,
      id: r.caseId || r.id || r.n || i + 1,
      rule: r.caseId || r.rule || r.title || r.field || r.code || `${tag}.${i + 1}`,
      how: r.how || r.expectedDetailHint || (r.input != null ? `input=${r.input}` : '') || r.note || '',
      expected: r.expected || r.expectedDetailHint || (r.expectedHttp != null ? `HTTP ${r.expectedHttp}` : '') || '',
      actual: r.actual || r.note || (r.snippet ? String(r.snippet).slice(0, 280) : '') || `HTTP ${r.http ?? ''} ${r.code || ''}`,
      status: normalizeStatus(r.status),
      note: r.note || '',
      responseSnippet: r.responseSnippet || r.snippet || null,
      sourceReport: path.basename(filePath),
    }));
}

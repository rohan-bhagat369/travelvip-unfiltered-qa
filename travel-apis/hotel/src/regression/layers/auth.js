import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../spawnProbe.js';
import { row } from '../report.js';

export async function runAuth(cwd) {
  const outName = process.env.AUTH_VAL_OUT || 'auth-payload-validations.json';
  const code = await spawnNode('travel-apis/flight/scripts/probe-auth-payload-validations.js', {
    AUTH_VAL_OUT: outName,
  }, { cwd });

  const filePath = path.join(cwd, 'reports', outName);
  const merged = mergeRowsFromReport(filePath, 'AUTH');
  if (merged.length) return merged;

  return [row(
    'AUTH', 'auth', 1, 'Auth payload validations spawn',
    'travel-apis/flight/scripts/probe-auth-payload-validations.js (token, refresh, user session)',
    'JSON report with AT/RT/UA rows',
    `exit=${code} missing ${outName}`,
    'BUG',
  )];
}

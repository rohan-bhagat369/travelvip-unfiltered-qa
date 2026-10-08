import path from 'path';
import { spawnNode, mergeRowsFromReport } from '../../../hotel/regression/spawnProbe.js';
import { row } from '../../../hotel/regression/report.js';

export async function runValidate(cwd) {
  const rows = [];
  const outName = process.env.FLIGHT_ISSUE_VAL_OUT || 'flight-regression-issue-validations.json';
  const issueCode = await spawnNode('travel-apis/flight/scripts/probe-flight-issue-payload-validations.js', {
    FLIGHT_ISSUE_VAL_OUT: outName,
    SKIP_RESCHEDULE: '1',
  }, { cwd });
  const issueMerged = mergeRowsFromReport(path.join(cwd, 'reports', outName), 'VALIDATE');
  if (issueMerged.length) rows.push(...issueMerged);
  else {
    rows.push(row(
      'VALIDATE', 'issue', 1, 'Issue-ticket payload validations spawn',
      'travel-apis/flight/scripts/probe-flight-issue-payload-validations.js SKIP_RESCHEDULE=1',
      'JSON report with T/D/C/G/P/PF/X rows',
      `exit=${issueCode} missing ${outName}`,
      'BUG',
    ));
  }

  const hopOut = process.env.FLIGHT_SEARCH_HOP_VAL_OUT || 'flight-regression-search-hop-validations.json';
  const hopCode = await spawnNode('travel-apis/flight/scripts/probe-flight-search-hop-validations.js', {
    FLIGHT_SEARCH_HOP_VAL_OUT: hopOut,
  }, { cwd });
  const hopMerged = mergeRowsFromReport(path.join(cwd, 'reports', hopOut), 'VALIDATE');
  if (hopMerged.length) rows.push(...hopMerged);
  else {
    rows.push(row(
      'VALIDATE', 'hops', 1, 'Search/details/pricing/SSR/seatmap validations spawn',
      'travel-apis/flight/scripts/probe-flight-search-hop-validations.js',
      'JSON report with S/H/D/P/SSR/SM rows',
      `exit=${hopCode} missing ${hopOut}`,
      'BUG',
    ));
  }

  return rows;
}

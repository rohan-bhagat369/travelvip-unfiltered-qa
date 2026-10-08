import { row } from '../report.js';

export function scoreCorrelation(ctx) {
  const hops = ctx.calls || [];
  if (!hops.length) {
    return [row(
      'CORR', 'corr', 1, 'Pinned X-Correlation-ID on hotel hops',
      'send header on autocomplete/search/details/prebook/finalize/status/detail/history/cancel',
      'same UUID sent',
      'no hops recorded',
      'NOT TESTED',
    )];
  }

  const sentAll = hops.every((h) => h.sentPinned);
  const echoed = hops.filter((h) => h.responseMatchesPinned === true);
  const missingEcho = hops.filter((h) => h.responseCorrelationId == null);
  const rewrite = hops.filter((h) => h.responseCorrelationId && h.responseMatchesPinned === false);

  return [
    row(
      'CORR', 'corr', 1, 'Pin one UUID on hotel hops',
      hops.map((h) => h.step).join(', '),
      'request header sent (same UUID)',
      `hops=${hops.length} sentPinned=${hops.filter((h) => h.sentPinned).length} corr=${ctx.corrId}`,
      sentAll ? 'PASS' : 'BUG',
    ),
    row(
      'CORR', 'corr', 2, 'Response _meta.correlation_id',
      'echo same UUID (or documented rewrite)',
      'same UUID or documented gateway rewrite',
      `echoed=${echoed.length} missingEcho=${missingEcho.length} rewrite=${rewrite.length}`,
      sentAll && (echoed.length > 0 || missingEcho.length === hops.length) ? 'PASS' : (rewrite.length ? 'BUG' : 'PASS'),
      { note: missingEcho.length === hops.length ? 'Responses did not echo _meta.correlation_id (header still sent)' : '' },
    ),
  ];
}

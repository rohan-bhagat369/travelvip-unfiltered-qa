import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { FlightService } from '../service.js';

export async function openFlightSession() {
  if (!process.env.TIER_ID || String(process.env.TIER_ID).trim() === '') {
    process.env.TIER_ID = '10546901';
  }
  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  process.env.FLIGHT_ISSUE_PID = process.env.FLIGHT_ISSUE_PID || 'vgm';

  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  if (session.accessToken) session.client.setPartnerKey(session.accessToken);
  return {
    client: session.client,
    flight: new FlightService(session.client),
    corrId: process.env.CORRELATION_ID,
    calls: [],
  };
}

export function findRiyaHits(data, root = '$') {
  const hits = [];
  const walk = (node, p) => {
    if (node == null) return;
    if (typeof node === 'string') {
      if (/riya/i.test(node)) hits.push(p);
      return;
    }
    if (typeof node === 'number' || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${p}[${i}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (/riya/i.test(k)) hits.push(`${p}.${k}`);
        walk(v, `${p}.${k}`);
      }
    }
  };
  walk(data, root);
  return hits;
}

export function noteCall(ctx, step, path, res) {
  const rec = {
    step,
    path,
    http: res?.status ?? null,
    ok: Boolean(res?.ok),
    sentCorrelationId: res?.sentCorrelationId || ctx.corrId,
    responseCorrelationId: res?.data?._meta?.correlation_id || null,
  };
  rec.sentPinned = rec.sentCorrelationId === ctx.corrId;
  rec.responseMatchesPinned = rec.responseCorrelationId
    ? rec.responseCorrelationId === ctx.corrId
    : null;
  rec.errorCode = res?.data?.error?.code || res?.data?.code || null;
  const riya = findRiyaHits(res?.data, `$.${step}`);
  if (riya.length) {
    rec.riyaHits = riya.slice(0, 8);
    ctx.riyaHits = ctx.riyaHits || [];
    ctx.riyaHits.push({ step, path, hits: rec.riyaHits });
  }
  ctx.calls.push(rec);
  return rec;
}

export function scoreRiyaLeak(ctx) {
  const hits = ctx.riyaHits || [];
  const sample = hits.slice(0, 6).map((h) => `${h.step}:${h.hits.slice(0, 2).join('|')}`).join('; ');
  return {
    tag: 'E2E',
    section: 'vendor',
    id: 2,
    rule: 'No Riya in any API response',
    how: 'scan every captured flight response body (fareRules, search, issue, status, cancel, …)',
    expected: 'no "riya" in keys or string values',
    actual: hits.length ? sample : 'none',
    status: hits.length ? 'BUG' : 'PASS',
  };
}

export function uniqueEmail(prefix = 'flight.reg') {
  return `${prefix}.${Date.now()}@travelvip.ai`;
}

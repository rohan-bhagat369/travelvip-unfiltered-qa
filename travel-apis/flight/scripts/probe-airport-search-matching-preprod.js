/**
 * Preprod — Airport Search matching fix.
 * GET /v1/flights/airports?airport=...
 * NO flight search / book — catalog only.
 *
 * Positive: partial names, typos, multi-word, IATA, case.
 * Negative: empty, whitespace, nonsense, punctuation, HTML — never 500.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';

const OUT = path.join('reports', process.env.REPORT_OUT || 'airport-search-matching-preprod.json');

function hitsOf(data) {
  const list = data?.result || data?.content || data?.airports || data?.results || [];
  return Array.isArray(list) ? list : [];
}

function brief(h) {
  return {
    airportCode: h.airportCode || h.code || h.iata || null,
    airportName: h.airportName || h.name || null,
    city: h.city || h.cityName || null,
    country: h.country || null,
  };
}

function rankOf(hits, code) {
  const want = String(code).toUpperCase();
  const i = hits.findIndex((h) => String(h.airportCode || h.code || h.iata || '').toUpperCase() === want);
  return i < 0 ? null : i + 1;
}

function includesCity(hits, re) {
  return hits.some((h) => re.test(`${h.city || ''} ${h.airportName || ''} ${h.airportCode || ''}`));
}

async function main() {
  console.log('=== Airport Search matching PREPROD (catalog only, no book) ===');
  console.log('BASE', process.env.BASE_URL);

  if (!process.env.CORRELATION_ID) process.env.CORRELATION_ID = randomUUID();
  clearSession();
  const session = await authenticate(true);
  session.client.setCorrelationId(process.env.CORRELATION_ID);
  const flight = new FlightService(session.client);

  const rows = [];
  const counts = { PASS: 0, BUG: 0, NOT_TESTED: 0 };
  let n = 0;

  const add = (section, rule, how, expected, status, actual, extra = {}) => {
    n += 1;
    const row = { section, id: n, rule, how, expected, status, actual, ...extra };
    rows.push(row);
    counts[status] = (counts[status] || 0) + 1;
    console.log(`[${status}] ${section}.${n} ${rule} — ${actual}`);
    return row;
  };

  async function call(q) {
    const res = await flight.airportSearch(q);
    const hits = hitsOf(res.data).map(brief);
    return {
      http: res.status,
      ok: res.ok,
      total: res.data?.totalResults ?? hits.length,
      hits,
      error: res.data?.error || null,
      rawStatus: res.data?.status,
    };
  }

  // ---------- POSITIVE ----------
  const positives = [
    {
      q: 'amrit',
      rule: 'Partial city → Amritsar (ATQ)',
      expectCode: 'ATQ',
      expectCity: /amritsar/i,
      maxRank: 1,
    },
    {
      q: 'mumb',
      rule: 'Partial city → Mumbai (BOM)',
      expectCode: 'BOM',
      expectCity: /mumbai/i,
      maxRank: 2,
    },
    {
      q: 'amritsr',
      rule: 'Typo amritsr → Amritsar (ATQ)',
      expectCode: 'ATQ',
      expectCity: /amritsar/i,
      maxRank: 1,
    },
    {
      q: 'ahmedbad',
      rule: 'Typo ahmedbad → Ahmedabad (AMD)',
      expectCode: 'AMD',
      expectCity: /ahmedabad/i,
      maxRank: 1,
    },
    {
      q: 'new delhi',
      rule: 'Multi-word new delhi → DEL',
      expectCode: 'DEL',
      expectCity: /delhi/i,
      maxRank: 1,
    },
    {
      q: 'delhi',
      rule: 'Full city delhi → DEL',
      expectCode: 'DEL',
      expectCity: /delhi/i,
      maxRank: 1,
    },
    {
      q: 'BOM',
      rule: 'Exact IATA BOM → Mumbai',
      expectCode: 'BOM',
      expectCity: /mumbai/i,
      maxRank: 1,
    },
    {
      q: 'ATQ',
      rule: 'Exact IATA ATQ → Amritsar',
      expectCode: 'ATQ',
      expectCity: /amritsar/i,
      maxRank: 1,
    },
    {
      q: 'AMD',
      rule: 'Exact IATA AMD → Ahmedabad',
      expectCode: 'AMD',
      expectCity: /ahmedabad/i,
      maxRank: 1,
    },
    {
      q: 'DEL',
      rule: 'Exact IATA DEL → New Delhi',
      expectCode: 'DEL',
      expectCity: /delhi/i,
      maxRank: 1,
    },
    {
      q: 'AMRIT',
      rule: 'Case-insensitive AMRIT → ATQ',
      expectCode: 'ATQ',
      maxRank: 1,
    },
    {
      q: 'MuMb',
      rule: 'Mixed case MuMb → BOM',
      expectCode: 'BOM',
      maxRank: 2,
    },
    {
      q: 'bangalor',
      rule: 'Partial/typo bangalor → BLR',
      expectCode: 'BLR',
      expectCity: /bengaluru|bangalore/i,
      maxRank: 2,
    },
    {
      q: 'chenn',
      rule: 'Partial chenn → MAA Chennai',
      expectCode: 'MAA',
      expectCity: /chennai/i,
      maxRank: 2,
    },
    {
      q: 'hyderab',
      rule: 'Partial hyderab → HYD',
      expectCode: 'HYD',
      expectCity: /hyderabad/i,
      maxRank: 2,
    },
    {
      q: 'new york',
      rule: 'Multi-word new york → NYC (or JFK/EWR/LGA in top)',
      expectAnyCode: ['NYC', 'JFK', 'EWR', 'LGA'],
      maxRank: 3,
    },
  ];

  for (const t of positives) {
    const r = await call(t.q);
    const how = `GET /v1/flights/airports?airport=${encodeURIComponent(t.q)}`;
    if (r.http >= 500) {
      add('POS', t.rule, how, 'HTTP 200 with expected airport', 'BUG', `HTTP ${r.http}`, { query: t.q, hits: r.hits.slice(0, 5) });
      continue;
    }
    if (r.http !== 200 || r.hits.length === 0) {
      add('POS', t.rule, how, 'HTTP 200 with expected airport', 'BUG', `HTTP ${r.http} n=${r.hits.length}`, {
        query: t.q,
        hits: r.hits.slice(0, 5),
        error: r.error,
      });
      continue;
    }

    let ok = true;
    let detail = '';
    if (t.expectCode) {
      const rank = rankOf(r.hits, t.expectCode);
      ok = rank != null && rank <= (t.maxRank || 3);
      detail = `rank(${t.expectCode})=${rank}`;
      if (t.expectCity && !includesCity(r.hits.slice(0, t.maxRank || 3), t.expectCity)) {
        ok = false;
        detail += ' cityMismatch';
      }
    } else if (t.expectAnyCode) {
      const ranks = t.expectAnyCode.map((c) => ({ c, rank: rankOf(r.hits, c) })).filter((x) => x.rank != null);
      const best = ranks.sort((a, b) => a.rank - b.rank)[0];
      ok = best && best.rank <= (t.maxRank || 3);
      detail = best ? `best=${best.c}@${best.rank}` : 'none of expected codes';
    }

    add(
      'POS',
      t.rule,
      how,
      `HTTP 200; expected code in top ${t.maxRank || 3}`,
      ok ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} ${detail} top=${r.hits.slice(0, 5).map((h) => `${h.airportCode}:${h.city}`).join(' | ')}`,
      { query: t.q, hits: r.hits.slice(0, 8) },
    );
  }

  // ---------- NEGATIVE ----------
  const negatives = [
    {
      q: '',
      rule: 'Empty airport query rejected',
      expect: 'HTTP 4xx (VALIDATION) never 500',
      check: (r) => r.http >= 400 && r.http < 500,
    },
    {
      q: '   ',
      rule: 'Whitespace-only query → empty or 4xx, never 500',
      expect: 'HTTP 4xx or 200 with 0 hits',
      check: (r) => (r.http >= 400 && r.http < 500) || (r.http === 200 && r.hits.length === 0),
    },
    {
      q: 'zzzzxxx',
      rule: 'Nonsense zzzzxxx → no airports',
      expect: 'HTTP 200 empty (or 4xx), never 500',
      check: (r) => (r.http === 200 && r.hits.length === 0) || (r.http >= 400 && r.http < 500),
    },
    {
      q: 'xyzzy123',
      rule: 'Nonsense xyzzy123 → no airports',
      expect: 'HTTP 200 empty (or 4xx), never 500',
      check: (r) => (r.http === 200 && r.hits.length === 0) || (r.http >= 400 && r.http < 500),
    },
    {
      q: 'qqqqqqqq',
      rule: 'Nonsense qqqqqqqq → no airports',
      expect: 'HTTP 200 empty (or 4xx), never 500',
      check: (r) => (r.http === 200 && r.hits.length === 0) || (r.http >= 400 && r.http < 500),
    },
    {
      q: '!@#$',
      rule: 'Punctuation-only !@#$ → 4xx or empty, never 500 / invented hits',
      expect: 'HTTP 4xx or 200 with 0 hits (never 500)',
      check: (r) => {
        if (r.http >= 500) return false;
        if (r.http >= 400 && r.http < 500) return true;
        return r.http === 200 && r.hits.length === 0;
      },
    },
    {
      q: '<script>',
      rule: 'HTML <script> → 4xx or empty, never 500 / invented hits',
      expect: 'HTTP 4xx or 200 with 0 hits (never 500)',
      check: (r) => {
        if (r.http >= 500) return false;
        if (r.http >= 400 && r.http < 500) return true;
        return r.http === 200 && r.hits.length === 0;
      },
    },
    {
      q: 'amrit,',
      rule: 'Trailing comma amrit, → 4xx or still ATQ / empty — never 500',
      expect: 'never HTTP 500',
      check: (r) => r.http < 500,
      soft: true,
    },
    {
      q: ';;;;',
      rule: 'Semicolons only → 4xx or empty, never 500',
      expect: 'HTTP 4xx or 200 empty',
      check: (r) => {
        if (r.http >= 500) return false;
        if (r.http >= 400 && r.http < 500) return true;
        return r.http === 200 && r.hits.length === 0;
      },
    },
  ];

  for (const t of negatives) {
    const r = await call(t.q);
    const how = `GET /v1/flights/airports?airport=${encodeURIComponent(t.q)}`;
    const pass = t.check(r);
    // soft: never-500 only still PASS; invented hits on punctuation already fail check when hits>0
    add(
      'NEG',
      t.rule,
      how,
      t.expect,
      pass ? 'PASS' : 'BUG',
      `HTTP ${r.http} n=${r.hits.length} top=${r.hits.slice(0, 5).map((h) => `${h.airportCode}:${h.city}`).join(' | ') || '(none)'} code=${r.error?.code || '-'}`,
      { query: t.q, hits: r.hits.slice(0, 8), error: r.error },
    );
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: process.env.BASE_URL,
    tierId: process.env.TIER_ID,
    api: 'GET /v1/flights/airports',
    note: 'Airport catalog matching only. No flight search / book.',
    counts,
    rows,
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== COUNTS ===', counts);
  console.log('Report', OUT);
  if (counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

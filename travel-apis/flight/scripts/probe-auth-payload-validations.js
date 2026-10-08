/**
 * Auth payload / special-char matrix
 *   POST /auth/partner/token      (access token)
 *   POST /auth/partner/refresh    (refresh token)
 *   POST /v1/auth/session         (user auth)
 *
 * Invalid extra commas / special chars must return a 4xx error envelope, never HTTP 500.
 *
 * Run: node scripts/probe-auth-payload-validations.js
 */
import fs from 'fs';
import path from 'path';
import { config } from '../../../shared/config/env.js';
import {
  requestPartnerRefresh,
  requestPartnerToken,
  requestUserSession,
} from '../../../shared/lib/authApi.js';

const OUT = path.join('reports', process.env.AUTH_VAL_OUT || 'auth-payload-validations.json');

const TOKEN = 'POST /auth/partner/token';
const REFRESH = 'POST /auth/partner/refresh';
const SESSION = 'POST /v1/auth/session';

function errCode(res) {
  return res?.data?.error?.code || res?.data?.code || null;
}

function brief(res, n = 400) {
  try {
    return redact(JSON.stringify(res?.data)).slice(0, n);
  } catch {
    return String(res?.data).slice(0, n);
  }
}

function redact(text) {
  return String(text || '')
    .replace(/"(partner_secret|refresh_token|access_token|auth_token)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"')
    .replace(/gmr_[a-z]+_[A-Za-z0-9._-]+/gi, '[REDACTED]');
}

function add(rows, rec) {
  const row = {
    id: rec.id,
    section: rec.section,
    api: rec.api,
    rule: rec.rule.startsWith('POST ') ? rec.rule : `${rec.api} — ${rec.rule}`,
    how: rec.how,
    expected: rec.expected,
    actual: rec.actual,
    status: rec.status,
    note: rec.note || rec.actual,
    http: rec.res?.status ?? null,
    code: errCode(rec.res),
    snippet: rec.res ? brief(rec.res) : null,
    responseSnippet: rec.res ? brief(rec.res) : null,
    at: new Date().toISOString(),
  };
  rows.push(row);
  console.log(`[${row.status}] ${row.id} ${row.rule}`);
  if (row.http != null) console.log(' HTTP', row.http, row.code || '');
}

function scoreValid(res, { needAccess, needRefresh, needAuth } = {}) {
  if ((res.status || 0) >= 500) {
    return { status: 'BUG', actual: `HTTP ${res.status} Internal Server Error on valid credentials` };
  }
  if (!res.ok) {
    return { status: 'BUG', actual: `HTTP ${res.status} code=${errCode(res)} — valid request was rejected` };
  }
  if (needAccess && !res.data?.access_token) {
    return { status: 'BUG', actual: 'HTTP 200 but access_token missing' };
  }
  if (needRefresh && !res.data?.refresh_token) {
    return { status: 'BUG', actual: 'HTTP 200 but refresh_token missing' };
  }
  if (needAuth && !res.data?.auth_token) {
    return { status: 'BUG', actual: 'HTTP 200 but auth_token missing' };
  }
  return { status: 'PASS', actual: `HTTP ${res.status} tokens present` };
}

function scoreInvalid(res) {
  const code = errCode(res);
  if ((res.status || 0) >= 500) {
    return {
      status: 'BUG',
      actual: `HTTP ${res.status} Internal Server Error — extra chars/invalid field must be 4xx with error.code, never 500`,
    };
  }
  if (res.ok || res.status === 200) {
    return { status: 'BUG', actual: 'Accepted invalid / special-char input (HTTP 200)' };
  }
  if (res.status >= 400 && res.status < 500 && (code || res.data?.error)) {
    return {
      status: 'PASS',
      actual: `HTTP ${res.status} code=${code || '(error envelope)'} — valid client error, not 500`,
    };
  }
  if (res.status >= 400 && res.status < 500) {
    return {
      status: 'BUG',
      actual: `HTTP ${res.status} but no error.code / error envelope`,
    };
  }
  return { status: 'BUG', actual: `Expected 4xx error; got HTTP ${res.status} code=${code}` };
}

async function main() {
  console.log('Base:', config.baseUrl);
  console.log('Auth validation probe (token / refresh / user session)');

  const rows = [];
  const validBody = {
    partner_id: config.partnerId,
    partner_secret: config.partnerSecret,
  };

  // ── Access token ──
  const tokenOk = await requestPartnerToken(validBody);
  {
    const s = scoreValid(tokenOk, { needAccess: true, needRefresh: true });
    add(rows, {
      id: 'AT0',
      section: 'Access token',
      api: TOKEN,
      rule: 'valid partner_id + partner_secret returns access_token and refresh_token',
      how: `${TOKEN} with partner_id/partner_secret from env (this is the baseline for mutations below).`,
      expected: 'HTTP 200 with access_token + refresh_token',
      actual: s.actual,
      status: s.status,
      res: tokenOk,
    });
  }

  const missingId = await requestPartnerToken({ partner_secret: config.partnerSecret });
  add(rows, {
    id: 'AT1',
    section: 'Access token',
    api: TOKEN,
    rule: 'omit partner_id',
    how: `${TOKEN} body { partner_secret } only.`,
    expected: 'HTTP 4xx with error.code (never 500)',
    ...scoreInvalid(missingId),
    res: missingId,
  });

  const missingSecret = await requestPartnerToken({ partner_id: config.partnerId });
  add(rows, {
    id: 'AT2',
    section: 'Access token',
    api: TOKEN,
    rule: 'omit partner_secret',
    how: `${TOKEN} body { partner_id } only.`,
    expected: 'HTTP 4xx with error.code (never 500)',
    ...scoreInvalid(missingSecret),
    res: missingSecret,
  });

  const emptyBody = await requestPartnerToken({});
  add(rows, {
    id: 'AT3',
    section: 'Access token',
    api: TOKEN,
    rule: 'empty JSON body',
    how: `${TOKEN} body {}.`,
    expected: 'HTTP 4xx with error.code (never 500)',
    ...scoreInvalid(emptyBody),
    res: emptyBody,
  });

  const specialTokenCases = [
    ['AT4', 'partner_id with trailing comma', { ...validBody, partner_id: `${config.partnerId},` }],
    ['AT5', 'partner_secret with trailing comma', { ...validBody, partner_secret: `${config.partnerSecret},` }],
    ['AT6', 'partner_id with punctuation !@#$', { ...validBody, partner_id: `${config.partnerId}!@#$` }],
    ['AT7', 'partner_id with HTML/script chars', { ...validBody, partner_id: `${config.partnerId}<script>` }],
    ['AT8', 'partner_id with quote/semicolon', { ...validBody, partner_id: `${config.partnerId}';` }],
  ];
  for (const [id, rule, body] of specialTokenCases) {
    const res = await requestPartnerToken(body);
    add(rows, {
      id,
      section: 'Access token',
      api: TOKEN,
      rule,
      how: `${TOKEN} clone valid credentials then change the named field (extra comma / special chars).`,
      expected: 'HTTP 4xx with error.code (never 500; must not issue tokens)',
      ...scoreInvalid(res),
      res,
    });
  }

  // ── Refresh token ──
  const refreshToken = tokenOk.data?.refresh_token || '';
  const refreshOk = refreshToken
    ? await requestPartnerRefresh(refreshToken)
    : { status: 0, ok: false, data: { error: { code: 'NO_REFRESH', message: 'AT0 did not return refresh_token' } } };
  {
    const s = refreshToken
      ? scoreValid(refreshOk, { needAccess: true })
      : { status: 'NOT TESTED', actual: 'No refresh_token from AT0' };
    add(rows, {
      id: 'RT0',
      section: 'Refresh token',
      api: REFRESH,
      rule: 'valid refresh_token returns a new access_token',
      how: `${REFRESH} body { refresh_token } from the access-token response.`,
      expected: 'HTTP 200 with access_token (never 500)',
      actual: s.actual,
      status: s.status,
      res: refreshOk,
    });
  }

  const rtEmpty = await requestPartnerRefresh('');
  add(rows, {
    id: 'RT1',
    section: 'Refresh token',
    api: REFRESH,
    rule: 'empty refresh_token',
    how: `${REFRESH} body { refresh_token: "" }.`,
    expected: 'HTTP 4xx with error.code (never 500)',
    ...scoreInvalid(rtEmpty),
    res: rtEmpty,
  });

  const rtJunk = [
    ['RT2', 'refresh_token with trailing comma', `${refreshToken || 'gmr_rt_dummy'},`],
    ['RT3', 'refresh_token punctuation !@#$', `${refreshToken || 'gmr_rt_dummy'}!@#$`],
    ['RT4', 'refresh_token HTML/script chars', `${refreshToken || 'gmr_rt_dummy'}<script>`],
    ['RT5', 'refresh_token is only a comma', ','],
  ];
  for (const [id, rule, token] of rtJunk) {
    const res = await requestPartnerRefresh(token);
    add(rows, {
      id,
      section: 'Refresh token',
      api: REFRESH,
      rule,
      how: `${REFRESH} clone/mutate refresh_token with extra comma or special chars.`,
      expected: 'HTTP 4xx with error.code (never 500)',
      ...scoreInvalid(res),
      res,
    });
  }

  // ── User auth (session) ──
  const accessToken = refreshOk.data?.access_token || tokenOk.data?.access_token || '';
  const sessionOk = accessToken
    ? await requestUserSession(accessToken, { tierId: config.tierId })
    : { status: 0, ok: false, data: { error: { code: 'NO_ACCESS', message: 'No access_token from AT0/RT0' } } };
  {
    const s = accessToken
      ? scoreValid(sessionOk, { needAuth: true })
      : { status: 'NOT TESTED', actual: 'No access_token to call user session' };
    add(rows, {
      id: 'UA0',
      section: 'User auth',
      api: SESSION,
      rule: 'valid X-Partner-Key + tierId returns auth_token',
      how: `${SESSION} with X-Partner-Key = partner access_token and body { tierId } from env.`,
      expected: 'HTTP 200 with auth_token (never 500)',
      actual: s.actual,
      status: s.status,
      res: sessionOk,
    });
  }

  const uaMissingKey = await requestUserSession(undefined, { tierId: config.tierId });
  add(rows, {
    id: 'UA1',
    section: 'User auth',
    api: SESSION,
    rule: 'omit X-Partner-Key',
    how: `${SESSION} with no X-Partner-Key header, body { tierId }.`,
    expected: 'HTTP 4xx with error.code (never 500)',
    ...scoreInvalid(uaMissingKey),
    res: uaMissingKey,
  });

  const uaBadKey = await requestUserSession('gmr_at_invalid_access_token', { tierId: config.tierId });
  add(rows, {
    id: 'UA2',
    section: 'User auth',
    api: SESSION,
    rule: 'invalid X-Partner-Key',
    how: `${SESSION} X-Partner-Key=gmr_at_invalid_access_token, body { tierId }.`,
    expected: 'HTTP 4xx with error.code (never 500)',
    ...scoreInvalid(uaBadKey),
    res: uaBadKey,
  });

  const uaSpecial = [
    ['UA3', 'X-Partner-Key with trailing comma', `${accessToken || 'gmr_at_dummy'},`, { tierId: config.tierId }],
    ['UA4', 'X-Partner-Key with punctuation', `${accessToken || 'gmr_at_dummy'}!@#$`, { tierId: config.tierId }],
    ['UA5', 'X-Partner-Key with HTML/script chars', `${accessToken || 'gmr_at_dummy'}<script>`, { tierId: config.tierId }],
    ['UA6', 'tierId with trailing comma', accessToken, { tierId: `${config.tierId},` }],
    ['UA7', 'tierId with punctuation', accessToken, { tierId: `${config.tierId}!@#` }],
    ['UA8', 'tierId with HTML/script chars', accessToken, { tierId: `${config.tierId}<script>` }],
  ];
  for (const [id, rule, key, body] of uaSpecial) {
    const res = await requestUserSession(key, body);
    add(rows, {
      id,
      section: 'User auth',
      api: SESSION,
      rule,
      how: `${SESSION} clone valid user-auth request then add extra comma / special chars on ${/tierId/.test(rule) ? 'tierId' : 'X-Partner-Key'}.`,
      expected: 'HTTP 4xx with error.code (never 500)',
      ...scoreInvalid(res),
      res,
    });
  }

  const summary = {
    baseUrl: config.baseUrl,
    suite: 'Auth payload validations',
    counts: {
      PASS: rows.filter((r) => r.status === 'PASS').length,
      BUG: rows.filter((r) => r.status === 'BUG').length,
      'NOT TESTED': rows.filter((r) => r.status === 'NOT TESTED').length,
      total: rows.length,
    },
    bugs: rows.filter((r) => r.status === 'BUG'),
    rows,
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log('\n=== AUTH SUMMARY ===');
  console.log(JSON.stringify(summary.counts, null, 2));
  if (summary.bugs.length) {
    console.log('BUGS:', summary.bugs.map((b) => `${b.id} ${b.rule} — ${b.actual}`).join('\n'));
  }
  console.log('Report:', OUT);
  if (summary.counts.BUG > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exitCode = 1;
});

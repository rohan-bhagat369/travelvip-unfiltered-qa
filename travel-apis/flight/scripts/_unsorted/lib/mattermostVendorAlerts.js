/**
 * Mattermost helper for vendor-alerts-dev checks during booking probes.
 *
 * Auth (either):
 *   MATTERMOST_TOKEN=<session or PAT>
 *   or MATTERMOST_LOGIN_ID + MATTERMOST_PASSWORD (auto login)
 *
 * Optional:
 *   MATTERMOST_URL=https://team.scandid.in
 *   MATTERMOST_TEAM=scandid
 *   MATTERMOST_CHANNEL=vendor-alerts-dev
 */
function mmConfig() {
  return {
    url: (process.env.MATTERMOST_URL || 'https://team.scandid.in').replace(/\/$/, ''),
    token: process.env.MATTERMOST_TOKEN || '',
    loginId: process.env.MATTERMOST_LOGIN_ID || '',
    password: process.env.MATTERMOST_PASSWORD || '',
    team: process.env.MATTERMOST_TEAM || 'scandid',
    channel: process.env.MATTERMOST_CHANNEL || 'vendor-alerts-dev',
  };
}

let cachedChannelId = null;
let sessionToken = null;

export function mattermostConfigured() {
  const c = mmConfig();
  return Boolean(c.token || (c.loginId && c.password));
}

async function ensureToken() {
  if (sessionToken) return sessionToken;
  const c = mmConfig();
  if (c.token) {
    sessionToken = c.token;
    return sessionToken;
  }
  if (!c.loginId || !c.password) {
    throw new Error('MATTERMOST_TOKEN or MATTERMOST_LOGIN_ID/PASSWORD required');
  }
  const res = await fetch(`${c.url}/api/v4/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: c.loginId, password: c.password }),
  });
  const token = res.headers.get('Token') || res.headers.get('token');
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !token) {
    throw new Error(`Mattermost login failed: ${body?.message || res.status}`);
  }
  sessionToken = token;
  process.env.MATTERMOST_TOKEN = token;
  return sessionToken;
}

async function mmFetch(pathname, init = {}, retried = false) {
  const { url } = mmConfig();
  const token = await ensureToken();
  const res = await fetch(`${url}/api/v4${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if ((res.status === 401 || res.status === 403) && !retried && mmConfig().loginId) {
    sessionToken = null;
    process.env.MATTERMOST_TOKEN = '';
    await ensureToken();
    return mmFetch(pathname, init, true);
  }
  if (!res.ok) {
    const msg = data?.message || data?.id || text?.slice(0, 200) || res.statusText;
    throw new Error(`Mattermost ${res.status}: ${msg}`);
  }
  return data;
}

export async function getVendorAlertsChannelId() {
  if (cachedChannelId) return cachedChannelId;
  const { team, channel } = mmConfig();
  const ch = await mmFetch(
    `/teams/name/${encodeURIComponent(team)}/channels/name/${encodeURIComponent(channel)}`
  );
  cachedChannelId = ch.id;
  return cachedChannelId;
}

export async function fetchRecentAlertPosts({ perPage = 40, sinceMs = null } = {}) {
  const channelId = await getVendorAlertsChannelId();
  const qs = new URLSearchParams({ page: '0', per_page: String(perPage) });
  if (sinceMs) qs.set('since', String(sinceMs));
  const postsPayload = await mmFetch(`/channels/${channelId}/posts?${qs}`);
  const order = postsPayload.order || [];
  const posts = postsPayload.posts || {};
  return order.map((id) => posts[id]).filter(Boolean);
}

/**
 * Poll vendor-alerts-dev for posts mentioning bookingReference.
 * Also matches common failure alerts that may use requestId instead of BR.
 */
export async function waitForVendorAlert({
  bookingReference,
  requestId = null,
  timeoutMs = 45000,
  intervalMs = 4000,
  sinceMs = Date.now() - 60_000,
  keywords = [],
} = {}) {
  const cfg = mmConfig();
  if (!mattermostConfigured()) {
    return {
      checked: false,
      reason: 'Mattermost auth not configured — skip alert check',
      matches: [],
    };
  }
  if (!bookingReference && !requestId) {
    return { checked: false, reason: 'no bookingReference/requestId', matches: [] };
  }

  const deadline = Date.now() + timeoutMs;
  const needles = [bookingReference, requestId].filter(Boolean).map(String);
  let lastError = null;
  let lastCount = 0;
  let latestSample = [];

  while (Date.now() < deadline) {
    try {
      const posts = await fetchRecentAlertPosts({ perPage: 60, sinceMs });
      lastCount = posts.length;
      latestSample = posts.slice(0, 3).map((p) =>
        String(p.message || '').replace(/\s+/g, ' ').slice(0, 160)
      );
      const matches = posts.filter((p) => {
        const msg = String(p.message || '');
        const hit = needles.some((n) => msg.includes(n));
        if (!hit) return false;
        if (!keywords.length) return true;
        return keywords.every((k) => msg.toLowerCase().includes(String(k).toLowerCase()));
      });
      if (matches.length) {
        return {
          checked: true,
          found: true,
          channel: `${cfg.team}/${cfg.channel}`,
          url: `${cfg.url}/${cfg.team}/channels/${cfg.channel}`,
          matches: matches.map((p) => ({
            id: p.id,
            create_at: p.create_at,
            message: String(p.message || '').slice(0, 800),
          })),
        };
      }
    } catch (e) {
      lastError = e.message;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    checked: true,
    found: false,
    channel: `${cfg.team}/${cfg.channel}`,
    url: `${cfg.url}/${cfg.team}/channels/${cfg.channel}`,
    lastPostCount: lastCount,
    latestSample,
    error: lastError,
    matches: [],
    reason: `No alert containing ${needles.join('/')} within ${timeoutMs}ms`,
  };
}

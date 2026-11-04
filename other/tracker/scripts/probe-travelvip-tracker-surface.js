import fs from 'fs';

const base = 'https://tracker.travelvip.ai';

const health = await (await fetch(`${base}/api/health`)).json();
console.log('health', health);

const html = await (await fetch(`${base}/`)).text();
const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+/g)].map((m) => m[0]);
console.log('chunks', chunks.length, chunks);

const texts = [];
for (const c of chunks) {
  try {
    const t = await (await fetch(base + c)).text();
    texts.push({ c, len: t.length, t });
  } catch (e) {
    console.log('fail', c, e.message);
  }
}

const blob = texts.map((x) => x.t).join('\n');
const keywords = [
  'sprint', 'project', 'task', 'board', 'issue', 'epic', 'backlog', 'kanban',
  'assignee', 'priority', 'status', 'comment', 'label', 'milestone', 'workspace',
  'team', 'google', 'oauth', 'auth', 'dashboard', 'report', 'timeline', 'gantt',
  'story', 'bug', 'subtask', 'cycle', 'roadmap', 'estimate', 'storyPoints',
];
const found = {};
for (const k of keywords) {
  const n = (blob.match(new RegExp(k, 'gi')) || []).length;
  if (n) found[k] = n;
}
console.log('keywordHits', found);

const routeRe = /["'](\/(?:tasks|projects|sprints|boards|issues|settings|admin|api|me|users|teams|workspace|dashboard|reports|epics|backlog)[^"']*)["']/g;
const quoted = [...blob.matchAll(routeRe)].map((m) => m[1]);
console.log('route-like', [...new Set(quoted)].slice(0, 120));

const apiPaths = [...blob.matchAll(/["'](\/api\/[a-zA-Z0-9_\-./]+)["']/g)].map((m) => m[1]);
console.log('api-like', [...new Set(apiPaths)].slice(0, 150));

const probes = [
  '/api/me', '/api/session', '/api/auth/session', '/api/tasks', '/api/projects',
  '/api/sprints', '/api/users', '/api/health', '/tasks', '/projects', '/sprints',
  '/settings', '/dashboard', '/boards', '/backlog',
];
const probeOut = [];
for (const p of probes) {
  const r = await fetch(base + p, { redirect: 'manual' });
  const body = await r.text();
  probeOut.push({
    path: p,
    status: r.status,
    location: r.headers.get('location'),
    contentType: r.headers.get('content-type'),
    snippet: body.slice(0, 220).replace(/\n/g, ' '),
  });
  console.log(p, r.status, r.headers.get('location') || '', body.slice(0, 120).replace(/\n/g, ' '));
}

// Parse login form more fully
const formBits = {
  title: (html.match(/<title>([^<]+)<\/title>/) || [])[1],
  description: (html.match(/name="description" content="([^"]+)"/) || [])[1],
  hasGoogleCta: /Continue with Google/i.test(html),
  themeSupport: /localStorage\.getItem\('theme'\)/.test(html),
  framework: /_next\/static/.test(html) ? 'Next.js' : 'unknown',
};

const report = {
  ranAt: new Date().toISOString(),
  url: base,
  formBits,
  health,
  chunks,
  keywordHits: found,
  routeLike: [...new Set(quoted)],
  apiLike: [...new Set(apiPaths)],
  probes: probeOut,
  note: 'Authenticated product tour blocked by Google SSO; this is unauthenticated surface + bundle analysis only.',
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/travelvip-tracker-poc-review.json', JSON.stringify(report, null, 2));
console.log('wrote reports/travelvip-tracker-poc-review.json');

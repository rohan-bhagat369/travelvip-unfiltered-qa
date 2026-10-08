import fs from 'fs';

const base = 'https://tracker.travelvip.ai';
fs.mkdirSync('reports', { recursive: true });

const html = await (await fetch(`${base}/`)).text();
fs.writeFileSync('reports/tracker-login.html', html);

for (const p of ['/api/auth/session', '/api/auth/providers', '/api/auth/csrf']) {
  const r = await fetch(base + p);
  const text = await r.text();
  console.log(p, r.status, text.slice(0, 500));
}

const chunkRe = /(?:src|href)="(\/_next\/static\/chunks\/[^"]+)"/g;
const chunks = [...new Set([...html.matchAll(chunkRe)].map((m) => m[1]))];
console.log('chunks', chunks);

let blob = '';
for (const c of chunks) {
  const t = await (await fetch(base + c)).text();
  blob += `\n/* ${c} */\n${t}`;
  fs.writeFileSync(`reports/tracker-chunk-${c.split('/').pop()}`, t);
}

fs.writeFileSync('reports/tracker-bundle-concat.txt', blob.slice(0, 2500000));

const interesting = [
  'view=board', 'mine=true', 'following=true', 'subtask', 'sprint', 'backlog',
  'priority', 'assignee', 'storyPoints', 'estimate', 'label', 'comment',
  'project', 'dueDate', 'NextAuth', 'GoogleProvider', 'Prisma', 'drizzle',
  'server action', 'redis', 'postgres',
];
for (const k of interesting) {
  const i = blob.toLowerCase().indexOf(k.toLowerCase());
  if (i >= 0) {
    console.log('HIT', k, '->', JSON.stringify(blob.slice(Math.max(0, i - 50), i + 100)));
  }
}

const strs = [...blob.matchAll(/"([^"\\]{4,100})"/g)].map((m) => m[1]);
const useful = [...new Set(strs.filter((s) =>
  /task|sprint|project|board|backlog|assignee|priority|subtask|status|label|comment|due|follow|mine/i.test(s)
))].slice(0, 200);
console.log('useful strings count', useful.length);
console.log(useful);

const report = {
  ranAt: new Date().toISOString(),
  auth: {
    session: 'checked',
  },
  usefulStrings: useful,
};
fs.writeFileSync('reports/travelvip-tracker-bundle-strings.json', JSON.stringify({ useful }, null, 2));

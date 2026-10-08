const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();

const fp = path.join(process.env.USERPROFILE, 'Downloads', 'Byufuel - Check list Doc.xlsx');
const wb = XLSX.readFile(fp);
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' });

let role = '';
const admin = [];
const wh = [];
const all = [];

for (let i = 0; i < rows.length; i++) {
  const a = String(rows[i][0] || '').trim();
  const b = String(rows[i][1] || '').trim();
  const c = String(rows[i][2] || '').trim();
  const d = String(rows[i][3] || '').trim();
  const e = String(rows[i][4] || '').trim();
  if (/^ADMIN$/i.test(a) || /Admin Features/i.test(a) || /Admin Features/i.test(b)) role = 'ADMIN';
  if (/^WAREHOUSE$/i.test(a) || /Warehouse\s+Features/i.test(a) || /Warehouse\s+Features/i.test(b)) role = 'WAREHOUSE';
  if (/^SUPPLIER$/i.test(a) || /Supplier Features/i.test(b)) role = 'SUPPLIER';
  if (/^DRIVER$/i.test(a) || /Driver Features/i.test(b)) role = 'DRIVER';
  if (/^TSM$/i.test(a) || /TSM Features/i.test(b)) role = 'TSM';

  const feature = b || a;
  const isSection = /features for verification/i.test(feature) || /features for verification/i.test(a);
  const isRoleOnly = /^(ADMIN|SUPPLIER|DRIVER|WAREHOUSE|TSM)$/i.test(a) && !b && !c;
  if (isSection || isRoleOnly || (!a && !b && !c)) continue;
  if (!feature && !c) continue;

  const item = {
    excelRow: i + 1,
    role,
    col0: a.slice(0, 80),
    feature: feature.slice(0, 120),
    detail: c.slice(0, 160),
    status: d.slice(0, 40),
    comments: e.slice(0, 120),
  };
  all.push(item);
  if (role === 'ADMIN') admin.push(item);
  if (role === 'WAREHOUSE') wh.push(item);
}

// number within role
admin.forEach((x, idx) => { x.id = `ADM-${idx + 1}`; });
wh.forEach((x, idx) => { x.id = `WH-${idx + 1}`; });

const out = {
  adminCount: admin.length,
  whCount: wh.length,
  ADM47: admin[46] || null, // 0-index 46 = ADM-47
  WH11: wh[10] || null,
  adminAround47: admin.slice(40, 55),
  whAll: wh,
};

fs.writeFileSync('reports/byufuel-adm47-wh11-mapped.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

// also fetch MM post context
(async () => {
  const url = 'https://team.scandid.in/api/v4';
  const mcp = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.cursor', 'mcp.json'), 'utf8'));
  const login = await fetch(`${url}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login_id: process.env.MATTERMOST_LOGIN_ID,
      password: process.env.MATTERMOST_PASSWORD,
    }),
  });
  const token = login.headers.get('Token') || login.headers.get('token');
  const teamId = mcp.mcpServers.mattermost.env.MATTERMOST_TEAM_ID;
  const res = await fetch(`${url}/teams/${teamId}/posts/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ terms: '"ADM-47 WH-11"', is_or_search: false, page: 0, per_page: 5 }),
  });
  const data = await res.json();
  const posts = Object.values(data.posts || {});
  for (const p of posts) {
    if (String(p.message || '').trim() !== 'ADM-47 WH-11' && !String(p.message || '').includes('ADM-47')) continue;
    const ch = await (await fetch(`${url}/channels/${p.channel_id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const user = await (await fetch(`${url}/users/${p.user_id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const thread = await (await fetch(`${url}/posts/${p.root_id || p.id}/thread`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const replies = Object.values(thread.posts || {}).sort((a, b) => a.create_at - b.create_at).map((r) => ({
      from: r.user_id,
      at: new Date(r.create_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      msg: String(r.message || '').slice(0, 400),
    }));
    // resolve usernames
    for (const r of replies) {
      const u = await (await fetch(`${url}/users/${r.from}`, { headers: { Authorization: `Bearer ${token}` } })).json();
      r.from = u.username;
    }
    console.log('\nMM_CONTEXT', JSON.stringify({
      channel: ch.display_name || ch.name,
      from: user.username,
      at: new Date(p.create_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      message: p.message,
      replies,
    }, null, 2));
  }
})();

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config();

const downloads = path.join(process.env.USERPROFILE, 'Downloads');

function dumpChecklist() {
  const fp = path.join(downloads, 'Byufuel - Check list Doc.xlsx');
  const wb = XLSX.readFile(fp);
  const out = {};
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    const hits = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map((c) => String(c ?? ''));
      const line = cells.join(' | ');
      if (/recurring|document|warehouse|schedule|generat|challan|pdf/i.test(line)) {
        hits.push({ row: i + 1, cells: cells.map((c) => c.slice(0, 100)).filter(Boolean) });
      }
    }
    out[sn] = { totalRows: rows.length, header: rows[0], hits };
  }
  return out;
}

function dumpTcPackIds() {
  const fp = path.join(downloads, "Byufuel-TC's.xlsx");
  const wb = XLSX.readFile(fp);
  const per = {};
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
    const hi = rows.findIndex((r) => r.some((c) => /Test Case/i.test(String(c))));
    if (hi < 0) continue;
    const hdr = rows[hi].map(String);
    const iTC = hdr.findIndex((h) => /Test Case/i.test(h));
    const ids = new Set();
    for (let i = hi + 1; i < rows.length; i++) {
      const tc = String(rows[i][iTC] || '').trim();
      if (tc) ids.add(tc);
    }
    per[sn] = [...ids].slice(0, 50);
  }
  return per;
}

async function mmSearch() {
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
  async function search(terms) {
    const res = await fetch(`${url}/teams/${teamId}/posts/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms, is_or_search: true, page: 0, per_page: 20 }),
    });
    const data = await res.json();
    return Object.values(data.posts || {})
      .sort((a, b) => b.create_at - a.create_at)
      .slice(0, 8)
      .map((p) => ({
        at: new Date(p.create_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        msg: String(p.message || '').replace(/\n/g, ' ').slice(0, 280),
      }));
  }
  return {
    adm47: await search('ADM-47'),
    wh11: await search('WH-11'),
    recurring: await search('recurring schedule ADM'),
  };
}

(async () => {
  const out = {
    checklistHits: dumpChecklist(),
    tcPackIds: dumpTcPackIds(),
    mattermost: await mmSearch(),
  };
  fs.writeFileSync('reports/byufuel-adm47-wh11-detail.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    checklistSheets: Object.keys(out.checklistHits),
    checklistHitCounts: Object.fromEntries(Object.entries(out.checklistHits).map(([k, v]) => [k, v.hits.length])),
    sampleChecklist: Object.fromEntries(Object.entries(out.checklistHits).map(([k, v]) => [k, v.hits.slice(0, 25)])),
    tcPackIds: out.tcPackIds,
    mattermost: out.mattermost,
  }, null, 2));
})();

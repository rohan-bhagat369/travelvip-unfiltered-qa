import fs from 'fs';

const PM = 'c:/Users/Rohan Bhagat/Downloads/TravelVIP.postman.json';
const pm = JSON.parse(fs.readFileSync(PM, 'utf8'));

function walk(items, folder = '', out = []) {
  for (const it of items || []) {
    if (it.item) walk(it.item, folder ? `${folder}/${it.name}` : it.name, out);
    if (!it.request) continue;
    const u = it.request.url;
    const raw = typeof u === 'string' ? u : (u?.raw || '');
    const path = Array.isArray(u?.path) ? `/${u.path.join('/')}` : '';
    const full = raw || path;
    let body = null;
    const bodyRaw = it.request.body?.raw;
    if (bodyRaw) {
      try {
        body = JSON.parse(bodyRaw.replace(/\{\{[^}]+\}\}/g, '"__VAR__"'));
      } catch {
        body = { __err: bodyRaw.slice(0, 100) };
      }
    }
    out.push({
      name: it.name,
      folder,
      method: it.request.method,
      full,
      hasBody: Boolean(bodyRaw),
      topKeys: body && !body.__err ? Object.keys(body) : [],
      action: body?.action,
      body,
    });
  }
  return out;
}

const all = walk(pm.item);
const flights = all.filter((r) => /flight/i.test(`${r.full} ${r.folder} ${r.name}`));
console.log(JSON.stringify({
  collectionName: pm.info?.name,
  allRequests: all.length,
  flightRequests: flights.length,
  topFolders: [...new Set(all.map((a) => a.folder.split('/')[0]))],
  flightList: flights.map((f) => ({
    method: f.method,
    name: f.name,
    folder: f.folder,
    path: (f.full.match(/\/(?:v\d|api)[^?\s]*/)?.[0] || f.full).slice(0, 80),
    topKeys: f.topKeys,
    action: f.action,
  })),
}, null, 2));

fs.writeFileSync('reports/postman-flight-inventory.json', JSON.stringify(flights, null, 2));

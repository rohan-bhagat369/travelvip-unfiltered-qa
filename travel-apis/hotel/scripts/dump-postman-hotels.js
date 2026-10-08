/**
 * Dump hotel request names + bodies from Downloads TravelVIP collection.
 */
import fs from 'fs';

const SRC = 'c:/Users/Rohan Bhagat/Downloads/TravelVIP.postman.json';
const pm = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function walk(items, folder = '', out = []) {
  for (const it of items || []) {
    if (it.item) walk(it.item, folder ? `${folder}/${it.name}` : it.name, out);
    if (!it.request) continue;
    const u = it.request.url;
    const full = typeof u === 'string' ? u : (u?.raw || '');
    if (!/hotel/i.test(`${full} ${folder} ${it.name}`)) continue;
    let body = null;
    const raw = it.request.body?.raw;
    if (raw) {
      try { body = JSON.parse(raw.replace(/\{\{[^}]+\}\}/g, '"__VAR__"')); } catch { body = { err: raw.slice(0, 80) }; }
    }
    out.push({
      name: it.name,
      folder,
      method: it.request.method,
      path: full.match(/\/v\d\/hotels[^?\s]*/)?.[0] || full.slice(0, 100),
      topKeys: body ? Object.keys(body) : [],
      body,
      examples: (it.response || []).map((r) => r.name),
    });
  }
  return out;
}

const hotels = walk(pm.item);
fs.writeFileSync('reports/postman-hotel-inventory.json', JSON.stringify(hotels, null, 2));
console.log(JSON.stringify(hotels.map((h) => ({
  name: h.name, method: h.method, path: h.path, topKeys: h.topKeys, examples: h.examples?.slice(0, 3),
})), null, 2));

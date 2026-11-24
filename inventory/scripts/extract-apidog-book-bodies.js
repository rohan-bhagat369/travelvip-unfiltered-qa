import fs from 'fs';

function safeParse(s) {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    /* ignore */
  }
  try {
    return JSON.parse(s.replace(/\{\{[^}]+\}\}/g, '"__VAR__"'));
  } catch {
    return s.slice(0, 800);
  }
}

function walk(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, out));
    return;
  }
  if (node.api?.requestBody?.examples) {
    for (const ex of node.api.requestBody.examples) {
      if (ex.value && /finalize-booking|create-booking/.test(node.api.path || '')) {
        out.push({
          name: node.name,
          path: node.api.path,
          example: safeParse(ex.value),
        });
      }
    }
  }
  for (const k of ['items', 'children', 'apis']) {
    if (node[k]) walk(node[k], out);
  }
}

const base = `${process.env.USERPROFILE}/Downloads`;
for (const file of ['api_services_booking.apidog.json', 'web_services_bookings.apidog.json']) {
  const j = JSON.parse(fs.readFileSync(`${base}/${file}`, 'utf8'));
  const out = [];
  walk(j.apiCollection, out);
  console.log(`\n#### ${file} book bodies ${out.length}`);
  for (const o of out) {
    console.log('--', o.name, o.path);
    console.log(typeof o.example === 'string' ? o.example : JSON.stringify(o.example, null, 2).slice(0, 1000));
  }
}

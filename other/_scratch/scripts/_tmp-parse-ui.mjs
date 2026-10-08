import fs from 'fs';
const xml = fs.readFileSync('reports/byufuel-ui.xml', 'utf8');
const nodes = [...xml.matchAll(/<node [^>]*>/g)].map((m) => m[0]);
for (const n of nodes) {
  const text = (n.match(/\btext="([^"]*)"/) || [])[1] || '';
  const desc = (n.match(/content-desc="([^"]*)"/) || [])[1] || '';
  const bounds = (n.match(/bounds="([^"]*)"/) || [])[1] || '';
  const click = /clickable="true"/.test(n);
  const label = text || desc;
  if (!label) continue;
  console.log(`${click ? 'C' : ' '} ${bounds} | ${label}`);
}

const fs = require('fs');
const xml = fs.readFileSync('reports/byufuel-ui.xml', 'utf8');
const nodes = [...xml.matchAll(/<node [^>]*>/g)].map((m) => m[0]);
for (const n of nodes) {
  const text = (n.match(/text="([^"]*)"/) || [])[1] || '';
  const desc = (n.match(/content-desc="([^"]*)"/) || [])[1] || '';
  const bounds = (n.match(/bounds="([^"]*)"/) || [])[1] || '';
  const click = /clickable="true"/.test(n);
  if (!text && !desc) continue;
  console.log(`${click ? 'C' : ' '} ${bounds} | ${text || desc}`);
}

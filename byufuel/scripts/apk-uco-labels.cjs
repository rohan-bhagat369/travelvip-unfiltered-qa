const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const g = (n) => {
    const x = m[0].match(new RegExp(n + '="([^"]*)"'));
    return x ? x[1] : '';
  };
  const t = g('text');
  const d = g('content-desc').replace(/&#10;/g, ' | ');
  if (!t && !d) continue;
  console.log(g('bounds'), g('clickable'), (d || t).slice(0, 100));
}

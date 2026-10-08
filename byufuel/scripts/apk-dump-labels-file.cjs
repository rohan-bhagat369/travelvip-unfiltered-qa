const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const attr = (n) => {
    const mm = m[0].match(new RegExp(n + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  const t = attr('text');
  const d = attr('content-desc');
  const h = attr('hint');
  if (!t && !d && !h) continue;
  console.log([d || t || h, attr('bounds'), 'pwd=' + attr('password')].join(' | '));
}

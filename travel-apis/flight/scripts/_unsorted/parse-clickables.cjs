const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const a = (n) => {
    const mm = m[0].match(new RegExp(n + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  const t = a('text');
  const d = a('content-desc');
  const c = a('clickable');
  const b = a('bounds');
  if (c === 'true' || /Start|Accept|Cancel|Guide|Scan|Arrive|Activity|Ticket|menu/i.test(t + d)) {
    console.log(JSON.stringify({ t, d, c, b }));
  }
}

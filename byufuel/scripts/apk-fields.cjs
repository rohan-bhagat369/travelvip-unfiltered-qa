const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const a = (k) => {
    const mm = m[0].match(new RegExp(k + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  const label = (a('content-desc') || a('text') || a('hint') || '').replace(/&#10;/g, ' | ');
  const cls = a('class').split('.').pop();
  if (!label && cls !== 'EditText') continue;
  console.log(a('bounds'), cls, label.slice(0, 100));
}

const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const a = (k) => {
    const mm = m[0].match(new RegExp(k + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  if (a('clickable') !== 'true') continue;
  const label = (a('content-desc') || a('text') || a('class').split('.').pop()).replace(/&#10;/g, ' | ');
  console.log(a('bounds'), label.slice(0, 90));
}

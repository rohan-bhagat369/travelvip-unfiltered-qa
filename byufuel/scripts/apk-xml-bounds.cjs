const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const re = /<node [^>]*>/g;
let m;
let n = 0;
while ((m = re.exec(xml))) {
  n++;
  const attr = (k) => {
    const mm = m[0].match(new RegExp(k + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  if (n < 25) console.log(n, attr('class').split('.').pop(), attr('bounds'), attr('clickable'), (attr('content-desc') || attr('text')).slice(0, 40));
}
console.log('nodes', n);

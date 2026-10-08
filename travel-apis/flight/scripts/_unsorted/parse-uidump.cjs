const fs = require('fs');
const xmlPath = process.argv[2];
const xml = fs.readFileSync(xmlPath, 'utf8');
const re = /<node [^>]*>/g;
let m;
const rows = [];
while ((m = re.exec(xml))) {
  const attr = (name) => {
    const mm = m[0].match(new RegExp(name + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  const t = attr('text');
  const d = attr('content-desc');
  const id = attr('resource-id').replace('com.byufuel.mobile:id/', '');
  const cls = (attr('class').split('.').pop() || '');
  const click = attr('clickable');
  const bounds = attr('bounds');
  if (t || d || id) rows.push({ t, d, id, cls, click, bounds });
}
console.log('count', rows.length);
for (const r of rows) console.log(JSON.stringify(r));

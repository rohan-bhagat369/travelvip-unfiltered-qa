const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const re = /content-desc="([^"]*)"|text="([^"]*)"/g;
let m;
const seen = new Set();
while ((m = re.exec(xml))) {
  const t = (m[1] || m[2] || '').replace(/&#10;/g, ' | ').trim();
  if (t && !seen.has(t)) {
    seen.add(t);
    console.log(t.slice(0, 250));
  }
}

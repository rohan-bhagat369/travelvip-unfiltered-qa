const fs = require('fs');
const path = process.argv[2];
const t = fs.readFileSync(path, 'utf8');
const m = [...t.matchAll(/text="([^"]*)"/g)].map((x) => x[1]).filter(Boolean);
console.log(m.slice(0, 80).join('\n'));

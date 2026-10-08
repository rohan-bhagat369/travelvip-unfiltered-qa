const fs = require('fs');
const path = require('path');
const dir = 'd:/Travel VIP API Automation/reports/byufuel-drive';
for (const f of process.argv.slice(2)) {
  const xml = fs.readFileSync(path.join(dir, f), 'utf8');
  const ds = [...xml.matchAll(/content-desc="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  console.log('\n== ' + f + ' ==');
  console.log(ds.join('\n'));
}

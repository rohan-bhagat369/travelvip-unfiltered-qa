import fs from 'fs';

const lines = fs.readFileSync('export_b2b.postman_collection (2).json', 'utf8').split(/\n/);
for (let i = 3695; i < 3800; i++) {
  const line = lines[i] || '';
  if (!line.includes('"raw"')) continue;
  const m = line.match(/"raw":\s*"(.*)"\s*,?\s*$/);
  if (!m) continue;
  let raw = m[1];
  raw = raw
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  const idx = raw.indexOf('"ssr"');
  console.log('LINE', i + 1, 'ssrIdx', idx);
  if (idx >= 0) {
    console.log(raw.slice(Math.max(0, idx - 150), idx + 2500));
  } else {
    console.log(raw.slice(0, 800));
  }
}

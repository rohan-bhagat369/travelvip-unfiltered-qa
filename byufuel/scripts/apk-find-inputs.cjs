#!/usr/bin/env node
const fs = require('fs');
const file = process.argv[2];
const x = fs.readFileSync(file, 'utf8');
const nodes = [...x.matchAll(/<node([^>]+)\/>/g)].map((m) => m[1]);
for (const a of nodes) {
  const get = (k) => {
    const mm = a.match(new RegExp(`${k}="([^"]*)"`));
    return mm ? mm[1] : '';
  };
  const cls = get('class');
  const password = get('password') === 'true';
  const bounds = get('bounds');
  const desc = get('content-desc');
  const text = get('text');
  if (/EditText|TextField/i.test(cls) || password || /email|password|phone/i.test(desc + text)) {
    const bm = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    console.log(JSON.stringify({
      cls,
      password,
      text,
      desc,
      x: bm ? Math.floor((+bm[1] + +bm[3]) / 2) : null,
      y: bm ? Math.floor((+bm[2] + +bm[4]) / 2) : null,
      bounds,
    }));
  }
}

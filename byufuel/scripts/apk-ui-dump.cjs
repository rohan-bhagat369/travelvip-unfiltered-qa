#!/usr/bin/env node
const fs = require('fs');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: apk-ui-dump.cjs <ui.xml>');
  process.exit(1);
}
const x = fs.readFileSync(file, 'utf8');
const nodes = [...x.matchAll(/<(?:node)([^>]+)\/>/g)].map((m) => {
  const attrs = m[1];
  const get = (k) => {
    const mm = attrs.match(new RegExp(`${k}="([^"]*)"`));
    return mm ? mm[1] : '';
  };
  const bounds = get('bounds');
  const bm = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  const text = get('text');
  const desc = get('content-desc').replace(/&#10;/g, '\n');
  if (!bm) return null;
  return {
    text,
    desc,
    clickable: get('clickable') === 'true',
    x: Math.floor((Number(bm[1]) + Number(bm[3])) / 2),
    y: Math.floor((Number(bm[2]) + Number(bm[4])) / 2),
    bounds,
  };
}).filter(Boolean).filter((n) => n.text || n.desc);

console.log(JSON.stringify({
  count: nodes.length,
  labels: nodes.map((n) => ({
    label: (n.text || n.desc).split('\n')[0].slice(0, 80),
    x: n.x,
    y: n.y,
    clickable: n.clickable,
  })),
}, null, 2));

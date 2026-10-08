import fs from 'fs';

const col = JSON.parse(fs.readFileSync('export_b2b.postman_collection (2).json', 'utf8'));

function walk(items, path = []) {
  for (const it of items || []) {
    if (it.item) walk(it.item, [...path, it.name]);
    if (!it.request) continue;
    const name = [...path, it.name].join(' / ');
    if (!/issue.?ticket/i.test(name)) continue;

    const body = it.request?.body?.raw || '';
    if (!body) continue;
    console.log('\n====', name, '====');
    // Find ssr snippet
    const idx = body.indexOf('"ssr"');
    if (idx >= 0) {
      console.log(body.slice(Math.max(0, idx - 200), idx + 1800));
    } else {
      console.log('no ssr in request body, first 500:', body.slice(0, 500));
    }

    for (const r of it.response || []) {
      const rb = r.body || '';
      if (!rb) continue;
      if (/meal|baggage|seat|ssr|ancillary|addon/i.test(rb)) {
        console.log('\n-- RESP', r.name, '--');
        const i2 = rb.search(/ssr|meal|baggage|seat|addon|ancillary/i);
        console.log(rb.slice(Math.max(0, i2 - 100), i2 + 1500));
      }
    }
  }
}

walk(col.item);

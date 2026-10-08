import fs from 'fs';

const col = JSON.parse(fs.readFileSync('export_b2b.postman_collection (2).json', 'utf8'));

function walk(items, path = []) {
  for (const it of items || []) {
    if (it.item) walk(it.item, [...path, it.name]);
    if (!it.request) continue;
    const name = [...path, it.name].join(' / ');
    if (!/issue.?ticket|ssr|seatmap|booking details|fetch booking/i.test(name)) continue;

    const body = it.request?.body?.raw || '';
    if (body.includes('"ssr"') || /"meals"\s*:|"baggage"\s*:|"seats"\s*:/.test(body)) {
      console.log('\n==== REQ', name, '====');
      console.log(body.slice(0, 4000));
      console.log('...LEN', body.length);
    }

    for (const r of it.response || []) {
      const rb = r.body || '';
      if (!rb) continue;
      if (
        /meal|baggage|seat|ssr|ancillary|addon/i.test(rb)
        && /totalAmount|pricing|salesSummary|baseFare/i.test(rb)
      ) {
        console.log('\n==== RESP', name, '::', r.name, '====');
        console.log(rb.slice(0, 3000));
      }
    }
  }
}

walk(col.item);

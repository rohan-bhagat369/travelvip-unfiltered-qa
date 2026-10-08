import fs from 'fs';

const j = JSON.parse(fs.readFileSync('export_b2b.postman_collection (2).json', 'utf8'));

function walk(nodes, path = '') {
  if (!Array.isArray(nodes)) return;
  for (const n of nodes) {
    const name = n.name || '';
    const full = `${path}/${name}`;
    if (/bag|meal|seat|ssr|ancill|issue/i.test(name)) {
      const hasRaw = Boolean(n.request?.body?.raw);
      const exCount = (n.response || []).length;
      if (hasRaw || exCount) {
        console.log(full, '| raw=', hasRaw, '| examples=', exCount);
      }
    }
    // print saved examples with ssr
    for (const ex of n.response || []) {
      const reqBody = ex?.originalRequest?.body?.raw || '';
      const resBody = ex?.body || '';
      if (/ssr|seatNumber|meals|baggage/i.test(reqBody + resBody) && /ticket|issue|ssr|seat/i.test(name + (ex.name || ''))) {
        console.log('\n==== EXAMPLE', full, '::', ex.name, '====');
        if (reqBody.includes('ssr')) {
          try {
            const o = JSON.parse(reqBody);
            console.log('REQUEST passengers ssr:');
            for (const p of o.data?.passengers || []) {
              console.log(p.paxId, JSON.stringify(p.ssr, null, 2));
            }
          } catch {
            const i = reqBody.indexOf('"ssr"');
            console.log('REQUEST ssr snippet:\n', reqBody.slice(i, i + 2000));
          }
        }
      }
    }
    walk(n.item, full);
  }
}

walk(j.item);

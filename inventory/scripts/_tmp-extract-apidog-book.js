import fs from 'fs';

const base =
  'c:/Users/Rohan Bhagat/.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a';

function walk(n, out) {
  if (!n || typeof n !== 'object') return;
  if (n.api && n.api.path) {
    const path = n.api.path;
    const name = n.name || '';
    if (
      /finalize-booking|create-booking|\/booking/.test(path) ||
      /lounge|fasttrack|esim/i.test(name)
    ) {
      const ex = (n.api.requestBody && n.api.requestBody.examples) || [];
      let example = null;
      for (const e of ex) {
        if (!e.value) continue;
        try {
          example =
            typeof e.value === 'string'
              ? JSON.parse(e.value.replace(/\{\{[^}]+\}\}/g, '"__VAR__"'))
              : e.value;
        } catch {
          example = String(e.value).slice(0, 200);
        }
        break;
      }
      out.push({
        name,
        method: n.api.method,
        path,
        example:
          example && typeof example === 'object'
            ? JSON.stringify(example).slice(0, 500)
            : example,
      });
    }
  }
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach((x) => walk(x, out));
    else if (v && typeof v === 'object') walk(v, out);
  }
}

for (const f of [
  'api_services_booking.apidog__2_.json',
  'web_services_bookings.apidog__2_.json',
]) {
  const j = JSON.parse(fs.readFileSync(`${base}/${f}`, 'utf8'));
  const out = [];
  walk(j, out);
  const uniq = [...new Map(out.map((h) => [`${h.method} ${h.path}`, h])).values()];
  console.log('\n##', f, uniq.length);
  for (const h of uniq.filter((x) =>
    /lounge|fasttrack|finalize|create-booking|\/booking/i.test(
      `${x.name || ''}${x.path || ''}`,
    ),
  ).slice(0, 30)) {
    console.log(h.method, h.path, '|', (h.name || '').slice(0, 60));
    if (h.example) console.log('  body', h.example);
  }
}

import fs from 'fs';

const transcript =
  'C:/Users/Rohan Bhagat/.cursor/projects/d-Travel-VIP-API-Automation/agent-transcripts/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a.jsonl';

const targets = new Set([
  'BR1789027856400104',
  'BR1789028629645454',
  'BR1789028742432814',
  'BR1789031847299802',
  'BR1789031824882449',
  'BR1789032091575394',
  'BR1789032360514643',
  'BR1789032488187309',
  'BR1789033098766714',
  'BR1789033354280851',
  'BR1789033392643859',
]);

function extractJsonAfter(sql, marker) {
  const idx = sql.indexOf(marker);
  if (idx < 0) return null;
  // find data JSON: after 5th quoted field pattern ... look for ,'{ starting near VALUES
  // Prefer: booking_id known, then find ,"booking.xxx",'{json}'
  return null;
}

/** Extract balanced JSON object starting at `{` index in s */
function extractBalancedJson(s, startIdx) {
  if (s[startIdx] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return null;
}

function extractInserts(text) {
  const out = [];
  const needle = "INSERT INTO travelx.webhook_events";
  let from = 0;
  while (true) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    // Find VALUES (
    const v = text.indexOf('VALUES', i);
    if (v < 0) break;
    const open = text.indexOf('(', v);
    if (open < 0) break;

    // Parse SQL string literals in VALUES until closing )
    const fields = [];
    let p = open + 1;
    while (p < text.length && fields.length < 7) {
      while (p < text.length && /[\s,]/.test(text[p])) p++;
      if (text[p] === "'") {
        p++;
        let buf = '';
        while (p < text.length) {
          const ch = text[p];
          if (ch === "'" && text[p + 1] === "'") {
            buf += "'";
            p += 2;
            continue;
          }
          if (ch === "'") {
            p++;
            break;
          }
          buf += ch;
          p++;
        }
        fields.push(buf);
      } else {
        // unexpected
        break;
      }
    }
    if (fields.length >= 6) {
      out.push({
        partner: fields[0],
        name: fields[1],
        type: fields[2],
        bookingId: fields[3],
        bookingStatus: fields[4],
        dataRaw: fields[5],
      });
    }
    from = i + needle.length;
  }
  return out;
}

const lines = fs.readFileSync(transcript, 'utf8').split(/\n/).filter(Boolean);
const found = {};

for (const line of lines) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    continue;
  }
  if (o.role !== 'user') continue;
  const t = (o.message?.content || []).map((c) => c.text || '').join('\n');
  if (!t.includes('INSERT INTO travelx.webhook_events')) continue;

  for (const ins of extractInserts(t)) {
    if (!targets.has(ins.bookingId)) continue;
    let data;
    try {
      data = JSON.parse(ins.dataRaw);
    } catch {
      continue;
    }
    if (!data?.event) continue;
    const key = `${ins.bookingId}|${data.event}`;
    if (data.event === 'driver.enroute') {
      if (!found[key]) found[key] = [];
      if (!found[key].some((x) => x.timestamp === data.timestamp)) {
        found[key].push(data);
      }
    } else if (!found[key]) {
      found[key] = data;
    }
  }
}

fs.mkdirSync('tmp', { recursive: true });
const outPath = 'tmp/cab-webhook-extracted-payloads.json';
fs.writeFileSync(outPath, JSON.stringify(found, null, 2));
console.log('keys', Object.keys(found).sort().join('\n'));
console.log('count', Object.keys(found).length);
console.log('wrote', outPath);

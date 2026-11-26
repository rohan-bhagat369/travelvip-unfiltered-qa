import fs from 'fs';
import path from 'path';
import { authenticate } from '../../../shared/lib/authService.js';
import { FlightService } from '../src/service.js';

for (const p of [
  path.join(process.cwd(), '.env'),
  path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/d-Travel-VIP-API-Automation/attachments/9d27dee5-d0e7-4eb0-8b3a-c34ea217457a/nova-api_dev.json',
  ),
]) {
  if (!fs.existsSync(p)) continue;
  if (p.endsWith('.env')) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } else {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const vars = {};
    for (const v of j.environments?.[0]?.variables || []) vars[v.name] = v.value ?? v.initialValue ?? '';
    if (!process.env.PARTNER_SECRET) process.env.PARTNER_SECRET = vars.partner_secret;
    if (!process.env.SIGNING_KEY) process.env.SIGNING_KEY = vars.signing_key;
    if (!process.env.PARTNER_ID) process.env.PARTNER_ID = vars.partner_id || 'vgm';
    if (!process.env.TIER_ID) process.env.TIER_ID = vars.tier_id || '10546901';
  }
}
process.env.BASE_URL = 'https://ak-api.travelvip.ai';

const BRs = ['BR1795606757600786', 'BR1795606672795362'];

function extractPnrs(data) {
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /pnr/i.test(k) && !v.startsWith('BR') && v.length <= 24) {
        for (const p of String(v)
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean)) {
          if (!seen.has(p)) {
            seen.add(p);
            found.push(p);
          }
        }
      }
      walk(v, depth + 1);
    }
  };
  walk(data);
  return found;
}

const { client } = await authenticate(true);
const flight = new FlightService(client);
const rows = [];
for (const br of BRs) {
  const st = await flight.getBookingStatus(br);
  let detail = null;
  try {
    detail = await flight.getBookingDetail(br);
  } catch {
    /* ignore */
  }
  const row = {
    br,
    status: st.data?.status,
    pnrs: [...new Set(extractPnrs(st.data).concat(extractPnrs(detail?.data)))],
  };
  rows.push(row);
  console.log(JSON.stringify(row, null, 2));
}

const out = {
  at: new Date().toISOString(),
  base: process.env.BASE_URL,
  purpose: 'G3 reverify — stopped on Inprogress (final per QA)',
  originalBugBr: 'BR1795177933483097',
  primary: rows[0],
  priorAttempt: rows[1],
  moneyAtIssue: {
    totalAmount: 37302,
    baseFare: 28286,
    taxes: 8666,
    convenienceFee: 350,
    currency: 'INR',
    airline: 'AI',
    fareType: 'NORMAL',
    route: 'DEL-PNQ-DEL',
    lastName: 'Confirmed',
  },
  nexus: 'https://dev-nexus.travelvip.ai/',
};
const outPath = path.join(
  process.cwd(),
  'travel-apis/flight/reports/cancel-bundle-2026-11-20/g3-reverify-fixture.json',
);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Wrote', outPath);

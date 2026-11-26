import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'reports', 'gamma-hotel-callback-stripe');
const latest = JSON.parse(fs.readFileSync(path.join(OUT, 'latest.json'), 'utf8'));

delete latest.partA.results['A1.3'];
if (latest.partA.results['A1.3a_CANCELLED']) {
  latest.partA.results['A1.3'] = latest.partA.results['A1.3a_CANCELLED'];
}
if (latest.partA.results['A4.1']?.estimatedCharge === 0) {
  latest.partA.results['A4.1'].status = 'CHECK';
  latest.partA.results['A4.1'].note =
    'Cancel+callback ignore PASS, but rate was free-cancel (refund>0), not non-refundable ₹0';
}

const files = fs.readdirSync(OUT).filter((f) => f.startsWith('run-')).sort().reverse();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  const b1 = j.partB?.results?.B1;
  if (b1?.br) {
    latest.partB = j.partB;
    break;
  }
}
latest.at = new Date().toISOString();
latest.part = 'FINAL';
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(latest, null, 2));

const A = latest.partA.results;
const B = latest.partB?.results || {};
const counts = { PASS: 0, BUG: 0, CHECK: 0, 'NOT TESTED': 0 };
for (const v of [...Object.values(A), ...Object.values(B)]) {
  if (v === A.A1_3a_CANCELLED) continue;
  counts[v.status] = (counts[v.status] || 0) + 1;
}
// avoid double-count A1.3a
if (A['A1.3a_CANCELLED'] && A['A1.3']) {
  counts[A['A1.3a_CANCELLED'].status] -= 1;
}

const cell = (v) => (v.note || v.callbackMsg || v.after || v.finalStatus || v.stripeStatus || '')
  .toString()
  .replace(/\|/g, '/')
  .slice(0, 90);

let md = '# ENG-902 — Hotel supplier callback + Stripe race (gamma)\n\n';
md += '**Base:** `https://gamma-api.travelvip.ai`  \n';
md += '**Creds:** api-staging vgm (`.env`) · callback `pid/key=smt/palsgcvgscvvs`  \n';
md += `**At:** ${latest.at}\n\n`;
md += '## Counts\n\n';
md += `| PASS | BUG | CHECK | NOT TESTED |\n|---:|---:|---:|---:|\n| ${counts.PASS || 0} | ${counts.BUG || 0} | ${counts.CHECK || 0} | ${counts['NOT TESTED'] || 0} |\n\n`;

md += '## Part A — `updateHotelBooking`\n\n';
md += '| TC | Status | BR | Evidence |\n|---|---|---|---|\n';
for (const [k, v] of Object.entries(A)) {
  if (k === 'A1.3a_CANCELLED') continue;
  md += `| ${k} | **${v.status}** | ${v.br || '-'} | ${cell(v)} |\n`;
}

md += '\n## Part B — Card / Stripe\n\n';
md += '| TC | Status | BR | Evidence |\n|---|---|---|---|\n';
for (const [k, v] of Object.entries(B)) {
  md += `| ${k} | **${v.status}** | ${v.br || v.relatedBr || '-'} | ${cell(v)} |\n`;
}

md += `\n## Notes\n\n`;
md += `- Callback with \`pid=vgm\` + palsg / access_token / partner_secret → HTTP 403 \`INVALID_PARTNER_KEY\`.\n`;
md += `- Callback with \`pid=smt\` + \`palsgcvgscvvs\` works on vgm BRs.\n`;
md += `- Partner webhook delivery: **NOT TESTED** (no receiver evidence).\n`;
md += `- B2 reached terminal without app attach → webhook booking path appears live on gamma.\n`;
md += `- B3 / B8 / B9: **NOT TESTED** (cannot force webhook-first / Stripe replay / known webhook path).\n`;
md += `- \`process_by\` book_api vs webhook: **NOT TESTED** (needs DB).\n`;
md += `- A4.1: non-refundable inventory not hit; free-cancel cancel + ignore-callback verified.\n`;
md += `- Probe: \`travel-apis/hotel/scripts/probe-gamma-hotel-callback-stripe.js\` + \`probe-gamma-hotel-callback-partA-continue.js\`.\n`;

fs.writeFileSync(path.join(OUT, 'ENG-902-REPORT.md'), md);
console.log(md);
console.log('counts', counts);

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

const CORR = 'qa-otel-eng22-pm-20260917f-airports';
const envPath = path.join('reports', '_tmp-zenith-newman.env.json');
const colPath = path.join('reports', '_tmp-zenith-newman.collection.json');
const srcCol = path.join(process.cwd(), 'export_b2b.postman_collection (2).json');

const env = {
  id: 'tmp-zenith-newman',
  name: 'TravelVIP B2B Dev → zenith',
  values: [
    { key: 'base_url', value: 'https://zenith-api.travelvip.ai', enabled: true },
    { key: 'partner_id', value: process.env.PARTNER_ID, enabled: true },
    { key: 'partner_secret', value: process.env.PARTNER_SECRET, enabled: true },
    { key: 'signing_key', value: process.env.SIGNING_KEY, enabled: true },
    { key: 'tier_id', value: process.env.TIER_ID || '10546901', enabled: true },
    { key: 'correlation_id', value: CORR, enabled: true },
    { key: 'access_token', value: '', enabled: true },
    { key: 'refresh_token', value: '', enabled: true },
    { key: 'auth_token', value: '', enabled: true },
    { key: 'timestamp', value: '', enabled: true },
    { key: 'signature', value: '', enabled: true },
    { key: 'request_id', value: '', enabled: true },
  ],
};
fs.writeFileSync(envPath, JSON.stringify(env, null, 2));

const col = JSON.parse(fs.readFileSync(srcCol, 'utf8'));
function walk(items) {
  for (const it of items || []) {
    if (it.event) {
      for (const ev of it.event) {
        if (ev.listen === 'prerequest' && Array.isArray(ev.script?.exec)) {
          ev.script.exec = ev.script.exec.map((line) =>
            line.includes('pm.request.body.raw')
              ? 'const body = (pm.request.body && pm.request.body.raw) || "";'
              : line,
          );
        }
      }
    }
    if (it.request?.header) {
      for (const h of it.request.header) {
        if (String(h.key).toLowerCase() === 'x-correlation-id') {
          h.disabled = false;
          h.value = CORR;
        }
      }
      const hasPartner = it.request.header.some((h) => String(h.key).toLowerCase() === 'x-partner-key');
      if (!hasPartner && it.name !== 'Access Token') {
        it.request.header.push({ key: 'X-Partner-Key', value: '{{access_token}}' });
      }
    }
    if (it.item) walk(it.item);
  }
}
function findByName(items, name) {
  for (const it of items || []) {
    if (it.name === name) return it;
    const nested = findByName(it.item, name);
    if (nested) return nested;
  }
  return null;
}
walk(col.item);
const slim = {
  info: { name: 'ENG-22 zenith Postman smoke', schema: col.info.schema },
  item: [
    findByName(col.item, 'Access Token'),
    findByName(col.item, 'User Auth'),
    findByName(col.item, 'Airport Search'),
  ].filter(Boolean),
};
fs.writeFileSync(colPath, JSON.stringify(slim));

const r = spawnSync(
  'newman',
  [
    'run',
    colPath,
    '-e',
    envPath,
    '--reporters',
    'cli,json',
    '--reporter-json-export',
    path.join('reports', 'zenith-otel-eng22-newman.json'),
    '--timeout-request',
    '30000',
  ],
  { encoding: 'utf8', shell: true },
);
console.log(r.stdout || '');
if (r.stderr) console.error(r.stderr);
console.log(JSON.stringify({ corr: CORR, exit: r.status }));
fs.unlinkSync(envPath);
fs.unlinkSync(colPath);
process.exit(r.status || 0);

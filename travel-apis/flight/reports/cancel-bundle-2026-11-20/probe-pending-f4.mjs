/**
 * F4 probe: confirm second-partner creds missing; dummy partner auth fails (not mismatch).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../../../../shared/lib/authService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

process.env.BASE_URL = 'https://ak-api.travelvip.ai';

const out = {
  at: new Date().toISOString(),
  hasPartner2: Boolean(process.env.PARTNER_ID_2 && process.env.PARTNER_SECRET_2),
  partner1: process.env.PARTNER_ID || null,
};

try {
  const a1 = await authenticate();
  out.vgmAuth = {
    ok: Boolean(a1?.authToken || a1?.token || a1?.accessToken),
    keys: Object.keys(a1 || {}).filter((k) => !/secret|token|key/i.test(k)),
  };
} catch (e) {
  out.vgmAuth = { ok: false, err: String(e.message || e).slice(0, 200) };
}

const savedId = process.env.PARTNER_ID;
const savedSecret = process.env.PARTNER_SECRET;
process.env.PARTNER_ID = 'not-a-real-partner';
process.env.PARTNER_SECRET = 'fake-secret-for-f4-probe';
try {
  const a2 = await authenticate();
  out.fakePartnerAuth = {
    ok: Boolean(a2?.authToken || a2?.token || a2?.accessToken),
    errorCode: a2?.error?.code || a2?.code || null,
    status: a2?.status || null,
    message: String(a2?.error?.message || a2?.message || '').slice(0, 160),
  };
} catch (e) {
  out.fakePartnerAuth = { ok: false, err: String(e.message || e).slice(0, 200) };
}
process.env.PARTNER_ID = savedId;
process.env.PARTNER_SECRET = savedSecret;

const dest = path.join(__dirname, 'pending-f4-probe.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

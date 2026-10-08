/**
 * Prod: description / inclusion / exclusion on hotel details + prebook.
 * Search → details → prebook only. NEVER finalize / book.
 *
 *   HOTEL_CITIES=all|india-a|india-b|intl
 */
import fs from 'fs';
import path from 'path';
import { authenticate, clearSession } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { extractRequestId } from '../src/helpers.js';

process.env.BASE_URL = process.env.BASE_URL || 'https://api.travelvip.ai';
process.env.PARTNER_ID = process.env.PARTNER_ID || 'vgm';
process.env.PARTNER_SECRET = process.env.PARTNER_SECRET || 'vgm_preprod_ojny1swtigd4as';
process.env.SIGNING_KEY = process.env.SIGNING_KEY || 'sk_live_yg81bca5xno1ypvhla';
process.env.TIER_ID = process.env.TIER_ID || '19597201';

const PID = 'vgm';
const CHECKIN = process.env.HOTEL_CHECKIN || '2026-10-15';
const CHECKOUT = process.env.HOTEL_CHECKOUT || '2026-10-16';
const PER_CITY = Number(process.env.PER_CITY || 10);
const MODE = String(process.env.HOTEL_CITIES || 'all').toLowerCase();

const GROUPS = {
  'india-a': [
    { key: 'Mumbai', entityId: '357389:IN' },
    { key: 'Delhi', entityId: '227760:IN' },
    { key: 'Bengaluru', entityId: '341153:IN' },
  ],
  'india-b': [
    { key: 'Hyderabad', entityId: '227706:IN' },
    { key: 'Chennai', entityId: '228269:IN' },
    { key: 'Pune', entityId: '328605:IN' },
  ],
  intl: [
    { key: 'Dubai', entityId: '221688:AE' },
    { key: 'Singapore', entityId: '246673:SG' },
    { key: 'Bangkok', entityId: '328619:TH' },
  ],
};
GROUPS.all = [...GROUPS['india-a'], ...GROUPS['india-b'], ...GROUPS.intl];
const CITIES = GROUPS[MODE] || GROUPS.all;
const OUT_SLUG = `hotel-desc-incl-excl-prod-${MODE}`;
const OUT_JSON = path.join('reports', `${OUT_SLUG}.json`);
const OUT_MD = path.join('reports', `${OUT_SLUG}.md`);

const DESC_KEYS = /^(description|hotelDescription|roomDescription)$/i;
const INCL_KEYS = /^(inclusion|inclusions)$/i;
const EXCL_KEYS = /^(exclusion|exclusions)$/i;

function isPresent(v) {
  if (v == null) return false;
  if (typeof v === 'boolean' || typeof v === 'number') return true;
  if (typeof v === 'string') {
    const t = v.trim();
    return t !== '' && t.toLowerCase() !== 'null' && t !== '[]';
  }
  if (Array.isArray(v)) return v.some(isPresent);
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function snippet(v, n = 90) {
  if (!isPresent(v)) return '';
  const s = Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' | ')
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v);
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

function collectFields(node, acc = [], pathStr = '') {
  if (!node || typeof node !== 'object') return acc;
  const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
  for (const k of keys) {
    const v = node[k];
    const p = pathStr ? `${pathStr}.${k}` : String(k);
    const kn = String(k);
    if (DESC_KEYS.test(kn) || INCL_KEYS.test(kn) || EXCL_KEYS.test(kn)) {
      acc.push({
        path: p,
        key: kn,
        kind: DESC_KEYS.test(kn) ? 'description' : INCL_KEYS.test(kn) ? 'inclusion' : 'exclusion',
        present: isPresent(v),
        snippet: snippet(v),
      });
    }
    if (v && typeof v === 'object') collectFields(v, acc, p);
  }
  return acc;
}

function pickKind(hits, kind) {
  const list = hits.filter((h) => h.kind === kind);
  const present = list.find((h) => h.present);
  return {
    present: Boolean(present),
    missing: list.length === 0,
    nullOrEmpty: list.length > 0 && !present,
    snippet: present?.snippet || '',
    paths: list.slice(0, 6).map((h) => `${h.path}=${h.present ? 'Y' : 'N'}`),
  };
}

function summarize(data) {
  const hits = collectFields(data);
  return {
    description: pickKind(hits, 'description'),
    inclusion: pickKind(hits, 'inclusion'),
    exclusion: pickKind(hits, 'exclusion'),
  };
}

function flag(f) {
  if (!f) return 'missing';
  if (f.present) return 'present';
  if (f.nullOrEmpty) return 'null';
  return 'missing';
}

const SKIP_SNAPSHOT = new Set([
  'rooms', 'images', 'image', 'bookingCode', 'bookingContext', '_meta', 'requestId',
]);
const NEST_ONE = new Set([
  'price', 'cancellation', 'cancellationPolicy', 'board', 'gst', 'gstDetails', 'occupancy', 'hotelReview',
]);

function snapshotObject(obj, prefix = '', depth = 0) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_SNAPSHOT.has(k)) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1 && NEST_ONE.has(k)) {
      Object.assign(out, snapshotObject(v, p, depth + 1));
      continue;
    }
    let state = 'present';
    if (v == null) state = 'null';
    else if (typeof v === 'string' && v.trim() === '') state = 'empty';
    else if (Array.isArray(v) && v.length === 0) state = 'empty';
    else if (!isPresent(v)) state = 'null';
    out[p] = {
      state,
      present: state === 'present',
      snippet: state === 'present' ? snippet(v, 60) : '',
    };
  }
  return out;
}

function snapshotPayload(data, selectedRoom) {
  const hotelObj = data?.results?.[0] || data?.hotel || data?.content?.[0] || null;
  const room = selectedRoom
    || hotelObj?.rooms?.find((r) => r?.bookingCode && r.available !== false)
    || hotelObj?.rooms?.[0]
    || data?.room
    || null;
  return {
    ...snapshotObject(hotelObj, 'hotel'),
    ...snapshotObject(room, 'room'),
  };
}

function classifyFields(rows, mapKey) {
  const names = new Set();
  for (const r of rows) {
    Object.keys(r[mapKey] || {}).forEach((k) => names.add(k));
  }
  const stats = [];
  for (const field of [...names].sort()) {
    let present = 0;
    let nullish = 0;
    let missing = 0;
    const examples = { present: [], nullish: [] };
    for (const r of rows) {
      const info = r[mapKey]?.[field];
      if (!info) {
        missing += 1;
        continue;
      }
      if (info.present) {
        present += 1;
        if (examples.present.length < 2) examples.present.push(`${r.hotelName} (${r.hotelId})`);
      } else {
        nullish += 1;
        if (examples.nullish.length < 2) examples.nullish.push(`${r.hotelName} (${r.hotelId})`);
      }
    }
    let bucket = 'ALWAYS_PRESENT';
    if (present === 0) bucket = 'ALWAYS_NULL_OR_EMPTY';
    else if (nullish > 0 || missing > 0) bucket = 'MIXED';
    stats.push({
      field, present, nullish, missing, bucket, n: rows.length,
      examplePresent: examples.present[0] || '',
      exampleNull: examples.nullish[0] || '',
    });
  }
  return stats;
}

function citySearchBody(entityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(entityId),
    nationality: 'IN',
    type: 'CITY',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
    currency: 'INR',
    lang: 'en',
    language: 'en',
    pid: PID,
    rt: 'compact',
    filters: { refundable: 0, noOfRooms: 0, mealType: 0 },
    fq: [],
    requestId: '',
  };
}

function hotelSearchBody(entityId) {
  return {
    checkin: CHECKIN,
    checkout: CHECKOUT,
    entityId: String(entityId),
    nationality: 'IN',
    type: 'HOTEL',
    rooms: [{ adults: 1, children: 0, childrenAges: [] }],
  };
}

function writeReport(rows, citySummaries) {
  const detailsOk = rows.filter((r) => r.detailsOk);
  const prebookOk = rows.filter((r) => r.prebookOk);
  const count = (list, api, field, want) =>
    list.filter((r) => flag(r[api]?.[field]) === want).length;

  const summary = {
    noBook: true,
    base: process.env.BASE_URL,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    hotels: rows.length,
    detailsOk: detailsOk.length,
    prebookOk: prebookOk.length,
    details: {
      descriptionPresent: count(detailsOk, 'detailsFields', 'description', 'present'),
      descriptionNull: count(detailsOk, 'detailsFields', 'description', 'null'),
      descriptionMissing: count(detailsOk, 'detailsFields', 'description', 'missing'),
      inclusionPresent: count(detailsOk, 'detailsFields', 'inclusion', 'present'),
      inclusionNull: count(detailsOk, 'detailsFields', 'inclusion', 'null'),
      inclusionMissing: count(detailsOk, 'detailsFields', 'inclusion', 'missing'),
      exclusionPresent: count(detailsOk, 'detailsFields', 'exclusion', 'present'),
      exclusionNull: count(detailsOk, 'detailsFields', 'exclusion', 'null'),
      exclusionMissing: count(detailsOk, 'detailsFields', 'exclusion', 'missing'),
    },
    prebook: {
      descriptionPresent: count(prebookOk, 'prebookFields', 'description', 'present'),
      descriptionNull: count(prebookOk, 'prebookFields', 'description', 'null'),
      descriptionMissing: count(prebookOk, 'prebookFields', 'description', 'missing'),
      inclusionPresent: count(prebookOk, 'prebookFields', 'inclusion', 'present'),
      inclusionNull: count(prebookOk, 'prebookFields', 'inclusion', 'null'),
      inclusionMissing: count(prebookOk, 'prebookFields', 'inclusion', 'missing'),
      exclusionPresent: count(prebookOk, 'prebookFields', 'exclusion', 'present'),
      exclusionNull: count(prebookOk, 'prebookFields', 'exclusion', 'null'),
      exclusionMissing: count(prebookOk, 'prebookFields', 'exclusion', 'missing'),
    },
    citySummaries,
    detailsFieldMatrix: classifyFields(detailsOk, 'detailsMap'),
    prebookFieldMatrix: classifyFields(prebookOk, 'prebookMap'),
  };

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 2));

  const md = [];
  md.push('# Prod hotel description / inclusion / exclusion (details + prebook)');
  md.push('');
  md.push(`- Base: \`${process.env.BASE_URL}\``);
  md.push(`- Stay: **${CHECKIN} → ${CHECKOUT}**`);
  md.push('- Flow: CITY search → HOTEL details → prebook. **No book.**');
  md.push(`- Hotels checked: **${summary.hotels}**`);
  md.push('');
  md.push('## Score');
  md.push('');
  md.push('| API | Field | Present | Null/empty | Missing key |');
  md.push('|-----|-------|---------|------------|-------------|');
  for (const api of ['details', 'prebook']) {
    for (const field of ['description', 'inclusion', 'exclusion']) {
      const s = summary[api];
      md.push(
        `| ${api} | ${field} | **${s[`${field}Present`]}** | ${s[`${field}Null`]} | ${s[`${field}Missing`]} |`,
      );
    }
  }
  md.push('');
  md.push('## Per city');
  md.push('');
  md.push('| City | Hotels | Det desc | Det incl | Det excl | Pre desc | Pre incl | Pre excl |');
  md.push('|------|--------|----------|----------|----------|----------|----------|----------|');
  for (const c of citySummaries) {
    md.push(
      `| ${c.city} | ${c.hotelsTried} | ${c.detailsDesc}/${c.hotelsTried} | ${c.detailsIncl}/${c.hotelsTried} | ${c.detailsExcl}/${c.hotelsTried} | ${c.prebookDesc}/${c.hotelsTried} | ${c.prebookIncl}/${c.hotelsTried} | ${c.prebookExcl}/${c.hotelsTried} |`,
    );
  }
  md.push('');
  const matrixBlock = (title, matrix) => {
    md.push(`## ${title}`);
    md.push('');
    md.push('| Field | Present | Null/empty | Key missing | Pattern | Example present | Example null |');
    md.push('|-------|---------|------------|-------------|---------|-----------------|--------------|');
    const interesting = (matrix || []).filter((s) => s.bucket !== 'ALWAYS_PRESENT');
    for (const s of interesting) {
      md.push(
        `| \`${s.field}\` | ${s.present} | ${s.nullish} | ${s.missing} | **${s.bucket}** | ${String(s.examplePresent).replace(/\|/g, '/')} | ${String(s.exampleNull).replace(/\|/g, '/')} |`,
      );
    }
    if (!interesting.length) md.push('| _(all scanned fields always present)_ | | | | | | |');
    md.push('');
  };
  matrixBlock('Details — properties always null or mixed', summary.detailsFieldMatrix);
  matrixBlock('Prebook — properties always null or mixed', summary.prebookFieldMatrix);

  md.push('## Hotels (description / inclusion / exclusion)');
  md.push('');
  md.push('| # | City | Hotel | entityId | Det desc | Det incl | Det excl | Pre desc | Pre incl | Pre excl |');
  md.push('|---|------|-------|----------|----------|----------|----------|----------|----------|----------|');
  rows.forEach((r, i) => {
    const cell = (api, field) => {
      const f = r[api]?.[field];
      const st = flag(f);
      if (st === 'present') return 'Y';
      if (st === 'null') return 'null';
      return 'N';
    };
    md.push(
      `| ${i + 1} | ${r.city} | ${String(r.hotelName).replace(/\|/g, '/')} | \`${r.hotelId}\` | ${cell('detailsFields', 'description')} | ${cell('detailsFields', 'inclusion')} | ${cell('detailsFields', 'exclusion')} | ${cell('prebookFields', 'description')} | ${cell('prebookFields', 'inclusion')} | ${cell('prebookFields', 'exclusion')} |`,
    );
  });
  fs.writeFileSync(OUT_MD, md.join('\n'));
  return summary;
}

async function main() {
  console.log('=== Prod hotel description/inclusion/exclusion (details + prebook, NO BOOK) ===');
  console.log('BASE', process.env.BASE_URL, CHECKIN, '→', CHECKOUT, 'cities', MODE);
  clearSession();
  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const hotel = new HotelService(session.client);

  const rows = [];
  const citySummaries = [];

  for (const city of CITIES) {
    const entityId = city.entityId;
    console.log(`\n## ${city.key} entityId=${entityId}`);
    const search = await hotel.search(citySearchBody(entityId), { pid: PID, page: 0, perpage: 20 });
    const hotels = (search.data?.results || [])
      .filter((h) => h?.id && h.available !== false)
      .slice(0, PER_CITY);
    console.log(`  city search http=${search.status} n=${hotels.length}`);

    for (const h of hotels) {
      const row = {
        city: city.key,
        cityEntityId: entityId,
        hotelId: String(h.id),
        hotelName: h.name || '',
        detailsOk: false,
        prebookOk: false,
        prebookHttp: null,
        detailsFields: null,
        prebookFields: null,
        detailsMap: {},
        prebookMap: {},
        note: '',
      };
      try {
        const det = await hotel.getDetails(hotelSearchBody(h.id));
        row.detailsOk = Boolean(det.ok);
        row.detailsFields = summarize(det.data);
        const requestId = extractRequestId(det.data);
        const rooms = det.data?.results?.[0]?.rooms || [];
        const room = rooms.find((r) => r?.bookingCode && r.available !== false);
        row.detailsMap = snapshotPayload(det.data, room);
        if (!det.ok) {
          row.note = `details http=${det.status}`;
        } else if (!requestId || !room?.bookingCode) {
          row.note = !requestId ? 'details missing requestId' : 'no bookable room';
        } else {
          const pre = await hotel.prebook({ bookingCode: room.bookingCode, requestId });
          row.prebookHttp = pre.status;
          row.prebookOk = Boolean(pre.ok);
          row.prebookFields = summarize(pre.data);
          row.prebookMap = snapshotPayload(pre.data, null);
          if (!pre.ok) row.note = `prebook http=${pre.status}`.slice(0, 120);
        }
      } catch (e) {
        row.note = String(e?.message || e).slice(0, 200);
      }
      const d = row.detailsFields || {};
      const p = row.prebookFields || {};
      console.log(
        `  ${String(h.name || '').slice(0, 36).padEnd(36)} det D/I/E=${flag(d.description)[0]}/${flag(d.inclusion)[0]}/${flag(d.exclusion)[0]}  pre D/I/E=${flag(p.description)[0]}/${flag(p.inclusion)[0]}/${flag(p.exclusion)[0]}  ${row.hotelId}`,
      );
      rows.push(row);
    }

    const cityRows = rows.filter((r) => r.city === city.key);
    citySummaries.push({
      city: city.key,
      entityId,
      hotelsTried: cityRows.length,
      detailsDesc: cityRows.filter((r) => flag(r.detailsFields?.description) === 'present').length,
      detailsIncl: cityRows.filter((r) => flag(r.detailsFields?.inclusion) === 'present').length,
      detailsExcl: cityRows.filter((r) => flag(r.detailsFields?.exclusion) === 'present').length,
      prebookDesc: cityRows.filter((r) => flag(r.prebookFields?.description) === 'present').length,
      prebookIncl: cityRows.filter((r) => flag(r.prebookFields?.inclusion) === 'present').length,
      prebookExcl: cityRows.filter((r) => flag(r.prebookFields?.exclusion) === 'present').length,
    });
  }

  const summary = writeReport(rows, citySummaries);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Wrote', OUT_MD, OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

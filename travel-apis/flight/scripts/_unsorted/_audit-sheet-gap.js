import fs from 'fs';
import XLSX from 'xlsx';

/** Known scores from API/SQL work this pack (agent marks — may not be in sheet yet) */
const KNOWN = {
  // B01
  V001: 'PASS', V002: 'FAIL', V003: 'FAIL', V004: 'FAIL', V005: 'PASS', V006: 'PASS', V007: 'FAIL', V008: 'FAIL',
  // B02
  V009: 'PASS', V010: 'PASS', V011: 'PASS', V012: 'FAIL',
  // B03
  V013: 'PASS', V014: 'FAIL', V015: 'PASS',
  // B04
  V016: 'FAIL', V017: 'PASS',
  // B05
  V018: 'PASS', V019: 'PASS', V020: 'FAIL',
  // B06
  V021: 'BLOCKED', V022: 'BLOCKED', V023: 'BLOCKED', V024: 'BLOCKED', V025: 'BLOCKED', V026: 'BLOCKED', V027: 'BLOCKED',
  // B07
  V028: 'PASS', V029: 'PASS', V030: 'PASS', V031: 'N-A', V032: 'PASS',
  // B08 — SQL pending from user in some runs; earlier sheet had Pass for V033/34
  V033: 'PENDING_SQL', V034: 'PENDING_SQL', V035: 'PENDING_SQL',
  // B09/B10
  V036: 'BLOCKED', V037: 'BLOCKED', V038: 'BLOCKED', V039: 'BLOCKED', V040: 'BLOCKED', V041: 'BLOCKED', V042: 'NOT_TESTED', // schema can run
  // P01
  V043: 'PASS', V044: 'PASS',
  // P02
  V045: 'BLOCKED', V046: 'BLOCKED', V047: 'FAIL', V048: 'BLOCKED', // V047 schema fail can mark without split
  // P03
  V049: 'PASS', V050: 'PASS',
  // C01
  V051: 'FAIL', V052: 'FAIL', V053: 'FAIL', V054: 'FAIL', V055: 'FAIL', V056: 'FAIL', V057: 'FAIL', V058: 'FAIL',
  V059: 'FAIL', V060: 'FAIL', V061: 'FAIL', V062: 'FAIL', V063: 'FAIL',
  // C02
  V064: 'BLOCKED', V065: 'BLOCKED', V066: 'BLOCKED',
  // C03
  V067: 'PASS', V068: 'FAIL', V069: 'PASS', V070: 'PASS',
  // C04
  V071: 'PASS', V072: 'FAIL', V073: 'PASS',
  // C05-C09 / R01 etc — many blocked or not tested
  V074: 'BLOCKED', V075: 'BLOCKED',
  V076: 'BLOCKED', V077: 'BLOCKED',
  V078: 'BLOCKED', V079: 'BLOCKED',
  V080: 'BLOCKED', V081: 'BLOCKED', V082: 'BLOCKED', V083: 'BLOCKED', V084: 'NOT_TESTED', // C09
  V085: 'NOT_TESTED', V086: 'NOT_TESTED', V087: 'NOT_TESTED', V088: 'NOT_TESTED', // R01
  V089: 'FAIL', V090: 'FAIL', V091: 'FAIL', V092: 'FAIL', V093: 'FAIL',
  V094: 'NOT_TESTED', V095: 'NOT_TESTED', // X01
};

const wb = XLSX.readFile('c:/Users/Rohan Bhagat/Downloads/TravelVIP_Flight_DB_TestCases.xlsx');
const vRows = XLSX.utils.sheet_to_json(wb.Sheets['DB Verifications'], { defval: '' });

function normalizeSheet(status) {
  const s = String(status || '').trim().toUpperCase();
  if (!s) return 'EMPTY';
  if (s.includes('BLOCK')) return 'BLOCKED';
  if (s.includes('N-A') || s.includes('N/A') || s === 'NA') return 'N-A';
  if (s.includes('PARTIAL') || (s.includes('PASS') && s.includes('FAIL'))) return 'PARTIAL';
  if (s.startsWith('PASS') || s === 'PASS') return 'PASS';
  if (s.includes('FAIL')) return 'FAIL';
  if (s.includes('PENDING') || s.includes('NEED')) return 'PENDING_MARK';
  return s;
}

function isFilled(sheetNorm) {
  return sheetNorm !== 'EMPTY';
}

function isDecisiveKnown(k) {
  return ['PASS', 'FAIL', 'BLOCKED', 'N-A', 'PARTIAL'].includes(k);
}

const testedNotUpdated = [];
const pendingDrive = [];
const sheetFilled = [];
const mismatch = [];

for (const r of vRows) {
  const id = r['Check ID'];
  const sheet = normalizeSheet(r.Status);
  const known = KNOWN[id] || 'UNKNOWN';
  const row = {
    id,
    scenario: r.Scenario,
    sheet: sheet === 'EMPTY' ? '' : r.Status,
    sheetNorm: sheet,
    known,
    expected: String(r['Expected DB state'] || '').slice(0, 80),
  };

  if (isFilled(sheet)) {
    sheetFilled.push(row);
    if (isDecisiveKnown(known) && sheet !== known && !(sheet === 'PARTIAL' && known === 'FAIL')) {
      // soft: PASS vs Pass ok already normalized
      if (sheet !== known) mismatch.push(row);
    }
  } else if (isDecisiveKnown(known)) {
    testedNotUpdated.push(row);
  } else {
    pendingDrive.push(row);
  }
}

const out = {
  sheetFilledCount: sheetFilled.length,
  testedNotUpdatedCount: testedNotUpdated.length,
  pendingDriveCount: pendingDrive.length,
  mismatchCount: mismatch.length,
  testedNotUpdated,
  pendingDrive,
  mismatch,
  sheetFilledIds: sheetFilled.map((r) => `${r.id}:${r.sheetNorm}`),
};

fs.writeFileSync('reports/db-sheet-gap-audit.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  sheetFilledCount: out.sheetFilledCount,
  testedNotUpdatedCount: out.testedNotUpdatedCount,
  pendingDriveCount: out.pendingDriveCount,
  mismatchCount: out.mismatchCount,
  testedNotUpdatedByScenario: group(testedNotUpdated),
  pendingByScenario: group(pendingDrive),
  sheetFilledByScenario: group(sheetFilled),
  mismatch: mismatch.map((m) => `${m.id} sheet=${m.sheetNorm} known=${m.known}`),
}, null, 2));

function group(rows) {
  const g = {};
  for (const r of rows) {
    g[r.scenario] = g[r.scenario] || [];
    g[r.scenario].push(`${r.id}(${r.known || r.sheetNorm})`);
  }
  return g;
}

/**
 * X01 optimistic lock (V094/V095) — prepares fixture + SQL.
 * Optional auto-run if MYSQL_* env vars are set:
 *   MYSQL_HOST MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE[=travelx] MYSQL_PORT[=3306]
 *
 *   BASE_URL=https://api-staging.travelvip.ai node scripts/probe-db-x01-optimistic-lock.js
 *   BOOKING_REF=BR1786538901965364 node scripts/probe-db-x01-optimistic-lock.js
 */
import fs from 'fs';
import { spawnSync } from 'child_process';
import { authenticate, clearSession } from '../../../../shared/lib/authService.js';
import { FlightService } from '../../src/service.js';
import { config } from '../../../../shared/config/env.js';

const OUT = 'reports/db-x01-optimistic-lock.json';
const SQL_OUT = 'reports/db-x01-optimistic-lock.sql';
const BR = process.env.BOOKING_REF || 'BR1786538901965364';

function score(aRows, bRows, vBefore, vAfterA, vFinal) {
  const v094 = Number(aRows) === 1 && Number(vAfterA) === Number(vBefore) + 1;
  const v095 = Number(bRows) === 0 && Number(vFinal) === Number(vBefore) + 1;
  return {
    V094: {
      id: 'V094',
      scenario: 'X01',
      how: 'Writer A UPDATE WHERE version=v',
      expected: '1 row affected; version becomes v+1',
      actual: `aRows=${aRows} version ${vBefore}->${vAfterA}`,
      status: v094 ? 'PASS' : 'BUG',
    },
    V095: {
      id: 'V095',
      scenario: 'X01',
      how: 'Writer B UPDATE WHERE version=stale v',
      expected: '0 rows affected; no overwrite',
      actual: `bRows=${bRows} version_final=${vFinal}`,
      status: v095 ? 'PASS' : 'BUG',
    },
  };
}

function buildSql(br) {
  return `-- X01 / V094 / V095 — optimistic lock on booking_item
USE travelx;

SET @br := '${br}';

SELECT bi.id AS booking_item_id, bi.version AS version_before, b.booking_reference
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

SELECT bi.id, bi.version INTO @bi_id, @v
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
LIMIT 1;

SELECT @bi_id AS booking_item_id, @v AS version_read_by_A_and_B;

-- V094 Writer A
UPDATE booking_item SET version = version + 1 WHERE id = @bi_id AND version = @v;
SELECT ROW_COUNT() AS writer_A_rows_affected;
SELECT id, version AS version_after_A FROM booking_item WHERE id = @bi_id;

-- V095 Writer B (stale @v)
UPDATE booking_item SET version = version + 1 WHERE id = @bi_id AND version = @v;
SELECT ROW_COUNT() AS writer_B_rows_affected;
SELECT id, version AS version_final FROM booking_item WHERE id = @bi_id;
`;
}

function tryMysqlAuto() {
  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE || 'travelx';
  const port = process.env.MYSQL_PORT || '3306';
  if (!host || !user) return null;

  const sql = `
USE ${database};
SET @br := '${BR}';
SELECT bi.id, bi.version INTO @bi_id, @v
FROM booking_item bi JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br LIMIT 1;
SELECT @bi_id AS bi_id, @v AS v_before;
UPDATE booking_item SET version = version + 1 WHERE id = @bi_id AND version = @v;
SELECT ROW_COUNT() AS a_rows;
SELECT version INTO @v_after_a FROM booking_item WHERE id = @bi_id;
SELECT @v_after_a AS v_after_a;
UPDATE booking_item SET version = version + 1 WHERE id = @bi_id AND version = @v;
SELECT ROW_COUNT() AS b_rows;
SELECT version INTO @v_final FROM booking_item WHERE id = @bi_id;
SELECT @v_final AS v_final;
`.trim();

  const args = ['-h', host, '-P', port, '-u', user, database, '-e', sql, '-N', '-B'];
  if (password) args.splice(4, 0, `-p${password}`);
  const res = spawnSync('mysql', args, { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    return {
      ran: true,
      ok: false,
      error: res.error?.message || res.stderr || res.stdout,
    };
  }
  // Parse -N -B lines: bi_id\tv_before, a_rows, v_after_a, b_rows, v_final
  const lines = String(res.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Expected order of SELECTs
  let biId; let vBefore; let aRows; let vAfterA; let bRows; let vFinal;
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length === 2 && !biId) {
      biId = parts[0];
      vBefore = parts[1];
    } else if (aRows == null && parts.length === 1 && /^\d+$/.test(parts[0]) && vAfterA == null && !line.includes('.')) {
      // could be a_rows or later — assign in order
      if (aRows == null) aRows = parts[0];
      else if (vAfterA == null) vAfterA = parts[0];
      else if (bRows == null) bRows = parts[0];
      else if (vFinal == null) vFinal = parts[0];
    } else if (parts.length === 1) {
      if (aRows == null) aRows = parts[0];
      else if (vAfterA == null) vAfterA = parts[0];
      else if (bRows == null) bRows = parts[0];
      else if (vFinal == null) vFinal = parts[0];
    }
  }
  return {
    ran: true,
    ok: true,
    raw: res.stdout,
    parsed: { biId, vBefore, aRows, vAfterA, bRows, vFinal },
    checks: score(aRows, bRows, vBefore, vAfterA, vFinal),
  };
}

async function main() {
  clearSession();
  console.log('Base', config.baseUrl);
  console.log('X01 fixture BR', BR);

  const session = await authenticate(true);
  session.client.setPartnerKey(session.accessToken);
  const flight = new FlightService(session.client);
  const detail = await flight.getBookingDetail(BR);
  const apiStatus = detail.data?.status;

  const sql = buildSql(BR);
  fs.writeFileSync(SQL_OUT, sql);

  let auto = null;
  try {
    auto = tryMysqlAuto();
  } catch (e) {
    auto = { ran: true, ok: false, error: e.message };
  }

  const report = {
    ranAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    scenario: 'X01',
    checks: ['V094', 'V095'],
    fixture: {
      br: BR,
      apiStatus,
      note: 'booking_item.id + version must come from DB SELECT in SQL',
    },
    interpretation: {
      V094: "Writer A's versioned UPDATE (WHERE version=v) succeeds; version becomes v+1",
      V095: "Writer B's UPDATE (WHERE version=v stale) affects 0 rows; no lost update",
    },
    sqlFile: SQL_OUT,
    autoMysql: auto,
    results: auto?.checks || {
      V094: {
        id: 'V094', scenario: 'X01', status: 'NOT_TESTED',
        expected: 'A succeeds; version v→v+1',
        actual: 'No MYSQL_* creds / mysql CLI — paste reports/db-x01-optimistic-lock.sql in phpMyAdmin',
      },
      V095: {
        id: 'V095', scenario: 'X01', status: 'NOT_TESTED',
        expected: 'B affects 0 rows',
        actual: 'No MYSQL_* creds / mysql CLI — paste SQL and report ROW_COUNT for B',
      },
    },
    howToRun: [
      '1. Open phpMyAdmin → travelx',
      `2. Run reports/db-x01-optimistic-lock.sql (fixture ${BR})`,
      '3. Confirm writer_A_rows_affected=1 and writer_B_rows_affected=0',
      '4. Or set MYSQL_HOST/USER/PASSWORD and re-run this script for auto PASS/BUG',
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    fixture: report.fixture,
    results: report.results,
    autoMysql: auto?.ran ? { ok: auto.ok, error: auto.error || null, parsed: auto.parsed } : 'skipped',
    sqlFile: SQL_OUT,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

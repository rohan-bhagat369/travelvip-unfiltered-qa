import fs from 'fs';

const r = JSON.parse(fs.readFileSync('reports/paxwise-cancel-validations-staging.json', 'utf8'));

const rules = {
  '4.1a': ['Must be JSON array, not string', '"PAX1"'],
  '4.1b': ['Must be JSON array, not object', '{ "0": "PAX1" }'],
  '4.1c': ['Flat array only, no nested arrays', '[["PAX1"]]'],
  '4.2a': ['Elements must be string|number, not null', '[null]'],
  '4.2b': ['Elements must be string|number, not boolean', '[true]'],
  '4.2c': ['Elements must be string|number, not object', '[{}]'],
  '4.3a': ['Invalid id format', '["ABC"]'],
  '4.3b': ['Empty string invalid', '[""]'],
  '4.3c': ['Whitespace-only invalid', '[" "]'],
  '4.3d': ['Decimal string invalid', '["1.5"]'],
  '4.3e': ['Negative number invalid', '[-1]'],
  '4.3f': ['Zero invalid', '[0]'],
  '4.3g': ['PAX0 invalid', '["PAX0"]'],
  '4.3h': ['PAX01 invalid', '["PAX01"]'],
  '4.3i': ['2PAX3 invalid', '["2PAX3"]'],
  '4.4': ['Unknown style id invalid', '["FOO9"]'],
  '4.5': ['Whitespace trim allowed on PENALTY', '[" PAX1 "] action=PENALTY'],
  '4.6': ['All-invalid still VALIDATION_ERROR', '["PAX9","ABC"]'],
  '4.7a': ['Exact duplicate rejected', '["PAX1","PAX1"]'],
  '4.7b': ['Semantic duplicate PAX1+1 rejected', '["PAX1","1"]'],
  '4.7c': ['Semantic duplicate PAX1+pax_1 rejected', '["PAX1","pax_1"]'],
  '4.7d': ['Duplicate numbers rejected', '[1,1]'],
  '4.7e': ['Trimmed duplicate rejected', '[" PAX1 ","PAX1"]'],
  '4.8': ['Multi duplicate pairs rejected', '["PAX1","PAX1","PAX2","PAX2"]'],
  '4.9': ['Invalid+dupes => VALIDATION_ERROR', '["ABC","PAX1","PAX1"]'],
  '4.10': ['List longer than booking pax count', '["PAX1","PAX2","PAX3"] on 1-pax'],
  '4.11': ['Hard max 50 entries', '51 x PAXn'],
  '4.12': ['Valid format but pax missing on booking', '["PAX1","PAX9"]'],
  '4.pnr-invalid': ['Unknown PNR', 'pnr=ZZZZZZ + ["PAX1"]'],
  '4.bad-action': ['Unsupported action', 'action=NOPE'],
};

const rows = r.results.map((x) => {
  const [ruleDetail, payload] = rules[x.id] || [x.how, x.how];
  return {
    Rule: x.id,
    'Rule detail': ruleDetail,
    'Payload / how tested': payload,
    Expected: x.expected,
    Actual: x.actual,
    Status: x.status,
    'Response snippet': x.note || '',
  };
});

const out = {
  title: 'Paxwise cancellationPaxList validation report',
  for: 'Engineering / Dev share-out',
  endpoint: 'POST /v1/flights/booking/{bookingId}/cancel',
  env: r.baseUrl,
  ranAt: r.ranAt,
  fixture: r.fixture,
  score: r.score,
  summary:
    'Invalid cancellationPaxList values are not rejected with 400/422 on staging; they reach cancel and return HTTP 200 Cancellation Failed. Only unknown PNR and bad action validate correctly.',
  results: rows,
};

fs.writeFileSync('reports/paxwise-cancel-validations-dev-share.json', JSON.stringify(out, null, 2));

const headers = Object.keys(rows[0]);
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const csv = [headers.join(',')]
  .concat(rows.map((row) => headers.map((h) => esc(row[h])).join(',')))
  .join('\n');
fs.writeFileSync('reports/paxwise-cancel-validations-dev-share.csv', csv);

console.log('wrote', rows.length, 'rows');

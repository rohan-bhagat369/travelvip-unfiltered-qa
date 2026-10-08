import fs from 'fs';

const j = JSON.parse(fs.readFileSync('reports/hotel-payload-validations-staging.json', 'utf8'));

function classify(r) {
  if (r.status === 'PASS') return 'PASS';
  if (r.status === 'NOT TESTED') return 'NOT TESTED';
  const snip = r.responseSnippet || '';
  const note = r.note || '';
  if (/bookingRefId|bookingReference/.test(snip) && /Pending|Confirmed|statusCode.:200/.test(snip)) {
    return 'BUG (accepted — booking created)';
  }
  if (/details is null/i.test(note) || (/VALIDATION_ERROR/.test(snip) && /details.:null/.test(snip))) {
    return 'BUG (rule enforced, details=null)';
  }
  if (/totalResults|availableResults|"results":\[/.test(snip)) {
    return 'BUG (accepted — success response)';
  }
  if (/"status":400/.test(snip) || /Bad Request/.test(snip) || /must be|is required|invalid|cannot|maximum|whole number/i.test(snip)) {
    return 'BUG (legacy HTTP 200 / wrong envelope)';
  }
  if (/duplicate/i.test(snip)) return 'BUG (duplicate cache)';
  return 'BUG (other)';
}

const counts = {};
for (const r of j.rows) {
  r.verdict = classify(r);
  counts[r.verdict] = (counts[r.verdict] || 0) + 1;
}

for (const sec of [...new Set(j.rows.map((r) => r.section))]) {
  console.log(`\n### ${sec}`);
  j.rows.filter((r) => r.section === sec).forEach((r, i) => {
    console.log(`${i + 1}. ${r.rule} => ${r.verdict}`);
  });
}

console.log('\nCOUNTS', counts);
fs.writeFileSync(
  'reports/hotel-payload-validations-staging.json',
  JSON.stringify({ ...j, countsByVerdict: counts }, null, 2),
);

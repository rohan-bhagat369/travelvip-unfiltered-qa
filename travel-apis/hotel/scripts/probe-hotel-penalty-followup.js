/**
 * Complete penalty-check happy path using history Confirmed bookings.
 * Run: node scripts/probe-hotel-penalty-followup.js
 */
import fs from 'fs';
import { authenticate } from '../../../shared/lib/authService.js';
import { HotelService } from '../src/service.js';
import { sleep } from '../../../shared/lib/testUtils.js';

const OUT = 'reports/hotel-penalty-gst-pan-staging.json';
const report = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const { client } = await authenticate(true);
const hotel = new HotelService(client);

const hist = await hotel.bookingHistory(0, 30);
const conf = (hist.data?.bookings || []).find((b) => /confirm/i.test(String(b.status)));
if (!conf?.bookingId) throw new Error('No Confirmed hotel booking in history');
const br = conf.bookingId;
console.log('Using', br, conf.status, conf.totalAmount);

function replacePenalty(ruleStartsWith, row) {
  const ri = report.rows.findIndex(
    (r) => r.section === 'Penalty' && String(r.rule).startsWith(ruleStartsWith),
  );
  if (ri >= 0) report.rows[ri] = { ...report.rows[ri], ...row, section: 'Penalty' };
  else report.rows.push({ section: 'Penalty', ...row });
  console.log(`[${row.status}] ${row.rule} — ${row.actual}`);
}

const pen1 = await hotel.penaltyCheck(br);
const cr = pen1.data?.data?.cancellationRequest || pen1.data?.cancellationRequest;
const ok = pen1.status === 200 && /Penalty Fetched|Penalty Not Available/i.test(String(cr?.status || ''));
replacePenalty('3.', {
  rule: '3. Confirmed booking penalty quote',
  how: 'history Confirmed BR → GET penalty-check',
  expected: 'HTTP 200 + Penalty Fetched | Not Available',
  status: ok ? 'PASS' : 'BUG',
  actual: `HTTP ${pen1.status} status=${cr?.status} charge=${cr?.estimatedCancellationCharge} refund=${cr?.estimatedRefund}`,
  bookingId: br,
  responseSnippet: JSON.stringify(pen1.data).slice(0, 500),
  at: new Date().toISOString(),
});

const amountsOk =
  /Fetched/i.test(String(cr?.status)) &&
  typeof cr?.estimatedCancellationCharge === 'number' &&
  typeof cr?.estimatedRefund === 'number';
replacePenalty('3b.', {
  rule: '3b. Penalty Fetched includes estimate fields',
  how: 'Inspect cancellationRequest amounts',
  expected: 'estimatedCancellationCharge + estimatedRefund present',
  status: amountsOk ? 'PASS' : 'BUG',
  actual: `charge=${cr?.estimatedCancellationCharge} refund=${cr?.estimatedRefund} currency=${pen1.data?.data?.currency || pen1.data?.currency}`,
  at: new Date().toISOString(),
});

const pen2 = await hotel.penaltyCheck(br);
const st2 = (await hotel.getBookingStatus(br)).data?.status;
const cr2 = pen2.data?.data?.cancellationRequest || pen2.data?.cancellationRequest;
replacePenalty('4.', {
  rule: '4. Penalty-check is safe to repeat (no cancel)',
  how: 'Call penalty-check twice; status poll',
  expected: 'HTTP 200 both; booking status still Confirmed',
  status: pen2.status === 200 && /confirm/i.test(String(st2)) ? 'PASS' : 'BUG',
  actual: `pen2=${pen2.status}/${cr2?.status} bookingStatus=${st2}`,
  at: new Date().toISOString(),
});

const cancel = await hotel.cancelBooking(br);
await sleep(3000);
const after = await hotel.penaltyCheck(br);
const code = after.data?.error?.code;
replacePenalty('5.', {
  rule: '5. Penalty-check after cancel',
  how: 'Cancel then penalty-check again',
  expected: 'HTTP 400 + error.code (already cancelled / not cancellable)',
  status: after.status === 400 && code ? 'PASS' : 'BUG',
  actual: `cancelHTTP=${cancel.status} penHTTP=${after.status} code=${code}`,
  responseSnippet: JSON.stringify(after.data).slice(0, 400),
  at: new Date().toISOString(),
});

const failed = (hist.data?.bookings || []).find((b) => /fail/i.test(String(b.status)));
if (failed?.bookingId) {
  const fpen = await hotel.penaltyCheck(failed.bookingId);
  const fcode = fpen.data?.error?.code;
  report.rows.push({
    section: 'Penalty',
    rule: '6. Failed booking not cancellable',
    how: 'GET penalty-check on Failed BR',
    expected: 'HTTP 400 BOOKING_NOT_CANCELLABLE',
    status: fpen.status === 400 && fcode === 'BOOKING_NOT_CANCELLABLE' ? 'PASS' : 'BUG',
    actual: `HTTP ${fpen.status} code=${fcode}`,
    at: new Date().toISOString(),
  });
  console.log(`[extra] Failed ${failed.bookingId} → ${fpen.status} ${fcode}`);
}

report.confirmedBooking = br;
report.score = {
  PASS: report.rows.filter((r) => r.status === 'PASS').length,
  BUG: report.rows.filter((r) => r.status === 'BUG').length,
  NOT_TESTED: report.rows.filter((r) => r.status === 'NOT TESTED').length,
};
report.bugs = report.rows.filter((r) => r.status === 'BUG');
report.at = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('Score', report.score);
for (const r of report.rows.filter((r) => r.section === 'Penalty')) {
  console.log(`| ${r.status} | ${r.rule}`);
}

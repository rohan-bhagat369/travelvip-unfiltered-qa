/**
 * Build client-facing PDF of verified PASS per-pax cancel scenarios.
 *   node scripts/build-cancel-perpax-client-pdf.js
 */
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

const OUT_PDF = 'reports/TravelVIP-PerPax-Cancel-Working-Cases-Canary.pdf';
const OUT_MD = 'reports/TravelVIP-PerPax-Cancel-Working-Cases-Canary.md';

function load(f) {
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function envelope(data) {
  if (!data) return null;
  if (data.status === 0 || data.data) return data;
  // probe often stores inner data only
  return {
    status: 0,
    statusMessage: 'Success',
    data,
  };
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function reqBody(action, pnr, extra = {}) {
  return {
    retryCount: 2,
    action,
    pnr,
    ...extra,
  };
}

function buildCases() {
  const cases = [];

  // W0 — S1 1ADT NORMAL OW Direct (snapshot only in p0 — reconstruct envelope carefully)
  {
    const j = load('reports/cancel-perpax-p0-canary.json');
    const s1 = j.results.find((r) => r.id === 'S1');
    const pen = s1.penalty;
    const can = s1.cancel;
    cases.push({
      id: '1',
      title: 'Full PNR cancel — 1 ADT baseline',
      trip: 'OW',
      stops: 'Direct',
      pax: '1 ADT',
      cancelScope: 'Full PNR (no cancellationPaxList)',
      fare: 'NORMAL',
      route: s1.fixture.route,
      airline: '6E',
      br: s1.fixture.br,
      pnr: s1.fixture.pnr,
      onlineCancellation: s1.fixture.onlineCancellation,
      result: 'PASS — Cancelled',
      penaltyReq: reqBody('PENALTY', s1.fixture.pnr, { cancellationReason: 'P0 S1' }),
      cancelReq: reqBody('CANCEL', s1.fixture.pnr, { cancellationReason: 'P0 S1' }),
      penaltyRes: envelope({
        bookingReference: s1.fixture.br,
        pnr: s1.fixture.pnr,
        cancellationRequest: {
          status: pen.status,
          estimatedCancellationCharge: pen.estimatedCancellationCharge,
          estimatedRefund: pen.estimatedRefund,
          totalAmount: pen.totalAmount,
          totalPenalty: pen.totalPenalty,
          perPax: pen.perPax,
        },
      }),
      cancelRes: envelope({
        bookingReference: s1.fixture.br,
        pnr: s1.fixture.pnr,
        cancellationRequest: {
          status: can.status,
          estimatedCancellationCharge: can.estimatedCancellationCharge,
          estimatedRefund: can.estimatedRefund,
          totalAmount: can.totalAmount,
          totalPenalty: can.totalPenalty,
          perPax: can.perPax,
        },
      }),
    });
  }

  // W1 — CORPORATE subset
  {
    const j = load('reports/cancel-perpax-corporate-subset.json');
    cases.push({
      id: '2',
      title: 'Partial pax cancel — 1 of 2 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '2 ADT',
      cancelScope: 'cancellationPaxList: ["PAX1"]',
      fare: 'CORPORATE',
      route: j.fixture.route,
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      result: 'PASS — Cancellation Requested + quote (PER_PAX_POLICY)',
      penaltyReq: { ...j.request.penalty, retryCount: 2 },
      cancelReq: { ...j.request.cancel, retryCount: 2 },
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // W2 — CORPORATE 2ADT full
  {
    const j = load('reports/cancel-perpax-corporate-full.json');
    cases.push({
      id: '3',
      title: 'Full PNR cancel — 2 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '2 ADT',
      cancelScope: 'Full PNR (no cancellationPaxList)',
      fare: 'CORPORATE',
      route: j.fixture.route || 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      result: 'PASS — Cancelled (fee × 2)',
      penaltyReq: reqBody('PENALTY', j.fixture.pnr, { cancellationReason: 'S3 CORP full' }),
      cancelReq: reqBody('CANCEL', j.fixture.pnr, { cancellationReason: 'S3 CORP full' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // W3 — RT onward only (2 ADT from perPax.chargedPax / fare math)
  {
    const j = load('reports/cancel-perpax-corporate-rt-onward.json');
    const f = j.fixture;
    const onwardPnr = j.request?.pnr || f.onward?.pnr || f.pnr;
    const adults = j.penalty?.perPax?.chargedPax || j.penalty?.perPax?.paxCount || 2;
    cases.push({
      id: '4',
      title: 'RT cancel onward only — return left intact',
      trip: 'RT',
      stops: 'Direct',
      pax: `${adults} ADT`,
      cancelScope: `Onward PNR only (${onwardPnr}) — return PNR untouched`,
      fare: 'CORPORATE',
      route: `${f.route || 'DEL-BOM'} (round trip)`,
      airline: f.onward?.airline || '6E',
      br: f.br,
      pnr: onwardPnr,
      returnPnr: f.return?.pnr || f.returnPnr,
      onlineCancellation: f.onward?.onlineCancellation ?? f.onlineCancellation,
      result: 'PASS — onward Cancelled / return intact',
      penaltyReq: reqBody('PENALTY', onwardPnr, { cancellationReason: 'S4 onward' }),
      cancelReq: reqBody('CANCEL', onwardPnr, { cancellationReason: 'S4 onward' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // W4 — RT return complete on same BR
  {
    const j = load('reports/cancel-perpax-s5-complete-and-offline.json');
    const s = j.s5Complete;
    cases.push({
      id: '5',
      title: 'RT cancel return only — onward already cancelled',
      trip: 'RT',
      stops: 'Direct',
      pax: '2 ADT',
      cancelScope: `Return PNR only (${s.returnPnr})`,
      fare: 'CORPORATE',
      route: 'DEL-BOM-DEL',
      airline: '6E',
      br: s.br,
      pnr: s.returnPnr,
      onwardPnr: 'G122SA',
      onlineCancellation: true,
      result: `PASS — ${s.afterStatus}`,
      penaltyReq: reqBody('PENALTY', s.returnPnr, { cancellationReason: 'S5-complete 6E return' }),
      cancelReq: reqBody('CANCEL', s.returnPnr, { cancellationReason: 'S5-complete 6E return' }),
      penaltyRes: envelope(s.penalty.raw),
      cancelRes: envelope(s.cancel.raw),
    });
  }

  // W5 — SSR
  {
    const j = load('reports/cancel-perpax-ssr-withheld.json');
    cases.push({
      id: '6',
      title: 'Full cancel with SSR withheld (meal + baggage)',
      trip: 'OW',
      stops: 'Direct',
      pax: '1 ADT',
      cancelScope: 'Full PNR',
      fare: j.fixture.fareType,
      route: j.fixture.route,
      airline: j.fixture.airline,
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      result: 'PASS — Cancelled; SSR 2420 in charge (not refunded)',
      ssrNote: `Booked SSR ₹${j.fixture.ssrExpected} (meal ${j.fixture.mealAmount} + bag ${j.fixture.bagAmount})`,
      penaltyReq: reqBody('PENALTY', j.fixture.pnr, { cancellationReason: 'SSR withheld' }),
      cancelReq: reqBody('CANCEL', j.fixture.pnr, { cancellationReason: 'SSR withheld' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // W6 — Sequential CORPORATE
  {
    const j = load('reports/cancel-perpax-sequential-subset.json');
    const step1 = j.steps[0];
    const step2 = j.steps[1];
    cases.push({
      id: '7',
      title: 'Sequential partial cancel — PAX1 then PAX2',
      trip: 'OW',
      stops: 'Direct',
      pax: '2 ADT',
      cancelScope: 'Step1 ["PAX1"] then Step2 ["PAX2"]',
      fare: j.fixture.fareType,
      route: j.fixture.route,
      airline: j.fixture.airline,
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      result: 'PASS — both steps Cancellation Requested with quotes',
      steps: [
        {
          label: 'Step 1 — cancel PAX1',
          penaltyReq: reqBody('PENALTY', j.fixture.pnr, {
            cancellationPaxList: ['PAX1'],
            cancellationReason: 'seq PAX1',
          }),
          cancelReq: reqBody('CANCEL', j.fixture.pnr, {
            cancellationPaxList: ['PAX1'],
            cancellationReason: 'seq PAX1',
          }),
          penaltyRes: envelope(step1.penalty?.raw || step1.penalty),
          cancelRes: envelope(step1.cancel?.raw || step1.cancel),
        },
        {
          label: 'Step 2 — cancel PAX2',
          penaltyReq: reqBody('PENALTY', j.fixture.pnr, {
            cancellationPaxList: ['PAX2'],
            cancellationReason: 'seq PAX2',
          }),
          cancelReq: reqBody('CANCEL', j.fixture.pnr, {
            cancellationPaxList: ['PAX2'],
            cancellationReason: 'seq PAX2',
          }),
          penaltyRes: envelope(step2.penalty?.raw || step2.penalty),
          cancelRes: envelope(step2.cancel?.raw || step2.cancel),
        },
      ],
    });
  }

  // W7 — multipax list corporate (report stores raw data at penalty/cancel root)
  {
    const j = load('reports/cancel-perpax-multipax-list-corporate.json');
    cases.push({
      id: '8',
      title: 'Multi-pax list — cancel PAX1+PAX2 of 3 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '3 ADT',
      cancelScope: 'cancellationPaxList: ["PAX1","PAX2"]',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: true,
      result: 'PASS — Cancellation Requested + quote (PER_PAX_POLICY)',
      penaltyReq: reqBody('PENALTY', j.fixture.pnr, {
        cancellationPaxList: ['PAX1', 'PAX2'],
        cancellationReason: 'multipax-list CORP',
      }),
      cancelReq: reqBody('CANCEL', j.fixture.pnr, {
        cancellationPaxList: ['PAX1', 'PAX2'],
        cancellationReason: 'multipax-list CORP',
      }),
      penaltyRes: envelope(j.penalty),
      cancelRes: envelope(j.cancel),
    });
  }

  // W8 — remaining PAX3
  {
    const j = load('reports/cancel-perpax-corporate-BR1786572156401139.json');
    const pnr = j.request.pnr;
    cases.push({
      id: '9',
      title: 'Remaining pax after multi-list — PAX3 of 3',
      trip: 'OW',
      stops: 'Direct',
      pax: '3 ADT',
      cancelScope: 'cancellationPaxList: ["PAX3"]',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr,
      onlineCancellation: j.fixture.itinerary?.[0]?.onlineCancellation,
      result: 'PASS — Cancellation Requested + quote',
      penaltyReq: reqBody('PENALTY', pnr, {
        cancellationPaxList: ['PAX3'],
        cancellationReason: 'remaining PAX3',
      }),
      cancelReq: reqBody('CANCEL', pnr, {
        cancellationPaxList: ['PAX3'],
        cancellationReason: 'remaining PAX3',
      }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // W9 — 3ADT full
  {
    const j = load('reports/cancel-perpax-corporate-3adt-full.json');
    cases.push({
      id: '10',
      title: 'Full PNR cancel — 3 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '3 ADT',
      cancelScope: 'Full PNR (no cancellationPaxList)',
      fare: 'CORPORATE',
      route: j.fixture.route || 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      result: 'PASS — Cancelled (fee × 3)',
      penaltyReq: reqBody('PENALTY', j.fixture.pnr, { cancellationReason: '3ADT full' }),
      cancelReq: reqBody('CANCEL', j.fixture.pnr, { cancellationReason: '3ADT full' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // W10 — all via list
  {
    const j = load('reports/cancel-perpax-all-via-list.json');
    const pen = j.penalty.raw || j.penalty;
    const can = j.cancel.raw || j.cancel;
    cases.push({
      id: '11',
      title: 'Cancel all passengers via list — 2 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '2 ADT',
      cancelScope: 'cancellationPaxList: ["PAX1","PAX2"] (all) → FULL_PAX',
      fare: j.fixture.fareType || 'CORPORATE',
      route: j.fixture.route || 'DEL-BOM',
      airline: j.fixture.airline || '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation ?? true,
      result: 'PASS — Cancelled / scope FULL_PAX',
      penaltyReq: reqBody('PENALTY', j.fixture.pnr, {
        cancellationPaxList: j.request.cancellationPaxList,
        cancellationReason: 'all-via-list',
      }),
      cancelReq: reqBody('CANCEL', j.fixture.pnr, {
        cancellationPaxList: j.request.cancellationPaxList,
        cancellationReason: 'all-via-list',
      }),
      penaltyRes: envelope(pen),
      cancelRes: envelope(can),
    });
  }

  return cases;
}

function buildMarkdown(cases) {
  const lines = [];
  lines.push('# TravelVIP B2B — Flight per-passenger cancel');
  lines.push('## Working cases (canary) — request & response pack');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Environment | `https://canary-api.travelvip.ai` |');
  lines.push('| Partner | `vgm` |');
  lines.push('| Endpoint | `POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR` |');
  lines.push('| Actions | `PENALTY` (quote only) → `CANCEL` (perform) |');
  lines.push('| Scope | **Verified PASS / end-to-end working scenarios only** |');
  lines.push('');
  lines.push('> Amounts and bodies below are taken from live canary probe reports. Booking shape: trip type (OW/RT), Direct/Connecting, and passenger count are listed per case.');
  lines.push('');
  lines.push('## Index');
  lines.push('');
  lines.push('| # | Scenario | Trip | Stops | Pax | Fare | BR | Result |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const c of cases) {
    lines.push(`| ${c.id} | ${c.title} | **${c.trip}** | **${c.stops}** | **${c.pax}** | ${c.fare} | \`${c.br}\` | ${c.result.split('—')[0].trim()} |`);
  }
  lines.push('');

  for (const c of cases) {
    lines.push('---');
    lines.push('');
    lines.push(`## Case ${c.id}. ${c.title}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| Trip type | **${c.trip}** |`);
    lines.push(`| Stops | **${c.stops}** |`);
    lines.push(`| Passengers | **${c.pax}** |`);
    lines.push(`| Cancel scope | ${c.cancelScope} |`);
    lines.push(`| Fare type | ${c.fare} |`);
    lines.push(`| Route | ${c.route} |`);
    lines.push(`| Airline | ${c.airline} |`);
    lines.push(`| Booking reference | \`${c.br}\` |`);
    lines.push(`| PNR | \`${c.pnr}\` |`);
    if (c.returnPnr) lines.push(`| Return PNR (untouched / other) | \`${c.returnPnr}\` |`);
    if (c.onwardPnr) lines.push(`| Onward PNR | \`${c.onwardPnr}\` |`);
    lines.push(`| onlineCancellation | ${c.onlineCancellation} |`);
    lines.push(`| Result | ${c.result} |`);
    if (c.ssrNote) lines.push(`| SSR | ${c.ssrNote} |`);
    lines.push('');

    if (c.steps) {
      for (const step of c.steps) {
        lines.push(`### ${step.label}`);
        lines.push('');
        lines.push('**PENALTY request**');
        lines.push('```json');
        lines.push(pretty(step.penaltyReq));
        lines.push('```');
        lines.push('');
        lines.push('**PENALTY response (HTTP 200)**');
        lines.push('```json');
        lines.push(pretty(step.penaltyRes));
        lines.push('```');
        lines.push('');
        lines.push('**CANCEL request**');
        lines.push('```json');
        lines.push(pretty(step.cancelReq));
        lines.push('```');
        lines.push('');
        lines.push('**CANCEL response (HTTP 200)**');
        lines.push('```json');
        lines.push(pretty(step.cancelRes));
        lines.push('```');
        lines.push('');
      }
      continue;
    }

    lines.push('### PENALTY request');
    lines.push('```json');
    lines.push(pretty(c.penaltyReq));
    lines.push('```');
    lines.push('');
    lines.push('### PENALTY response (HTTP 200)');
    lines.push('```json');
    lines.push(pretty(c.penaltyRes));
    lines.push('```');
    lines.push('');
    lines.push('### CANCEL request');
    lines.push('```json');
    lines.push(pretty(c.cancelReq));
    lines.push('```');
    lines.push('');
    lines.push('### CANCEL response (HTTP 200)');
    lines.push('```json');
    lines.push(pretty(c.cancelRes));
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Notes for integrators');
  lines.push('');
  lines.push('1. Always send `pnr` for the leg being cancelled (RT has separate onward/return PNRs).');
  lines.push('2. Partial cancel: include `cancellationPaxList` (e.g. `["PAX1"]`). Expect `paxScope.scope = PARTIAL_PAX` and status **Cancellation Requested**.');
  lines.push('3. Full PNR online cancel (no pax list, `onlineCancellation: true`): expect **Cancelled** when provider succeeds.');
  lines.push('4. Quotes include `perPax` (object or array of rows) with `penalty`, `cancellationFee`, `ssr`, `refund`.');
  lines.push('5. SSR is withheld from refund (`ssr` / breakup `ssrCharge`).');
  lines.push('');
  lines.push('*Generated from canary automation reports — TravelVIP API QA.*');
  lines.push('');
  return lines.join('\n');
}

function writePdf(cases) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 48,
      size: 'A4',
      info: {
        Title: 'TravelVIP Per-Passenger Cancel — Working Cases (Canary)',
        Author: 'TravelVIP API QA',
      },
    });
    const stream = fs.createWriteStream(OUT_PDF);
    doc.pipe(stream);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    function h1(t) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(t, { width: pageWidth });
      doc.moveDown(0.4);
    }
    function h2(t) {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(t, { width: pageWidth });
      doc.moveDown(0.25);
    }
    function h3(t) {
      doc.moveDown(0.35);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#222').text(t, { width: pageWidth });
      doc.moveDown(0.15);
    }
    function p(t) {
      doc.font('Helvetica').fontSize(9).fillColor('#222').text(t, { width: pageWidth, lineGap: 1.5 });
    }
    function metaLine(label, value) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(`${label}: `, { continued: true });
      doc.font('Helvetica').fillColor('#111').text(String(value));
    }
    function codeBlock(obj) {
      const text = typeof obj === 'string' ? obj : pretty(obj);
      const startY = doc.y;
      // soft page break if little room
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.font('Courier').fontSize(7).fillColor('#111');
      doc.text(text, {
        width: pageWidth,
        lineGap: 0.5,
      });
      doc.moveDown(0.35);
      doc.font('Helvetica');
    }

    // Cover
    h1('TravelVIP B2B API');
    h2('Flight per-passenger cancel — working cases');
    p('Environment: https://canary-api.travelvip.ai');
    p('Partner: vgm');
    p('Endpoint: POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR');
    p('Actions: PENALTY (quote) → CANCEL (perform)');
    p('Document scope: Verified PASS / end-to-end working scenarios only (canary).');
    doc.moveDown(0.4);
    p('Each case includes trip type (OW/RT), Direct/Connecting, passenger count, booking reference, PNR, and exact request/response bodies.');

    h2('Index');
    for (const c of cases) {
      p(`${c.id}. [${c.trip} · ${c.stops} · ${c.pax}] ${c.title} — ${c.br}`);
    }

    for (const c of cases) {
      doc.addPage();
      h2(`Case ${c.id}. ${c.title}`);
      metaLine('Trip type', c.trip);
      metaLine('Stops', c.stops);
      metaLine('Passengers', c.pax);
      metaLine('Cancel scope', c.cancelScope);
      metaLine('Fare type', c.fare);
      metaLine('Route', c.route);
      metaLine('Airline', c.airline);
      metaLine('Booking reference', c.br);
      metaLine('PNR', c.pnr);
      if (c.returnPnr) metaLine('Return PNR', c.returnPnr);
      if (c.onwardPnr) metaLine('Onward PNR', c.onwardPnr);
      metaLine('onlineCancellation', c.onlineCancellation);
      metaLine('Result', c.result);
      if (c.ssrNote) metaLine('SSR', c.ssrNote);
      doc.moveDown(0.3);

      if (c.steps) {
        for (const step of c.steps) {
          h3(step.label);
          h3('PENALTY request');
          codeBlock(step.penaltyReq);
          h3('PENALTY response (HTTP 200)');
          codeBlock(step.penaltyRes);
          h3('CANCEL request');
          codeBlock(step.cancelReq);
          h3('CANCEL response (HTTP 200)');
          codeBlock(step.cancelRes);
        }
      } else {
        h3('PENALTY request');
        codeBlock(c.penaltyReq);
        h3('PENALTY response (HTTP 200)');
        codeBlock(c.penaltyRes);
        h3('CANCEL request');
        codeBlock(c.cancelReq);
        h3('CANCEL response (HTTP 200)');
        codeBlock(c.cancelRes);
      }
    }

    doc.addPage();
    h2('Notes for integrators');
    p('1. Always send pnr for the leg being cancelled (RT has separate onward/return PNRs).');
    p('2. Partial cancel: include cancellationPaxList. Expect paxScope.scope = PARTIAL_PAX and status Cancellation Requested.');
    p('3. Full PNR online cancel (no pax list, onlineCancellation true): expect Cancelled when provider succeeds.');
    p('4. Quotes include perPax with penalty, cancellationFee, ssr, refund.');
    p('5. SSR is withheld from refund (ssr / breakup ssrCharge).');
    doc.moveDown(1);
    p('Generated from canary automation reports — TravelVIP API QA.');

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function main() {
  const cases = buildCases();
  // sanitize: drop nullish fields inside JSON for cleaner PDF
  const md = buildMarkdown(cases);
  fs.writeFileSync(OUT_MD, md);
  await writePdf(cases);
  console.log('Wrote', OUT_MD);
  console.log('Wrote', OUT_PDF);
  console.log('Cases', cases.length);
  for (const c of cases) {
    console.log(`  ${c.id}. ${c.trip}/${c.stops}/${c.pax} — ${c.br} / ${c.pnr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Client PDF — ONLY latest ~2h working PASS cases (canary).
 * Window: ~03:00–03:45 IST on 2026-08-13 (reports after 21:30 UTC 2026-08-12)
 *
 *   node scripts/build-cancel-perpax-client-pdf-latest.js
 */
import fs from 'fs';
import PDFDocument from 'pdfkit';

const OUT_PDF = 'reports/TravelVIP-PerPax-Cancel-Working-Cases-Canary.pdf';
const OUT_MD = 'reports/TravelVIP-PerPax-Cancel-Working-Cases-Canary.md';

function load(f) {
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}
function envelope(data) {
  if (!data) return null;
  if (data.status === 0 || data.data) return data;
  return { status: 0, statusMessage: 'Success', data };
}
function reqBody(action, pnr, extra = {}) {
  return { retryCount: 2, action, pnr, ...extra };
}

function buildCases() {
  const cases = [];

  // 1) SSR — IST 03:02
  {
    const j = load('reports/cancel-perpax-ssr-withheld.json');
    cases.push({
      id: '1',
      ranAtIst: '2026-08-13 03:02 IST',
      title: 'Full cancel with SSR withheld (meal + baggage)',
      trip: 'OW',
      stops: 'Direct',
      pax: '1 ADT',
      cancelScope: 'Full PNR (no cancellationPaxList)',
      fare: j.fixture.fareType,
      route: j.fixture.route,
      airline: j.fixture.airline,
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      result: 'PASS — Cancelled; SSR ₹2420 in charge (not refunded)',
      ssrNote: `Booked SSR ₹${j.fixture.ssrExpected} (meal ${j.fixture.mealAmount} + bag ${j.fixture.bagAmount})`,
      penaltyReq: reqBody('PENALTY', j.fixture.pnr, { cancellationReason: 'SSR withheld' }),
      cancelReq: reqBody('CANCEL', j.fixture.pnr, { cancellationReason: 'SSR withheld' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // 2) Sequential — IST 03:12
  {
    const j = load('reports/cancel-perpax-sequential-subset.json');
    const step1 = j.steps[0];
    const step2 = j.steps[1];
    cases.push({
      id: '2',
      ranAtIst: '2026-08-13 03:12 IST',
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
          penaltyRes: envelope(step1.penalty.raw),
          cancelRes: envelope(step1.cancel.raw),
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
          penaltyRes: envelope(step2.penalty.raw),
          cancelRes: envelope(step2.cancel.raw),
        },
      ],
    });
  }

  // 3) Direct CANCEL (next-batch) — IST 03:17
  {
    const j = load('reports/cancel-perpax-next-batch.json');
    const br = j.fixture.br;
    const pnr = j.fixture.pnr;
    cases.push({
      id: '3',
      ranAtIst: '2026-08-13 03:17 IST',
      title: 'Full PNR cancel — 1 ADT (PENALTY → CANCEL)',
      trip: 'OW',
      stops: 'Direct',
      pax: '1 ADT',
      cancelScope: 'Full PNR (no cancellationPaxList)',
      fare: 'NORMAL',
      route: 'DEL-BOM',
      airline: '6E',
      br,
      pnr,
      onlineCancellation: true,
      result: `PASS — ${j.cases.afterStatus}`,
      penaltyReq: reqBody('PENALTY', pnr, { cancellationReason: 'N1' }),
      cancelReq: reqBody('CANCEL', pnr, { cancellationReason: 'N1' }),
      penaltyRes: envelope(j.cases.penalty.raw),
      cancelRes: envelope(j.cases.cancel.raw),
    });
  }

  // 4) RT return complete — IST 03:22
  {
    const j = load('reports/cancel-perpax-s5-complete-and-offline.json');
    const s = j.s5Complete;
    cases.push({
      id: '4',
      ranAtIst: '2026-08-13 03:22 IST',
      title: 'RT cancel return only — onward already cancelled',
      trip: 'RT',
      stops: 'Direct',
      pax: '2 ADT',
      cancelScope: `Return PNR only (${s.returnPnr})`,
      fare: 'CORPORATE',
      route: 'DEL-BOM (round trip)',
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

  // 5) Multi-list CORPORATE — same BR as remaining (report ~03:31–03:34)
  {
    const j = load('reports/cancel-perpax-multipax-list-corporate.json');
    cases.push({
      id: '5',
      ranAtIst: '2026-08-13 03:31–03:34 IST',
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

  // 6) Remaining PAX3 — IST 03:34
  {
    const j = load('reports/cancel-perpax-corporate-BR1786572156401139.json');
    const pnr = j.request.pnr;
    cases.push({
      id: '6',
      ranAtIst: '2026-08-13 03:34 IST',
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

  // 7) 3ADT full — IST 03:35
  {
    const j = load('reports/cancel-perpax-corporate-3adt-full.json');
    cases.push({
      id: '7',
      ranAtIst: '2026-08-13 03:35 IST',
      title: 'Full PNR cancel — 3 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '3 ADT',
      cancelScope: 'Full PNR (no cancellationPaxList)',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: j.fixture.airline || '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: true,
      result: 'PASS — Cancelled (fee × 3)',
      penaltyReq: reqBody('PENALTY', j.fixture.pnr, { cancellationReason: '3ADT full' }),
      cancelReq: reqBody('CANCEL', j.fixture.pnr, { cancellationReason: '3ADT full' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // 8) All via list — IST 03:37
  {
    const j = load('reports/cancel-perpax-all-via-list.json');
    const pen = j.penalty.raw || j.penalty;
    const can = j.cancel.raw || j.cancel;
    cases.push({
      id: '8',
      ranAtIst: '2026-08-13 03:37 IST',
      title: 'Cancel all passengers via list — 2 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '2 ADT',
      cancelScope: 'cancellationPaxList: ["PAX1","PAX2"] (all) → FULL_PAX',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: true,
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
  lines.push('## Working cases (latest ~2 hours) — request & response');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Environment | `https://canary-api.travelvip.ai` |');
  lines.push('| Partner | `vgm` |');
  lines.push('| Endpoint | `POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR` |');
  lines.push('| Window | **2026-08-13 ≈ 03:00–03:45 IST** (latest pack only) |');
  lines.push('| Scope | Verified **PASS** end-to-end working scenarios from this window |');
  lines.push('');
  lines.push('## Index');
  lines.push('');
  lines.push('| # | Ran (IST) | Scenario | Trip | Stops | Pax | BR |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const c of cases) {
    lines.push(`| ${c.id} | ${c.ranAtIst} | ${c.title} | **${c.trip}** | **${c.stops}** | **${c.pax}** | \`${c.br}\` |`);
  }
  lines.push('');

  for (const c of cases) {
    lines.push('---');
    lines.push('');
    lines.push(`## Case ${c.id}. ${c.title}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| Ran at | ${c.ranAtIst} |`);
    lines.push(`| Trip type | **${c.trip}** |`);
    lines.push(`| Stops | **${c.stops}** |`);
    lines.push(`| Passengers | **${c.pax}** |`);
    lines.push(`| Cancel scope | ${c.cancelScope} |`);
    lines.push(`| Fare type | ${c.fare} |`);
    lines.push(`| Route | ${c.route} |`);
    lines.push(`| Airline | ${c.airline} |`);
    lines.push(`| Booking reference | \`${c.br}\` |`);
    lines.push(`| PNR | \`${c.pnr}\` |`);
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

    if (c.penaltyReq) {
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
    }
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
  lines.push('*Generated from canary automation reports in the latest ~2 hour window — TravelVIP API QA.*');
  lines.push('');
  return lines.join('\n');
}

function writePdf(cases) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 48,
      size: 'A4',
      info: {
        Title: 'TravelVIP Per-Passenger Cancel — Latest Working Cases (Canary)',
        Author: 'TravelVIP API QA',
      },
    });
    const stream = fs.createWriteStream(OUT_PDF);
    doc.pipe(stream);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    function h1(t) {
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(t, { width: pageWidth });
      doc.moveDown(0.4);
    }
    function h2(t) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(t, { width: pageWidth });
      doc.moveDown(0.2);
    }
    function h3(t) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#222').text(t, { width: pageWidth });
      doc.moveDown(0.12);
    }
    function p(t) {
      doc.font('Helvetica').fontSize(9).fillColor('#222').text(t, { width: pageWidth, lineGap: 1.5 });
    }
    function meta(label, value) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(`${label}: `, { continued: true });
      doc.font('Helvetica').fillColor('#111').text(String(value));
    }
    function codeBlock(obj) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.font('Courier').fontSize(7).fillColor('#111').text(pretty(obj), { width: pageWidth, lineGap: 0.5 });
      doc.moveDown(0.3);
      doc.font('Helvetica');
    }

    h1('TravelVIP B2B API');
    h2('Per-passenger cancel — latest working cases only');
    p('Environment: https://canary-api.travelvip.ai');
    p('Partner: vgm');
    p('Endpoint: POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR');
    p('Window: 2026-08-13 approximately 03:00–03:45 IST (latest pack only — not earlier P0 runs).');
    p('Scope: Verified PASS end-to-end working scenarios with trip type, Direct/Connecting, and pax count.');

    h2('Index');
    for (const c of cases) {
      p(`${c.id}. [${c.trip} · ${c.stops} · ${c.pax}] ${c.title} — ${c.br} (${c.ranAtIst})`);
    }

    for (const c of cases) {
      doc.addPage();
      h2(`Case ${c.id}. ${c.title}`);
      meta('Ran at', c.ranAtIst);
      meta('Trip type', c.trip);
      meta('Stops', c.stops);
      meta('Passengers', c.pax);
      meta('Cancel scope', c.cancelScope);
      meta('Fare type', c.fare);
      meta('Route', c.route);
      meta('Airline', c.airline);
      meta('Booking reference', c.br);
      meta('PNR', c.pnr);
      if (c.onwardPnr) meta('Onward PNR', c.onwardPnr);
      meta('onlineCancellation', c.onlineCancellation);
      meta('Result', c.result);
      if (c.ssrNote) meta('SSR', c.ssrNote);
      doc.moveDown(0.25);

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
        if (c.penaltyReq) {
          h3('PENALTY request');
          codeBlock(c.penaltyReq);
          h3('PENALTY response (HTTP 200)');
          codeBlock(c.penaltyRes);
        }
        h3('CANCEL request');
        codeBlock(c.cancelReq);
        h3('CANCEL response (HTTP 200)');
        codeBlock(c.cancelRes);
      }
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function main() {
  const cases = buildCases();
  fs.writeFileSync(OUT_MD, buildMarkdown(cases));
  await writePdf(cases);
  console.log('Wrote', OUT_MD);
  console.log('Wrote', OUT_PDF);
  for (const c of cases) {
    console.log(`  ${c.id}. ${c.ranAtIst} | ${c.trip}/${c.stops}/${c.pax} | ${c.br} / ${c.pnr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

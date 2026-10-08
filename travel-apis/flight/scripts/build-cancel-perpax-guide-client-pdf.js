/**
 * Client pack: successful cancel req/res mapped to
 * "Flight cancellation — per-passenger charges: testing guide"
 *
 *   node scripts/build-cancel-perpax-guide-client-pdf.js
 */
import fs from 'fs';
import PDFDocument from 'pdfkit';

const OUT_PDF = 'reports/TravelVIP-PerPax-Cancel-Guide-Success-Cases.pdf';
const OUT_MD = 'reports/TravelVIP-PerPax-Cancel-Guide-Success-Cases.md';

function load(f) {
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function pretty(o) {
  return JSON.stringify(o, null, 2);
}
function envelope(data) {
  if (!data) return null;
  if (data.status === 0 || data.data) return data;
  return { status: 0, statusMessage: 'Success', data };
}
function req(action, pnr, extra = {}) {
  return { retryCount: 2, action, pnr, ...extra };
}

/**
 * Map guide IDs → live successful canary evidence
 */
function buildCases() {
  const cases = [];

  // Guide R6 / D1+D3 — single pax direct path
  {
    const j = load('reports/cancel-perpax-next-batch.json');
    cases.push({
      guideId: 'R6 / D1 → D3',
      guideTitle: 'Single-passenger booking · PENALTY then CANCEL (direct path)',
      trip: 'OW',
      stops: 'Direct',
      pax: '1 ADT',
      fare: 'NORMAL',
      route: 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: true,
      path: 'Direct (onlineCancellation=true, full PNR)',
      result: 'Cancelled + wallet refund',
      penaltyReq: req('PENALTY', j.fixture.pnr, { cancellationReason: 'guide R6/D1' }),
      cancelReq: req('CANCEL', j.fixture.pnr, { cancellationReason: 'guide D3' }),
      penaltyRes: envelope(j.cases.penalty.raw),
      cancelRes: envelope(j.cases.cancel.raw),
    });
  }

  // Guide SSR withheld (formula: SSR not refunded) — direct path with ancillaries
  {
    const j = load('reports/cancel-perpax-ssr-withheld.json');
    cases.push({
      guideId: 'Formula · SSR withheld',
      guideTitle: 'Ancillaries (meal/bag) withheld from refund on CANCEL',
      trip: 'OW',
      stops: 'Direct',
      pax: '1 ADT',
      fare: j.fixture.fareType,
      route: j.fixture.route,
      airline: j.fixture.airline,
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      path: 'Direct',
      result: 'Cancelled; perPax.ssr / ssrCharge = 2420 not refunded',
      extra: `SSR booked ₹${j.fixture.ssrExpected} (meal ${j.fixture.mealAmount} + bag ${j.fixture.bagAmount})`,
      penaltyReq: req('PENALTY', j.fixture.pnr, { cancellationReason: 'SSR withheld' }),
      cancelReq: req('CANCEL', j.fixture.pnr, { cancellationReason: 'SSR withheld' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // Guide R4 + R3 — subset PENALTY/CANCEL now quotable (CORPORATE live evidence)
  {
    const j = load('reports/cancel-perpax-multipax-list-corporate.json');
    cases.push({
      guideId: 'R3 / R4',
      guideTitle: 'Subset PENALTY + CANCEL — cancellationPaxList ["PAX1","PAX2"] on 3 ADT',
      trip: 'OW',
      stops: 'Direct',
      pax: '3 ADT',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: true,
      path: 'Request path (partial pax list)',
      result: 'Cancellation Requested · penaltyBasis PER_PAX_POLICY · amounts present',
      penaltyReq: req('PENALTY', j.fixture.pnr, {
        cancellationPaxList: ['PAX1', 'PAX2'],
        cancellationReason: 'guide R4/R3',
      }),
      cancelReq: req('CANCEL', j.fixture.pnr, {
        cancellationPaxList: ['PAX1', 'PAX2'],
        cancellationReason: 'guide R3',
      }),
      penaltyRes: envelope(j.penalty),
      cancelRes: envelope(j.cancel),
    });
  }

  // Guide R5 — sequential
  {
    const j = load('reports/cancel-perpax-sequential-subset.json');
    cases.push({
      guideId: 'R5',
      guideTitle: 'Sequential cancellations — PAX1 then PAX2',
      trip: 'OW',
      stops: 'Direct',
      pax: '2 ADT',
      fare: j.fixture.fareType,
      route: j.fixture.route,
      airline: j.fixture.airline,
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: j.fixture.onlineCancellation,
      path: 'Request path (partial, sequential)',
      result: 'Both steps Cancellation Requested with quotes',
      steps: [
        {
          label: 'R5 step 1 — ["PAX1"]',
          penaltyReq: req('PENALTY', j.fixture.pnr, {
            cancellationPaxList: ['PAX1'],
            cancellationReason: 'guide R5 step1',
          }),
          cancelReq: req('CANCEL', j.fixture.pnr, {
            cancellationPaxList: ['PAX1'],
            cancellationReason: 'guide R5 step1',
          }),
          penaltyRes: envelope(j.steps[0].penalty.raw),
          cancelRes: envelope(j.steps[0].cancel.raw),
        },
        {
          label: 'R5 step 2 — ["PAX2"]',
          penaltyReq: req('PENALTY', j.fixture.pnr, {
            cancellationPaxList: ['PAX2'],
            cancellationReason: 'guide R5 step2',
          }),
          cancelReq: req('CANCEL', j.fixture.pnr, {
            cancellationPaxList: ['PAX2'],
            cancellationReason: 'guide R5 step2',
          }),
          penaltyRes: envelope(j.steps[1].penalty.raw),
          cancelRes: envelope(j.steps[1].cancel.raw),
        },
      ],
    });
  }

  // Remaining after multi-list (R5-style continuation on 3ADT)
  {
    const j = load('reports/cancel-perpax-corporate-BR1786572156401139.json');
    const pnr = j.request.pnr;
    cases.push({
      guideId: 'R5 (remaining)',
      guideTitle: 'After multi-list — cancel remaining PAX3',
      trip: 'OW',
      stops: 'Direct',
      pax: '3 ADT',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr,
      onlineCancellation: true,
      path: 'Request path (remaining partial)',
      result: 'Cancellation Requested + quote',
      penaltyReq: req('PENALTY', pnr, {
        cancellationPaxList: ['PAX3'],
        cancellationReason: 'guide R5 remaining',
      }),
      cancelReq: req('CANCEL', pnr, {
        cancellationPaxList: ['PAX3'],
        cancellationReason: 'guide R5 remaining',
      }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // Multi-pax full direct — fee × pax (guide: cancellation fee per passenger)
  {
    const j = load('reports/cancel-perpax-corporate-3adt-full.json');
    cases.push({
      guideId: 'D1 → D3 (×3 pax)',
      guideTitle: 'Whole PNR CANCEL — 3 ADT (charges × passengers)',
      trip: 'OW',
      stops: 'Direct',
      pax: '3 ADT',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: j.fixture.airline || '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: true,
      path: 'Direct (full PNR)',
      result: 'Cancelled · cancellationFee 350×3 = 1050',
      penaltyReq: req('PENALTY', j.fixture.pnr, { cancellationReason: 'guide D1 3ADT' }),
      cancelReq: req('CANCEL', j.fixture.pnr, { cancellationReason: 'guide D3 3ADT' }),
      penaltyRes: envelope(j.penalty.raw),
      cancelRes: envelope(j.cancel.raw),
    });
  }

  // All via list → FULL_PAX (guide: list covering everyone)
  {
    const j = load('reports/cancel-perpax-all-via-list.json');
    const pen = j.penalty.raw || j.penalty;
    const can = j.cancel.raw || j.cancel;
    cases.push({
      guideId: 'Full via list',
      guideTitle: 'Cancel all pax using cancellationPaxList (scope FULL_PAX)',
      trip: 'OW',
      stops: 'Direct',
      pax: '2 ADT',
      fare: 'CORPORATE',
      route: 'DEL-BOM',
      airline: '6E',
      br: j.fixture.br,
      pnr: j.fixture.pnr,
      onlineCancellation: true,
      path: 'Direct via full pax list',
      result: 'Cancelled · paxScope FULL_PAX',
      penaltyReq: req('PENALTY', j.fixture.pnr, {
        cancellationPaxList: ['PAX1', 'PAX2'],
        cancellationReason: 'guide all-via-list',
      }),
      cancelReq: req('CANCEL', j.fixture.pnr, {
        cancellationPaxList: ['PAX1', 'PAX2'],
        cancellationReason: 'guide all-via-list',
      }),
      penaltyRes: envelope(pen),
      cancelRes: envelope(can),
    });
  }

  // Guide §8 RT — cancel one leg, other intact
  {
    const j = load('reports/cancel-perpax-s5-complete-and-offline.json');
    const s = j.s5Complete;
    cases.push({
      guideId: '§8 RT regression',
      guideTitle: 'Round trip — cancel return PNR only (onward untouched)',
      trip: 'RT',
      stops: 'Direct',
      pax: '2 ADT',
      fare: 'CORPORATE',
      route: 'DEL-BOM (round trip)',
      airline: '6E',
      br: s.br,
      pnr: s.returnPnr,
      onwardPnr: 'G122SA',
      onlineCancellation: true,
      path: 'Direct on return leg only',
      result: `Return Cancelled · onward PNR G122SA intact · booking ${s.afterStatus}`,
      penaltyReq: req('PENALTY', s.returnPnr, { cancellationReason: 'guide RT return' }),
      cancelReq: req('CANCEL', s.returnPnr, { cancellationReason: 'guide RT return' }),
      penaltyRes: envelope(s.penalty.raw),
      cancelRes: envelope(s.cancel.raw),
    });
  }

  return cases;
}

function buildMarkdown(cases) {
  const L = [];
  L.push('# TravelVIP B2B API');
  L.push('## Flight cancellation — per-passenger charges');
  L.push('### Successful request & response pack (for client / docs)');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push('| Guide | Flight cancellation — per-passenger charges: testing guide |');
  L.push('| Environment | `https://canary-api.travelvip.ai` |');
  L.push('| Partner | `vgm` |');
  L.push('| Endpoint | `POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR` |');
  L.push('| Content | **Successful** PENALTY + CANCEL bodies only (live canary) |');
  L.push('');
  L.push('## Guide → evidence map');
  L.push('');
  L.push('| Guide case | Trip | Stops | Pax | Path | BR | Result |');
  L.push('|---|---|---|---|---|---|---|');
  for (const c of cases) {
    L.push(`| **${c.guideId}** — ${c.guideTitle} | **${c.trip}** | **${c.stops}** | **${c.pax}** | ${c.path} | \`${c.br}\` | ${c.result} |`);
  }
  L.push('');

  for (const c of cases) {
    L.push('---');
    L.push('');
    L.push(`## ${c.guideId}`);
    L.push(`### ${c.guideTitle}`);
    L.push('');
    L.push('| Field | Value |');
    L.push('|---|---|');
    L.push(`| Trip type | **${c.trip}** |`);
    L.push(`| Stops | **${c.stops}** |`);
    L.push(`| Passengers | **${c.pax}** |`);
    L.push(`| Fare | ${c.fare} |`);
    L.push(`| Route | ${c.route} |`);
    L.push(`| Airline | ${c.airline} |`);
    L.push(`| Pricing path | ${c.path} |`);
    L.push(`| Booking reference | \`${c.br}\` |`);
    L.push(`| PNR | \`${c.pnr}\` |`);
    if (c.onwardPnr) L.push(`| Other PNR | \`${c.onwardPnr}\` (intact) |`);
    L.push(`| onlineCancellation | ${c.onlineCancellation} |`);
    L.push(`| Result | ${c.result} |`);
    if (c.extra) L.push(`| Notes | ${c.extra} |`);
    L.push('');

    if (c.steps) {
      for (const s of c.steps) {
        L.push(`### ${s.label}`);
        L.push('');
        L.push('**PENALTY request**');
        L.push('```json');
        L.push(pretty(s.penaltyReq));
        L.push('```');
        L.push('');
        L.push('**PENALTY response — HTTP 200**');
        L.push('```json');
        L.push(pretty(s.penaltyRes));
        L.push('```');
        L.push('');
        L.push('**CANCEL request**');
        L.push('```json');
        L.push(pretty(s.cancelReq));
        L.push('```');
        L.push('');
        L.push('**CANCEL response — HTTP 200**');
        L.push('```json');
        L.push(pretty(s.cancelRes));
        L.push('```');
        L.push('');
      }
      continue;
    }

    L.push('### PENALTY request');
    L.push('```json');
    L.push(pretty(c.penaltyReq));
    L.push('```');
    L.push('');
    L.push('### PENALTY response — HTTP 200');
    L.push('```json');
    L.push(pretty(c.penaltyRes));
    L.push('```');
    L.push('');
    L.push('### CANCEL request');
    L.push('```json');
    L.push(pretty(c.cancelReq));
    L.push('```');
    L.push('');
    L.push('### CANCEL response — HTTP 200');
    L.push('```json');
    L.push(pretty(c.cancelRes));
    L.push('```');
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('## Notes');
  L.push('');
  L.push('1. `PENALTY` = quote only; `CANCEL` = perform cancel / open request.');
  L.push('2. Partial pax → expect `paxScope.scope: PARTIAL_PAX` and usually `Cancellation Requested`.');
  L.push('3. Full online PNR → expect `Cancelled` when provider succeeds.');
  L.push('4. SSR appears under `perPax.ssr` / `refundSummary.cancellationChargeBreakup.ssrCharge` and is not refunded.');
  L.push('5. Seed-only guide cases (R7 PERCENT, R8 no-policy, offline `onlineCancellation=false`) are not in this pack.');
  L.push('');
  L.push('*TravelVIP API QA — canary success evidence against per-passenger cancel testing guide.*');
  L.push('');
  return L.join('\n');
}

function writePdf(cases) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 48,
      size: 'A4',
      info: {
        Title: 'TravelVIP Per-Passenger Cancel — Guide Success Request/Response',
        Author: 'TravelVIP API QA',
      },
    });
    const stream = fs.createWriteStream(OUT_PDF);
    doc.pipe(stream);
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const h1 = (t) => {
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text(t, { width: W });
      doc.moveDown(0.35);
    };
    const h2 = (t) => {
      doc.moveDown(0.35);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(t, { width: W });
      doc.moveDown(0.2);
    };
    const h3 = (t) => {
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222').text(t, { width: W });
      doc.moveDown(0.1);
    };
    const p = (t) => {
      doc.font('Helvetica').fontSize(9).fillColor('#222').text(t, { width: W, lineGap: 1.4 });
    };
    const meta = (k, v) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(`${k}: `, { continued: true });
      doc.font('Helvetica').fillColor('#111').text(String(v));
    };
    const code = (obj) => {
      if (doc.y > doc.page.height - 150) doc.addPage();
      doc.font('Courier').fontSize(6.8).fillColor('#111').text(pretty(obj), { width: W, lineGap: 0.4 });
      doc.moveDown(0.25);
      doc.font('Helvetica');
    };

    h1('TravelVIP B2B API');
    h2('Flight cancellation — per-passenger charges');
    p('Successful PENALTY + CANCEL request/response pack for client documentation.');
    p('Mapped to: Flight cancellation — per-passenger charges: testing guide');
    p('Env: https://canary-api.travelvip.ai  |  Partner: vgm');
    p('Endpoint: POST /v1/flights/booking/{bookingReference}/cancel?lang=en&currency=INR');
    doc.moveDown(0.3);

    h2('Guide → evidence index');
    for (const c of cases) {
      p(`${c.guideId}  |  ${c.trip}/${c.stops}/${c.pax}  |  ${c.br}  |  ${c.result}`);
    }

    for (const c of cases) {
      doc.addPage();
      h2(`${c.guideId}`);
      p(c.guideTitle);
      doc.moveDown(0.15);
      meta('Trip type', c.trip);
      meta('Stops', c.stops);
      meta('Passengers', c.pax);
      meta('Fare', c.fare);
      meta('Route', c.route);
      meta('Airline', c.airline);
      meta('Pricing path', c.path);
      meta('Booking reference', c.br);
      meta('PNR', c.pnr);
      if (c.onwardPnr) meta('Other PNR (intact)', c.onwardPnr);
      meta('onlineCancellation', c.onlineCancellation);
      meta('Result', c.result);
      if (c.extra) meta('Notes', c.extra);

      if (c.steps) {
        for (const s of c.steps) {
          h3(s.label);
          h3('PENALTY request');
          code(s.penaltyReq);
          h3('PENALTY response — HTTP 200');
          code(s.penaltyRes);
          h3('CANCEL request');
          code(s.cancelReq);
          h3('CANCEL response — HTTP 200');
          code(s.cancelRes);
        }
      } else {
        h3('PENALTY request');
        code(c.penaltyReq);
        h3('PENALTY response — HTTP 200');
        code(c.penaltyRes);
        h3('CANCEL request');
        code(c.cancelReq);
        h3('CANCEL response — HTTP 200');
        code(c.cancelRes);
      }
    }

    doc.addPage();
    h2('Integrator notes');
    p('1. PENALTY = quote only; CANCEL = perform cancel / open request.');
    p('2. Partial pax → paxScope.PARTIAL_PAX and usually Cancellation Requested.');
    p('3. Full online PNR → Cancelled when provider succeeds.');
    p('4. SSR is withheld (perPax.ssr / breakup ssrCharge).');
    p('5. Seed-only guide cases (R7 PERCENT, R8 no-policy, offline flag) are out of this pack.');
    doc.moveDown(0.8);
    p('TravelVIP API QA — canary success evidence.');

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
    console.log(`  ${c.guideId} | ${c.trip}/${c.stops}/${c.pax} | ${c.br}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

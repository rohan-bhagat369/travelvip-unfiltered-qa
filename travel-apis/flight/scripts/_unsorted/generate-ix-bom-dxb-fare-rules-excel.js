import path from 'path';
import { readFileSync } from 'fs';
import XLSX from 'xlsx';

const plain = readFileSync(
  path.resolve('scripts/_ix_bom_dxb_farerules_full.txt'),
  'utf8'
);

const metaRows = [
  {
    Field: 'Airline',
    Value: 'IX (Air India Express)',
  },
  {
    Field: 'Route searched',
    Value: 'BOM → DXB (ONE_WAY)',
  },
  {
    Field: 'Travel date',
    Value: '2026-09-08',
  },
  {
    Field: 'Fare rules title',
    Value: 'I5LT (Lite)',
  },
  {
    Field: 'Applicable brand for this option',
    Value: 'Lite',
  },
  {
    Field: 'Fee unit',
    Value: 'Per passenger per sector',
  },
  {
    Field: 'Rule effective from',
    Value: "Tickets issued on & after 04 Nov'25",
  },
  {
    Field: 'Environment',
    Value: 'PROD (api.travelvip.ai)',
  },
];

/** @type {Array<Record<string, string>>} */
const feeRows = [];

function addFee({
  fareType,
  action,
  timeWindow,
  route,
  fee,
  appliesToThisBooking = 'No',
  notes = '',
}) {
  feeRows.push({
    Airline: 'IX',
    FareType: fareType,
    Action: action,
    TimeWindow: timeWindow,
    Route: route,
    Fee: fee,
    Unit: 'Per pax per sector',
    AppliesToThisBooking: appliesToThisBooking,
    Notes: notes,
  });
}

function parseSingleFeeLines(block, fareType, action, timeWindow, bookingRouteNote) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^Ex[.\s]+(.+?)\s*:\s*(.+?)\s*Per pax per sector\s*$/i);
    if (!m) continue;
    const route = m[1].replace(/\s+/g, ' ').trim();
    const fee = m[2].replace(/\s+/g, ' ').trim();
    const isUaeLite =
      fareType === 'Lite' &&
      action === 'Reschedule' &&
      /India\s+to\s+UAE/i.test(route);
    addFee({
      fareType,
      action,
      timeWindow,
      route,
      fee,
      appliesToThisBooking: isUaeLite ? 'Yes' : 'No',
      notes: isUaeLite ? bookingRouteNote : '',
    });
  }
}

function parseDualFeeLines(block, fareType, action, winA, winB) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Ex India to UAE :INR 4000 Per pax per sector INR 6000 Per pax per sector
    const m = line.match(
      /^Ex[.\s]+(.+?)\s*:\s*(.+?)\s*Per pax per sector\s+(.+?)\s*Per pax per sector\s*$/i
    );
    if (m) {
      const route = m[1].replace(/\s+/g, ' ').trim();
      addFee({
        fareType,
        action,
        timeWindow: winA,
        route,
        fee: m[2].replace(/\s+/g, ' ').trim(),
      });
      addFee({
        fareType,
        action,
        timeWindow: winB,
        route,
        fee: m[3].replace(/\s+/g, ' ').trim(),
      });
      continue;
    }
    // Flex style: Ex India to UAE :Nil + Fare Difference INR 650 Per pax per sector
    const m2 = line.match(
      /^Ex[.\s]+(.+?)\s*:\s*(Nil\s*\+\s*Fare Difference)\s+(.+?)\s*Per pax per sector\s*$/i
    );
    if (m2) {
      const route = m2[1].replace(/\s+/g, ' ').trim();
      // Source text is ambiguous for dual window; keep as stated for >72hrs / 2-72hrs pattern used elsewhere in Flex reschedule inbound
      addFee({
        fareType,
        action,
        timeWindow: `${winA} (as printed; paired with fee on same line)`,
        route,
        fee: `${m2[2]} ${m2[3]}`.replace(/\s+/g, ' ').trim(),
        notes: 'Source prints Nil+FareDiff then amount on one line',
      });
      continue;
    }
  }
}

const sections = plain.split(/Fare type\s*:/i).slice(1);

for (const section of sections) {
  const fareType = section.split('\n')[0].trim().replace(/^-+\s*$/, '');
  const name = fareType.split('\n')[0].trim();

  if (/^Lite/i.test(name)) {
    addFee({
      fareType: 'Lite',
      action: 'Cancellation',
      timeWindow: 'Up to 2 hrs prior to departure',
      route: 'All (Lite)',
      fee: 'Non-Refundable (Base + Surcharge); airport taxes refundable',
      appliesToThisBooking: 'Yes',
      notes: 'Applies to this BOM-DXB I5LT option',
    });
    addFee({
      fareType: 'Lite',
      action: 'Reschedule',
      timeWindow: 'Within 2 hrs to 24 hrs',
      route: 'All (Lite)',
      fee: '100% (Base + Fuel Surcharge)',
      appliesToThisBooking: 'Yes',
      notes: 'Applies to this BOM-DXB I5LT option',
    });
    const resched = section.split(/Reschedule Fee More Than[^]*?Charges as per below/i)[1] || '';
    const reschedBlock = resched.split(/-In EXPRESS RETURN/i)[0];
    parseSingleFeeLines(
      reschedBlock,
      'Lite',
      'Reschedule',
      'More than 24 hrs',
      'BOM→DXB relevant (India→UAE)'
    );
  } else if (/Value\/Family/i.test(name)) {
    addFee({
      fareType: 'Value/Family/Return/Sale/Promo/Business',
      action: 'Cancellation',
      timeWindow: 'Within 2 hrs to 24 hrs',
      route: 'All (this fare type)',
      fee: '100% (Base + Fuel Surcharge)',
    });
    addFee({
      fareType: 'Value/Family/Return/Sale/Promo/Business',
      action: 'Reschedule',
      timeWindow: 'Within 2 hrs to 24 hrs',
      route: 'All (this fare type)',
      fee: '100% (Base + Fuel Surcharge)',
    });
    const cancelPart = (section.split(/Cancellation Fee More Than[^]*?Charges as per below/i)[1] || '')
      .split(/Reschedule Fee within/i)[0];
    parseSingleFeeLines(
      cancelPart,
      'Value/Family/Return/Sale/Promo/Business',
      'Cancellation',
      'More than 24 hrs'
    );
    const reschedPart = (section.split(/Reschedule Fee More Than[^]*?Charges as per below/i)[1] || '')
      .split(/-In EXPRESS RETURN/i)[0];
    parseSingleFeeLines(
      reschedPart,
      'Value/Family/Return/Sale/Promo/Business',
      'Reschedule',
      'More than 24 hrs'
    );
  } else if (/^Classic/i.test(name)) {
    const cancelPart = (section.split(/Cancellation Fee More than[^]*?\n/i)[1] || '')
      .split(/Reschedule Fee More than/i)[0];
    parseDualFeeLines(
      cancelPart,
      'Classic',
      'Cancellation',
      'More than 72 hrs',
      'Within 2 hrs to 72 hrs'
    );
    const reschedPart = (section.split(/Reschedule Fee More than[^]*?\n/i)[1] || '')
      .split(/-In EXPRESS RETURN/i)[0];
    parseDualFeeLines(
      reschedPart,
      'Classic',
      'Reschedule',
      'More than 72 hrs',
      'Within 2 hrs to 72 hrs'
    );
  } else if (/^Flex/i.test(name)) {
    const cancelPart = (section.split(/Cancellation Fee More than[^]*?\n/i)[1] || '')
      .split(/Reschedule Fee More than/i)[0];
    parseDualFeeLines(
      cancelPart,
      'Flex',
      'Cancellation',
      'More than 72 hrs',
      'Within 2 hrs to 72 hrs'
    );
    const reschedPart = (section.split(/Reschedule Fee More than[^]*?\n/i)[1] || '')
      .split(/-In EXPRESS RETURN/i)[0];
    // Flex reschedule mix of dual and Nil+FareDiff single
    const lines = reschedPart.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const dual = line.match(
        /^Ex[.\s]+(.+?)\s*:\s*(.+?)\s*Per pax per sector\s+(.+?)\s*Per pax per sector\s*$/i
      );
      if (dual) {
        const route = dual[1].replace(/\s+/g, ' ').trim();
        addFee({
          fareType: 'Flex',
          action: 'Reschedule',
          timeWindow: 'More than 72 hrs',
          route,
          fee: dual[2].replace(/\s+/g, ' ').trim(),
        });
        addFee({
          fareType: 'Flex',
          action: 'Reschedule',
          timeWindow: 'Within 2 hrs to 72 hrs',
          route,
          fee: dual[3].replace(/\s+/g, ' ').trim(),
        });
        continue;
      }
      const nil = line.match(
        /^Ex[.\s]+(.+?)\s*:\s*Nil\s*\+\s*Fare Difference\s+(.+?)\s*Per pax per sector\s*$/i
      );
      if (nil) {
        const route = nil[1].replace(/\s+/g, ' ').trim();
        addFee({
          fareType: 'Flex',
          action: 'Reschedule',
          timeWindow: 'More than 72 hrs',
          route,
          fee: 'Nil + Fare Difference',
        });
        addFee({
          fareType: 'Flex',
          action: 'Reschedule',
          timeWindow: 'Within 2 hrs to 72 hrs',
          route,
          fee: nil[2].replace(/\s+/g, ' ').trim(),
          notes: 'Parsed from Nil + Fare Difference <amount> line',
        });
      }
    }
  } else if (/Corporate Value/i.test(name)) {
    const cancelPart = (section.split(/Cancellation Fee More than[^]*?\n/i)[1] || '')
      .split(/Reschedule Fee More than/i)[0];
    parseDualFeeLines(
      cancelPart,
      'Corporate Value',
      'Cancellation',
      'More than 72 hrs',
      'Within 2 hrs to 72 hrs'
    );
    const reschedPart = (section.split(/Reschedule Fee More than[^]*?\n/i)[1] || '')
      .split(/-In EXPRESS RETURN/i)[0];
    parseDualFeeLines(
      reschedPart,
      'Corporate Value',
      'Reschedule',
      'More than 72 hrs',
      'Within 2 hrs to 72 hrs'
    );
  }
}

const otherRows = [
  {
    Category: 'Common note',
    Detail:
      'EXPRESS RETURN fare — one sector cancellation not permitted as per airline',
  },
  {
    Category: 'Common note',
    Detail:
      'Cancellation/Reschedule with origin outside India — charges may differ due to FX',
  },
  {
    Category: 'Common note',
    Detail:
      'Combination of different fare types — both fare rules applied segment-wise',
  },
  {
    Category: 'Note',
    Detail: "Fare rule applicable for tickets issued on & after 04th Nov'25",
  },
  {
    Category: 'Note',
    Detail: 'On cancellation, all chargeable SSR / Ancillary is Non refundable',
  },
  {
    Category: 'Other condition',
    Detail:
      'Changes and Cancellations permitted up to 2 hrs before scheduled departure; fare difference may apply',
  },
  {
    Category: 'Other condition',
    Detail:
      'Facilitation Fee Rs.100 per passenger per flight — Tele Check-in at Reservations (new & existing bookings)',
  },
  {
    Category: 'Other condition',
    Detail:
      'Additional Rs.250 per passenger per flight for change/cancel via Reservations / Corporate desk / Airport Ticketing Counters',
  },
  {
    Category: 'Other condition',
    Detail: 'Promotional fares are Non Changeable and Non-Refundable',
  },
  {
    Category: 'Other condition',
    Detail:
      'Friends & Family: min 2 / max 9 pax; on cancel & partial reissuance minimum 2 passengers must remain in PNR',
  },
  {
    Category: 'Other condition',
    Detail:
      'Partial cancellation not allowed on Special / GoReturn & discounted fares',
  },
  {
    Category: 'Other condition',
    Detail:
      'No-show or not cancelled within stipulated time — only statutory taxes refundable',
  },
  {
    Category: 'Other condition',
    Detail: 'Partial cancellation not allowed on Round-trip special fare',
  },
  {
    Category: 'Disclaimer',
    Detail:
      'Guideline only; subject to airline change without notice; Riya Travels undertakes no liability for incorrect information',
  },
];

const wb = XLSX.utils.book_new();
const wsMeta = XLSX.utils.json_to_sheet(metaRows);
const wsFees = XLSX.utils.json_to_sheet(feeRows);
const wsOther = XLSX.utils.json_to_sheet(otherRows);

wsMeta['!cols'] = [{ wch: 32 }, { wch: 48 }];
wsFees['!cols'] = [
  { wch: 8 },
  { wch: 38 },
  { wch: 14 },
  { wch: 32 },
  { wch: 28 },
  { wch: 42 },
  { wch: 20 },
  { wch: 22 },
  { wch: 40 },
];
wsOther['!cols'] = [{ wch: 18 }, { wch: 110 }];

XLSX.utils.book_append_sheet(wb, wsMeta, 'Search Context');
XLSX.utils.book_append_sheet(wb, wsFees, 'Fare Fees');
XLSX.utils.book_append_sheet(wb, wsOther, 'Notes & Conditions');

const out = path.resolve('docs/IX-BOM-DXB-Fare-Rules.xlsx');
XLSX.writeFile(wb, out);
console.log('Wrote', out);
console.log('Fee rows:', feeRows.length);
console.log(
  'AppliesToThisBooking Yes:',
  feeRows.filter((r) => r.AppliesToThisBooking === 'Yes').length
);

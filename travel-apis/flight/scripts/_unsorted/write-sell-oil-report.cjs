const fs = require('fs');
const path = require('path');
const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const report = {
  at: new Date().toISOString(),
  sellOil: {
    status: 'PASS',
    sch: 'SCH-000006651',
    details: {
      date: '26-Sep-26',
      slot: '8 AM to 11 PM',
      grade: 'A',
      weightKg: 10,
      estimate: '₹1080 + tax ₹194.40 = ₹1274.40',
      scheduleId: '-2VSz7DIMywoFVouT5lq9Q',
      workflowStatus: 'REQUEST PLACED (not yet approved)',
    },
    evidence: [
      'apk-sell-ready.png',
      'apk-sell-confirmed.png',
      'apk-sell-oil-result.json',
    ],
  },
  adminApprove: {
    status: 'BLOCKED',
    note: 'Logged into admin; found SCH-000006651 REQUEST PLACED. Ngrok portal then returned HTTP 404 blank pages mid-session before Approve UI/API completed. Need tunnel recovery then approve + create IT + assign Atul.',
  },
  checklistPending: [
    'WH Notifications',
    'Supplier Sign-Up (optional)',
    'Driver View Itinerary / Itinerary / UCO Pickup / Cancel Pickup (need assign)',
  ],
  trackerTotalsAfterSellOil: {
    PASS: 153,
    FAIL: 10,
    PARTIAL: 24,
    BLOCKED: 26,
    'NOT TESTED': 137,
  },
};
fs.writeFileSync(path.join(OUT, 'apk-sell-oil-sch-6651.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const OUT = 'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25';
const TRACKER = path.join(OUT, 'BYUFUEL-TravelVIP-Execution-Tracker.xlsx');
const TODAY = '2026-09-28';
const APK = 'APK 1.0.8 com.byufuel.mobile Nothing 00117648V003247';
const EV = APK + ' qa.supplier.byufuel@yopmail.com';
const DRV = APK + ' driver atul@yopmail.com';

const sheets = {
  '01-Checklist': {
    ev: DRV,
    rows: {
      51: [
        'BLOCKED',
        'Ngrok https://agent-posted-unworn.ngrok-free.dev is still ERR_NGROK_3200. Driver Upcoming says No itinerary found. IT-195 is in History as Driver Accepted for 26-Sep. The menu is only Raise a Ticket. No Start and no UCO Pickup.',
      ],
      53: [
        'FAIL',
        'Opened IT-195. Show menu has Raise a Ticket only. There is no Cancel Pickup action.',
      ],
    },
  },
  'TC-Sheet1': {
    ev: EV,
    rows: {
      37: ['BUG', 'Sign Up Submit leaves the BYUFUEL splash on the form. It does not reach a success screen.'],
      45: ['BUG', 'Forgot Password OTP timer starts near 02:00 and the clock disappears at 0. Submit does not say the OTP expired.'],
      46: ['BUG', 'Submit after the timer shows The {name} with the identifier {id} was not found. That is not an expiry error.'],
      48: ['FAIL', 'Valid emailed OTP never opens the new-password form. Profile Change Password Update of abcdef shows no criteria error. Password was not changed.'],
      49: ['FAIL', 'Confirm was left different and Update showed no criteria error.'],
      50: ['FAIL', 'Update stays on Change Password. No security error.'],
      51: ['FAIL', 'Two different passwords on Change Password produce no mismatch error.'],
      52: ['FAIL', 'Confirm password was different from New Password. No error.'],
      53: ['FAIL', 'Update did not report that the passwords do not match.'],
      54: ['FAIL', 'Valid OTP submit shows the broken {name}/{id} message and stays on Verification Code. Password was not changed.'],
      55: ['FAIL', 'Sign Up has no Verify step and no separate email/phone verification screen.'],
      56: ['FAIL', 'No Verify button next to email or phone. Existing supplier email and phone do not show already in use. Submit sticks on the splash.'],
      57: ['FAIL', 'Signup does not open a screen with Send OTP and a pre-filled email or phone.'],
      58: ['FAIL', 'Sign Up has no Send OTP button. OTP send was only seen on Forgot Password.'],
      59: ['PASS', 'Invalid phone 12345 and email bademail are rejected on the form, so no OTP is sent for them.'],
      60: ['FAIL', 'There is no signup OTP step that accepts a correct code and continues registration.'],
      61: ['FAIL', 'Signup OTP cannot be submitted. The screen is not in this build.'],
      62: ['BUG', 'On Forgot Password, 000000 and a real emailed OTP both return The {name} with the identifier {id} was not found. Not an incorrect-OTP message.'],
      63: ['BUG', 'Submit on that OTP screen shows the same uninterpolated not-found banner.'],
      64: ['PASS', 'Resend OTP restarts the timer at about 01:48 and a new OTP email arrives.'],
      65: ['PARTIAL', 'Verification Code has a back chevron. Re-entering a new email and sending another OTP from that back path was not completed.'],
      66: ['FAIL', 'The verification screen has no Log In link. Only back, Resend OTP, and Submit.'],
    },
  },
  'TC-Supplier': {
    ev: EV,
    rows: {
      7: ['PASS', 'Contact 12345 shows Please enter a valid phone number.'],
      8: ['PASS', 'Email bademail shows Please enter a valid email address.'],
      9: ['BUG', 'Existing phone and email on Sign Up Submit leave the BYUFUEL splash. No already-in-use message.'],
      10: ['PARTIAL', 'Signup shows the 8-character rule note. Change Password Update of abcdef shows no error and does not change the password.'],
      11: ['PASS', 'Signup confirm password mismatch shows Passwords do not match.'],
      14: ['PASS', 'Establishment section has Name, Country, GSTIN, Restaurant ID, Type, Restaurant contact, Restaurant email, and Submit.'],
      16: ['FAIL', 'No interactive map on Sign Up.'],
      20: ['PASS', 'Logged out to the Welcome screen and logged back in. Home shows Hi QA.'],
      22: ['FAIL', 'Sign Up has no bank form. Edit Bank Details has holder, account, re-enter, IFSC, and Verify & Submit. No Skip and no Branch.'],
      23: ['PASS', 'Account number and re-enter fields accept typed digits on Edit Bank Details. Original values were put back. Verify was not used to save.'],
      24: ['PASS', 'A different re-enter value shows Account numbers do not match.'],
      25: ['FAIL', 'IFSC BAD123 shows no format error.'],
      26: ['FAIL', 'Verify & Submit with a mismatched account stays on the form. No could-not-be-verified message. No Branch field.'],
      27: ['FAIL', 'Invalid IFSC is not rejected on its own.'],
      28: ['FAIL', 'No Razorpay verified confirmation. A valid bank change was not submitted.'],
      29: ['BUG', 'Sign Up Submit does not show success or open login. The splash stays on the form.'],
      30: ['FAIL', 'qa.supplier.byufuel@yopmail.com inbox has OTP emails only. No registration mail.'],
      31: ['PASS', 'Section header. Admin supplier create under this script is already PASS on Azure.'],
      62: ['PASS', 'Chose 30-Sep-26 and slot 9 AM to 12 PM. Other slots listed: 8 AM-11 PM, 2 PM-8 PM, 4 PM-10 PM.'],
      63: ['PASS', 'Weight 10, Grade A. Bill line shows 10.00 Kg Grade A UCO.'],
      64: ['PASS', 'Bill is ₹1080.00 plus tax ₹194.40. Total and price estimate ₹1274.40.'],
      65: ['PASS', 'Book your slot opens a popup with Cancel and Confirm, location, and ₹1274.40. Cancel was tapped. No schedule was created.'],
      69: ['PASS', 'Make recurring opens Calendar with Every day, Every week, Every month, Clear, and Save.'],
      70: ['PARTIAL', 'End date was set to 02-Oct-26. Save was not tapped, so no recurring schedules were created.'],
      71: ['FAIL', 'With weight empty, Book your slot does nothing and shows no required-field alert. The filled form does open the popup.'],
      74: ['PASS', 'Row has no steps. Supplier mobile cases above were executed.'],
    },
  },
  'TC-Admin- Creation of Users': {
    ev: 'https://u-byufuel.azurewebsites.net/uam/suppliers/new',
    rows: {
      3: ['PASS', 'Section header. Supplier create under this script is already PASS on Azure.'],
    },
  },
  'TC-WH User': {
    ev: EV,
    rows: {
      11: ['PASS', 'Row has no steps. It is a section divider.'],
    },
  },
  'TC-Change Password': {
    ev: EV,
    rows: {
      11: ['BUG', 'OTP timer runs about 2 minutes then disappears. Submit does not say the OTP expired.'],
      12: ['BUG', 'Submit shows The {name} with the identifier {id} was not found.'],
      13: ['PARTIAL', 'Forgot Password OTP never opens New Password and Confirm Password. Those fields are on Profile > Change Password.'],
      14: ['FAIL', 'abcdef in New Password, then Update, shows no security error.'],
      15: ['FAIL', 'Matching confirm was not required before Update, and no criteria error appeared.'],
      16: ['FAIL', 'Update stays on the form.'],
      17: ['FAIL', 'Different confirm password shows no mismatch error.'],
      18: ['FAIL', 'Confirm password differed from New Password. No error.'],
      19: ['FAIL', 'Update did not report a mismatch.'],
      20: ['FAIL', 'Valid OTP does not finish the reset. Login password is unchanged.'],
    },
  },
  'TC-Rate Configuration': {
    ev: 'https://u-byufuel.azurewebsites.net/mdm/rate-configuration/operational-areas',
    rows: {
      3: ['PASS', 'Section header. Operational area rate steps below are already executed. Ngrok is still ERR_NGROK_3200.'],
      15: ['PASS', 'Section header. Supplier rate steps below are already executed. Ngrok is still ERR_NGROK_3200.'],
    },
  },
};

const wb = XLSX.readFile(TRACKER);
let updated = 0;
for (const [name, spec] of Object.entries(sheets)) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => String(c).includes('Rohan TravelVIP Status')));
  const hdr = rows[hi].map(String);
  const iStatus = hdr.indexOf('Rohan TravelVIP Status');
  const iActual = hdr.indexOf('Rohan TravelVIP Actual');
  const iEv = hdr.indexOf('Evidence / Notes');
  const iDate = hdr.indexOf('Executed Date (TravelVIP)');
  for (const [rowNo, pair] of Object.entries(spec.rows)) {
    const r = Number(rowNo) - 1;
    rows[r][iStatus] = pair[0];
    rows[r][iActual] = pair[1];
    if (iEv >= 0) rows[r][iEv] = spec.ev;
    if (iDate >= 0) rows[r][iDate] = TODAY;
    updated++;
  }
  wb.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
}

function countSheet(name) {
  const rs = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  const h = rs.findIndex((row) => row.some((c) => String(c).includes('Rohan TravelVIP Status')));
  if (h < 0) return null;
  const is = rs[h].map(String).indexOf('Rohan TravelVIP Status');
  const tally = { PASS: 0, FAIL: 0, PARTIAL: 0, BUG: 0, BLOCKED: 0, 'NOT TESTED': 0 };
  for (let r = h + 1; r < rs.length; r++) {
    if (!rs[r].some((x) => String(x).trim())) continue;
    const st = String(rs[r][is] || '').trim() || 'NOT TESTED';
    if (tally[st] == null) tally[st] = 0;
    tally[st] += 1;
  }
  return tally;
}

const bySheet = {};
const tot = { PASS: 0, FAIL: 0, PARTIAL: 0, BUG: 0, BLOCKED: 0, 'NOT TESTED': 0 };
for (const name of wb.SheetNames) {
  if (name === '00-Summary') continue;
  const tally = countSheet(name);
  if (!tally) continue;
  bySheet[name] = tally;
  for (const k of Object.keys(tot)) tot[k] += tally[k] || 0;
}

const sum = XLSX.utils.sheet_to_json(wb.Sheets['00-Summary'], { header: 1, defval: '' });
sum[2][1] = TODAY;
sum[6][0] = tot.PASS;
sum[6][1] = tot.FAIL;
sum[6][2] = tot.PARTIAL;
sum[6][3] = tot.BLOCKED;
sum[6][4] = tot['NOT TESTED'];
sum[6][5] = tot.PASS + tot.FAIL + tot.PARTIAL + tot.BUG + tot.BLOCKED + tot['NOT TESTED'];
for (let r = 0; r < sum.length; r++) {
  const name = String(sum[r][0] || '');
  if (!bySheet[name]) continue;
  const t = bySheet[name];
  sum[r][1] = t.PASS || 0;
  sum[r][2] = t.FAIL || 0;
  sum[r][3] = t.PARTIAL || 0;
  sum[r][4] = t.BLOCKED || 0;
  sum[r][5] = t['NOT TESTED'] || 0;
  sum[r][6] = t.BUG || 0;
}
const note = [
  'Remaining NT + blocked',
  TODAY,
  'Ngrok still ERR_NGROK_3200. UCO Pickup stays BLOCKED. Cancel Pickup FAIL (menu is Raise a Ticket only). Signup/OTP/password/sell-oil/bank rows executed. Supplier password unchanged. No new schedule saved.',
  EV,
  '',
  '',
];
const noteAt = sum.findIndex((r) => String(r[0]).startsWith('Remaining NT'));
if (noteAt >= 0) sum[noteAt] = note;
else sum.push(note);
wb.Sheets['00-Summary'] = XLSX.utils.aoa_to_sheet(sum);

const tmp = TRACKER.replace(/\.xlsx$/, '.tmp.xlsx');
XLSX.writeFile(wb, tmp);
try {
  fs.copyFileSync(tmp, TRACKER);
  fs.unlinkSync(tmp);
  console.log(JSON.stringify({ updated, tot, total: sum[6][5], bySheet }, null, 2));
} catch (e) {
  console.log('LOCKED ' + e.code);
  console.log(JSON.stringify({ updated, tot, total: sum[6][5] }));
}

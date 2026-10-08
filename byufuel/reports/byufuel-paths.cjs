const fs = require("fs");
const buf = fs.readFileSync("d:/Travel VIP API Automation/reports/byufuel-apk-extract/lib/arm64-v8a/libapp.so");
const set = new Set();
let cur = "";
const flush = () => {
  if (cur.length >= 4 && cur.length < 120 && cur.startsWith("/") && /[a-zA-Z]/.test(cur) && !cur.includes(" ")) {
    if (/api|order|fuel|auth|user|blob|station|container|payment|supplier|wallet|otp|login|driver|vehicle|route|trip|booking/i.test(cur)) {
      set.add(cur);
    }
  }
  cur = "";
};
for (const b of buf) {
  if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
  else flush();
}
flush();
[...set].sort().forEach((s) => console.log(s));

const fs = require('fs');
const buf = fs.readFileSync(
  'd:/Travel VIP API Automation/reports/byufuel-apk-extract/lib/arm64-v8a/libapp.so'
);
const interesting = new Set();
let cur = '';
const re = /byufuel|azurewebsites|azure-api|keycloak|openid|oauth|swagger|baseUrl|BASE_URL|\/api\/|realm/i;
const flush = () => {
  if (cur.length >= 6 && re.test(cur)) interesting.add(cur.slice(0, 300));
  cur = '';
};
for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
  else flush();
}
flush();
[...interesting].sort().forEach((s) => console.log(s));

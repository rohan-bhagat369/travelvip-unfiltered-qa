const fs = require('fs');
const xml = fs.readFileSync(
  'd:/Travel VIP API Automation/reports/byufuel-drive/apk-tsm-login-start.xml',
  'utf8'
);
const re = /<node [^>]*>/g;
let m;
while ((m = re.exec(xml))) {
  const attr = (n) => {
    const mm = m[0].match(new RegExp(n + '="([^"]*)"'));
    return mm ? mm[1] : '';
  };
  const t = attr('text');
  const d = attr('content-desc');
  const hint = attr('hint');
  const pwd = attr('password');
  const cls = attr('class');
  const bounds = attr('bounds');
  if (t || d || hint || pwd === 'true' || /EditText|TextField/.test(cls)) {
    console.log([cls.split('.').pop(), bounds, 'pwd=' + pwd, 't=' + t, 'd=' + d, 'h=' + hint].join(' | '));
  }
}

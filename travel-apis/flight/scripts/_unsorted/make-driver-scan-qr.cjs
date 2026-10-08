const fs = require('fs');
const path = require('path');
const QR = require('qrcode');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

const OUT = path.join(
  'd:/Travel VIP API Automation/reports/byufuel-drive/execution-2026-09-25'
);

async function make(code, name) {
  const payload = JSON.stringify({ Code: code });
  const file = path.join(OUT, name);
  await QR.toFile(file, payload, {
    errorCorrectionLevel: 'M',
    width: 600,
    margin: 4,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  const png = PNG.sync.read(fs.readFileSync(file));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  console.log(name, 'encoded=', payload, 'decoded=', decoded && decoded.data);
  return { file, payload, decoded: decoded && decoded.data };
}

(async () => {
  const a = await make('B-2609-3-00005', 'driver-scan-qr-B-2609-3-00005.png');
  await make('B-2609-3-00006', 'driver-scan-qr-B-2609-3-00006.png');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Driver Scan QR</title></head>
<body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:sans-serif">
  <h2>Driver Scan — JSON QR</h2>
  <p>Payload: <code>${a.payload}</code></p>
  <img src="driver-scan-qr-B-2609-3-00005.png" width="480" height="480" alt="scan qr"/>
  <p style="color:#666">Full-screen this page on PC → Driver app → Scan</p>
</body></html>`;
  const htmlPath = path.join(OUT, 'driver-scan-qr.html');
  fs.writeFileSync(htmlPath, html);
  console.log('html', htmlPath);
})();

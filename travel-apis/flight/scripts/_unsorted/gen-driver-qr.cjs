const QR = require('qrcode');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'reports', 'byufuel-drive');
fs.mkdirSync(outDir, { recursive: true });

// Exact driver payload from handoff + API qrCode field
const payload = JSON.stringify({ Code: 'B-2609-3-00003' });
const payload6 = JSON.stringify({ Code: 'B-2609-3-00006' });

async function main() {
  const files = [
    ['QR-B-2609-3-00003.png', payload],
    ['QR-B-2609-3-00006.png', payload6],
  ];
  for (const [name, data] of files) {
    const fp = path.join(outDir, name);
    await QR.toFile(fp, data, { width: 900, margin: 4, errorCorrectionLevel: 'H' });
    console.log('OK', name, 'bytes=', fs.statSync(fp).size, 'payload=', data);
  }

  // Fullscreen HTML — no path issues
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Driver Scan QR</title>
<style>
html,body{margin:0;height:100%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif}
img{width:min(92vw,92vh);height:auto}
code{font-size:16px;margin-top:10px}
</style></head>
<body>
<img id="q" alt="QR"/>
<code id="c"></code>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
  // Prefer offline PNG; also render live via QRCode lib as fallback canvas
  const payload = ${JSON.stringify(payload)};
  document.getElementById('c').textContent = payload;
  document.getElementById('q').src = 'QR-B-2609-3-00003.png';
</script>
</body></html>`;
  fs.writeFileSync(path.join(outDir, 'QR-SCAN-B-2609-3-00003.html'), html);

  // Also write a self-contained HTML that generates QR in-browser (most reliable for scan)
  const live = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SCAN ME — B-2609-3-00003</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
<style>
  html,body{margin:0;height:100%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Arial,sans-serif}
  canvas{width:min(90vw,90vh)!important;height:auto!important}
  h1{font-size:18px;margin:0 0 12px}
  p{font-size:14px;color:#333}
</style></head>
<body>
<h1>Point driver camera here</h1>
<canvas id="qr"></canvas>
<p id="p"></p>
<script>
  const payload = ${JSON.stringify(payload)};
  document.getElementById('p').textContent = payload;
  QRCode.toCanvas(document.getElementById('qr'), payload, { width: 512, margin: 4, errorCorrectionLevel: 'H' }, (err) => {
    if (err) document.getElementById('p').textContent = 'QR error: ' + err;
  });
</script>
</body></html>`;
  const livePath = path.join(outDir, 'QR-LIVE-SCAN.html');
  fs.writeFileSync(livePath, live);
  console.log('LIVE', livePath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

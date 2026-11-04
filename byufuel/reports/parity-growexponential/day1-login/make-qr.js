const QR = require("qrcode");
const path = process.argv[2];
const data = process.argv[3];
QR.toFile(path, data, { width: 800, margin: 2 })
  .then(() => console.log("wrote", path))
  .catch((e) => { console.error(e); process.exit(1); });

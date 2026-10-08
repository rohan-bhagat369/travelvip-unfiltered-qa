/**
 * Enhance a mobile-scanned invoice PDF (image pages) for clearer text.
 * Does NOT OCR or rewrite content — only contrast/sharpen the page images.
 *
 * Usage: node scripts/clean-scanned-invoice.js [input.pdf] [output.pdf]
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
const pdfjsPath = path.dirname(require.resolve('pdfjs-dist/package.json'));
const { getDocument } = await import(pathToFileURL(path.join(pdfjsPath, 'legacy/build/pdf.mjs')).href);

const input = process.argv[2] || 'Invoice..pdf';
const output = process.argv[3] || 'Invoice-clean.pdf';
const workDir = path.join('reports', 'invoice-clean-work');
fs.mkdirSync(workDir, { recursive: true });

const data = new Uint8Array(fs.readFileSync(input));
const doc = await getDocument({ data, disableWorker: true, verbosity: 0 }).promise;
console.log(`Input: ${input} (${doc.numPages} pages)`);

const cleaned = [];
const SCALE = 3;

for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  // White background (phone scans often look muddy)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const rawPng = await canvas.encode('png');
  fs.writeFileSync(path.join(workDir, `page-${i}-raw.png`), rawPng);

  const outPng = path.join(workDir, `page-${i}-clean.png`);
  await sharp(rawPng)
    .grayscale()
    .normalise({ lower: 1, upper: 99 })
    .modulate({ brightness: 1.05 })
    .linear(1.4, -24)
    .sharpen({ sigma: 1.5, m1: 1.3, m2: 0.5 })
    .png({ compressionLevel: 9 })
    .toFile(outPng);

  cleaned.push(outPng);
  console.log(`  page ${i}: ${Math.round(fs.statSync(outPng).size / 1024)} KB`);
}

const pdf = await PDFDocument.create();
for (const p of cleaned) {
  const png = await pdf.embedPng(fs.readFileSync(p));
  const A4W = 595.28;
  const A4H = 841.89;
  const page = pdf.addPage([A4W, A4H]);
  const scale = Math.min(A4W / png.width, A4H / png.height);
  const w = png.width * scale;
  const h = png.height * scale;
  page.drawImage(png, {
    x: (A4W - w) / 2,
    y: (A4H - h) / 2,
    width: w,
    height: h,
  });
}

const bytes = await pdf.save();
fs.writeFileSync(output, bytes);
fs.writeFileSync(path.join('reports', path.basename(output)), bytes);
console.log(`Clean PDF: ${output} (${Math.round(bytes.length / 1024)} KB)`);
console.log('No OCR / no text changes — image contrast + sharpen only.');

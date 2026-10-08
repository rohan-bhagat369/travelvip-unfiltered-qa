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

const pdfPath = 'Gajanan-Invoices-172-173-final.pdf';
const bytes = fs.readFileSync(pdfPath);
const lib = await PDFDocument.load(bytes);
console.log('pages', lib.getPageCount());
console.log('page0', lib.getPage(0).getSize());
if (lib.getPageCount() > 1) console.log('page1', lib.getPage(1).getSize());

const doc = await getDocument({ data: new Uint8Array(bytes), disableWorker: true, verbosity: 0 }).promise;
const outDir = 'reports/invoice-clean-work';
for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const png = await canvas.encode('png');
  const pagePath = path.join(outDir, `final-page-${i}.png`);
  fs.writeFileSync(pagePath, png);
  const meta = await sharp(png).metadata();
  console.log('wrote', pagePath, meta.width, meta.height);
  const left = Math.round(meta.width * 0.62);
  const top = Math.round(meta.height * 0.78);
  const width = meta.width - left - 20;
  const height = meta.height - top - 20;
  const sigPath = path.join(outDir, `final-sig-crop-${i}.png`);
  await sharp(png).extract({ left, top, width, height }).png().toFile(sigPath);
  console.log('sig crop', i, left, top, width, height);
}

const html = fs.readFileSync('reports/gajanan-invoices-final.html', 'utf8');
const srcs = [...html.matchAll(/src="(data:image\/png;base64,[^"]+)"/g)].map((m) => m[1]);
console.log('html sigs', srcs.length, 'same', srcs[0] === srcs[1]);
console.log('has banner', html.includes('DRAFT FOR INTERNAL'));
console.log('has summary', html.includes('Draft cross-check'));
console.log('has checknote', html.includes('Combined check'));

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const work = 'reports/invoice-clean-work';
const srcSig = path.join(work, 'signature-2.png');
const sharedSig = path.join(work, 'signature-shared.png');

await sharp(srcSig)
  .trim({ threshold: 18 })
  .png()
  .toFile(sharedSig);

const meta = await sharp(sharedSig).metadata();
const uri = `data:image/png;base64,${fs.readFileSync(sharedSig).toString('base64')}`;
console.log('shared signature', meta.width, 'x', meta.height, 'bytes', fs.statSync(sharedSig).size);

let html = fs.readFileSync('reports/gajanan-invoices-draft-client-breakup.html', 'utf8');

html = html.replace(
  /<title>[\s\S]*?<\/title>/,
  '<title>Gajanan Tours &amp; Travels — Invoices 172 &amp; 173</title>'
);
html = html.replace(/<div class="banner">[\s\S]*?<\/div>\s*/, '');
html = html.replace(/<!-- ===== SUMMARY[\s\S]*?(?=<!-- ===== BILL 172)/, '');
html = html.replace(/<div class="checknote">[\s\S]*?<\/div>\s*/, '');
html = html.replace(/src="data:image\/png;base64,[^"]+"/g, `src="${uri}"`);

const sigCount = (html.match(/class="sig-img"/g) || []).length;
const uniqueSrc = new Set([...html.matchAll(/src="(data:image\/png;base64,[^"]+)"/g)].map((m) => m[1]));
if (sigCount !== 2 || uniqueSrc.size !== 1) {
  throw new Error(`Expected 2 identical signatures, got count=${sigCount} unique=${uniqueSrc.size}`);
}

fs.writeFileSync('reports/gajanan-invoices-final.html', html);
console.log('wrote reports/gajanan-invoices-final.html');
console.log('signatures', sigCount, 'identical', uniqueSrc.size === 1);

const fs = require('fs');
const path = require('path');
const name = process.argv[2];
const dir = __dirname;
const text = fs.readFileSync(path.join(dir, `${name}.tsv`), 'utf8');
const expr = `(() => {
  const text = ${JSON.stringify(text)};
  const nb = [...document.querySelectorAll('input')].find(i => (i.getAttribute('aria-label')||'').includes('A1') || i.value==='A1');
  if (nb) {
    nb.focus();
    nb.value = 'A1';
    nb.dispatchEvent(new Event('input', { bubbles: true }));
    nb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const targets = [document.activeElement, document.body].filter(Boolean);
  for (const t of targets) {
    t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  return { len: text.length, active: document.activeElement && document.activeElement.tagName };
})()`;
fs.writeFileSync(path.join(dir, `_eval_${name.replace(/[^a-zA-Z0-9_-]/g,'_')}.js`), expr);
console.log('wrote', expr.length);

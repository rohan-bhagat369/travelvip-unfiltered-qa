const fs = require('fs');
const path = require('path');
const t = fs.readFileSync(path.join(__dirname, '_checklist_status_I4.tsv'), 'utf8');
const expr = `(() => {
  const text = ${JSON.stringify(t)};
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  for (const el of [document.activeElement, document.body]) {
    if (el) el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  return { len: text.length, active: document.activeElement && document.activeElement.tagName };
})()`;
fs.writeFileSync(path.join(__dirname, '_eval_status.js'), expr);
console.log('ok', expr.length);

// Dump tesseract lines for fixtures (used to record OCR fixtures for offline tests).
import { createWorker } from 'tesseract.js'; import fs from 'node:fs';
const w = await createWorker(['fin','eng']);
await w.setParameters({ tessedit_pageseg_mode: '11' });
for (const f of process.argv.slice(2)) {
  const r = await w.recognize(f, {}, { blocks: true });
  const lines = []; for (const b of r.data.blocks) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text.trim(), conf: Math.round(l.confidence), bbox: l.bbox });
  fs.writeFileSync(f.replace(/\.png$/, '.ocr.json'), JSON.stringify(lines, null, 1));
}
await w.terminate();

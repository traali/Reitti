import { PNG } from "pngjs"; import fs from "node:fs"; import { traceRoute } from "../src/lib/trace.ts"; import { parseOcr } from "../src/lib/ocrparse.ts";
for (const f of ["waze-kesalahti-1","gmaps-levi-1","apple-tampere-1"]) {
  const p = PNG.sync.read(fs.readFileSync(`tests/fixtures/${f}.png`));
  const lines = JSON.parse(fs.readFileSync(`tests/fixtures/${f}.ocr.json`, "utf8"));
  const parsed = parseOcr(lines, p.width, p.height);
  console.log(f, JSON.stringify({ ...parsed, labels: parsed.labels.map(l => l.text) }));
  const t = traceRoute(p.data, p.width, p.height, lines.filter((l:any)=>l.conf>50).map((l:any)=>l.bbox));
  console.log(" trace", t && t.ends, t?.path.length);
  if (t) { for (const [x,y] of t.path) for (let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){const i=((Math.round(y)+dy)*p.width+Math.round(x)+dx)*4; p.data[i]=255;p.data[i+1]=0;p.data[i+2]=0;}
  fs.writeFileSync(`../trace-${f}.png`, PNG.sync.write(p)); }
}

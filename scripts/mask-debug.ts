import { PNG } from "pngjs"; import fs from "node:fs"; import { routeMask } from "../src/lib/trace.ts";
for (const f of ["waze-kesalahti-1","gmaps-levi-1","apple-tampere-1"]) {
  const p = PNG.sync.read(fs.readFileSync(`tests/fixtures/${f}.png`));
  const m = routeMask(p.data, p.width, p.height);
  for (let i=0;i<m.length;i++){ if(!m[i]){p.data[i*4]>>=2;p.data[i*4+1]>>=2;p.data[i*4+2]>>=2;} else {p.data[i*4]=255;p.data[i*4+1]=255;p.data[i*4+2]=0;} }
  fs.writeFileSync(`../mask-${f}.png`, PNG.sync.write(p));
}

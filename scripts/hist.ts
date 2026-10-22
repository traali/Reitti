import { PNG } from "pngjs"; import fs from "node:fs";
const p = PNG.sync.read(fs.readFileSync(`tests/fixtures/gmaps-levi-1.png`));
console.log(p.width, p.height, p.data.length / (p.width*p.height), p.colorType, p.depth);
const i=(1300*p.width+558)*4; console.log(p.data.slice(i,i+8));
function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}
const W=p.width,H=p.height,px=p.data; let strong=0; const hist=new Array(36).fill(0);
for (let i = 0; i < W * H; i += 2) { const [h, s, v] = hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); if (s > 0.8 && v > 0.35 && h >= 180 && h <= 260) {strong++; hist[Math.floor(h/10)]++;} }
console.log(strong, W*H*0.002, hist.slice(18,27));

// Find the highlighted (selected) route line in a screenshot: saturated blue/cyan pixels,
// minus thick blobs (labels, buttons), largest connected component, then the geodesic
// path between its two farthest points. Pure function over RGBA so it runs in browser and tests.
export interface Trace { path: [number, number][]; ends: [[number, number], [number, number]]; pixels: number; hue: number }

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
export function routeMask(px: Uint8ClampedArray | Uint8Array, W: number, H: number): Uint8Array {
  const m = new Uint8Array(W * H);
  // prefer very saturated pixels (selected route) when there are enough of them
  let strong = 0;
  for (let i = 0; i < W * H; i += 2) { const [h, s, v] = hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); if (s > 0.8 && v > 0.35 && h >= 180 && h <= 260) strong++; }
  const sMin = strong * 2 > W * H * 0.004 ? 0.8 : 0.5;
  // pass 1: histogram of strongly saturated blue-ish hues; pick the dominant 20° band
  const hist = new Float64Array(36);
  for (let i = 0; i < W * H; i += 2) {
    const [h, s, v] = hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    if (s > sMin && v > (sMin > 0.7 ? 0.35 : 0.55) && h >= 180 && h <= 260) hist[Math.floor(h / 10)] += 1;
  }
  let best = 18;
  for (let k = 18; k < 26; k++) if (hist[k] + hist[k + 1] > hist[best] + hist[best + 1]) best = k;
  const lo = best * 10 - 16, hi = best * 10 + 36;
  for (let i = 0; i < W * H; i++) {
    const [h, s, v] = hsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    if (s > sMin && v > (sMin > 0.7 ? 0.35 : 0.55) && h >= lo && h <= hi) m[i] = 1;
  }
  return m;
}

export function excludeBoxes(m: Uint8Array, W: number, H: number, exclude: Box[]): void {
  for (const b of exclude) for (let y = Math.max(0, Math.floor(b.y0) - 8); y < Math.min(H, b.y1 + 8); y++) for (let x = Math.max(0, Math.floor(b.x0) - 8); x < Math.min(W, b.x1 + 8); x++) m[y * W + x] = 0;
}

function integral(m: Uint8Array, W: number, H: number): Int32Array {
  const I = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += m[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  return I;
}
function boxSum(I: Int32Array, W: number, x0: number, y0: number, x1: number, y1: number): number {
  const w = W + 1; return I[y1 * w + x1] - I[y0 * w + x1] - I[y1 * w + x0] + I[y0 * w + x0];
}

export function traceRoute(px: Uint8ClampedArray | Uint8Array, W: number, H: number, exclude: Box[] = []): Trace | null {
  const mask = routeMask(px, W, H);
  // Morphological opening: blobs much thicker than a route line (bubbles, buttons) survive
  // erosion with radius e; dilate them back (+margin) and remove from the mask.
  const e = Math.max(6, Math.round(W / 80));
  const I = integral(mask, W, H);
  const core = new Uint8Array(W * H);
  for (let y = e; y < H - e; y++) for (let x = e; x < W - e; x++)
    if (mask[y * W + x] && boxSum(I, W, x - e, y - e, x + e + 1, y + e + 1) >= (2 * e + 1) ** 2 * 0.97) core[y * W + x] = 1;
  const Ic = integral(core, W, H);
  const g2 = e + 6;
  const thin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!mask[i]) continue;
    const x0 = Math.max(0, x - g2), y0 = Math.max(0, y - g2), x1 = Math.min(W, x + g2 + 1), y1 = Math.min(H, y + g2 + 1);
    if (boxSum(Ic, W, x0, y0, x1, y1) === 0) thin[i] = 1;
  }
  excludeBoxes(thin, W, H, exclude);
  // work on a downscaled grid (step s) with dilation to bridge small gaps
  const s = Math.max(2, Math.round(W / 300));
  const gw = Math.ceil(W / s), gh = Math.ceil(H / s);
  const g = new Uint8Array(gw * gh);
  const It = integral(thin, W, H);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x0 = gx * s, y0 = gy * s, x1 = Math.min(W, x0 + s), y1 = Math.min(H, y0 + s);
    if (boxSum(It, W, x0, y0, x1, y1) > 0) g[gy * gw + gx] = 1;
  }
  const DIL = Math.max(2, Math.round((e + 10) / s));
  const d = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (g[y * gw + x])
    for (let dy = -DIL; dy <= DIL; dy++) for (let dx = -DIL; dx <= DIL; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < gw && Y < gh) d[Y * gw + X] = 1; }
  // components; score = bbox diagonal
  const lab = new Int32Array(gw * gh).fill(-1);
  let bestC = -1, bestScore = 0, bestSeed = -1, bestN = 0, c = 0;
  const q = new Int32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    if (!d[i] || lab[i] >= 0) continue;
    let h = 0, t = 0; q[t++] = i; lab[i] = c;
    let mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1, n = 0;
    while (h < t) {
      const p = q[h++]; const x = p % gw, y = (p / gw) | 0; n++;
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
        const k = Y * gw + X; if (d[k] && lab[k] < 0) { lab[k] = c; q[t++] = k; }
      }
    }
    const score = Math.hypot(mxx - mnx, mxy - mny);
    if (score > bestScore) { bestScore = score; bestC = c; bestSeed = i; bestN = n; }
    c++;
  }
  if (bestC < 0 || bestScore * s < W * 0.15) return null;
  const bfs = (src: number) => {
    const dist = new Int32Array(gw * gh).fill(-1); const par = new Int32Array(gw * gh).fill(-1);
    let h = 0, t = 0; q[t++] = src; dist[src] = 0; let far = src;
    while (h < t) {
      const p = q[h++]; if (dist[p] > dist[far]) far = p;
      const x = p % gw, y = (p / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
        const k = Y * gw + X; if (lab[k] === bestC && dist[k] < 0) { dist[k] = dist[p] + 1; par[k] = p; q[t++] = k; }
      }
    }
    return { far, par };
  };
  const a = bfs(bestSeed).far; const { far: b, par } = bfs(a);
  const path: [number, number][] = [];
  for (let p = b; p >= 0; p = par[p]) path.push([(p % gw) * s + s / 2, ((p / gw) | 0) * s + s / 2]);
  const simp = path.filter((_, i) => i % 3 === 0 || i === path.length - 1);
  return { path: simp, ends: [simp[0], simp[simp.length - 1]], pixels: bestN * s * s, hue: 0 };
}

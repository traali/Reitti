// Find the "you are here" puck: a saturated blue/cyan disc inside a white ring, on a non-white background.
import type { Box } from "./trace";
function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}
export interface Dot { x: number; y: number; r: number; score: number }
export function findLocationDot(px: Uint8ClampedArray | Uint8Array, W: number, H: number, exclude: Box[] = []): Dot | null {
  const at = (x: number, y: number) => { const i = (Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))) * 4; return hsv(px[i], px[i + 1], px[i + 2]); };
  const blue = (x: number, y: number) => { const [h, s, v] = at(x, y); return s > 0.45 && v > 0.55 && h > 180 && h < 250; };
  const white = (x: number, y: number) => { const [, s, v] = at(x, y); return s < 0.18 && v > 0.72; };
  let best: Dot | null = null;
  const step = Math.max(2, Math.round(W / 400));
  const rMin = Math.round(W / 120), rMax = Math.round(W / 35);
  for (let y = rMin; y < H - rMin; y += step) for (let x = rMin; x < W - rMin; x += step) {
    if (!blue(x, y)) continue;
    if (exclude.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) continue;
    for (let r = rMin; r <= rMax; r += step) {
      let inner = 0, ring = 0, outer = 0; const N = 24;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
        if (blue(x + c * r * 0.6, y + s * r * 0.6)) inner++;
        if (white(x + c * r * 1.15, y + s * r * 1.15)) ring++;
        if (white(x + c * r * 1.9, y + s * r * 1.9)) outer++;
      }
      const score = inner / N + ring / N - outer / N;
      if (inner >= N * 0.9 && ring >= N * 0.75 && outer <= N * 0.4 && (!best || score > best.score)) best = { x, y, r, score };
    }
  }
  return best;
}

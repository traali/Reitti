// Georeference a north-up map screenshot from labelled places: pixel = s * mercator + offset.
export interface Anchor { px: number; py: number; lat: number; lon: number; name: string }
export interface Fit { s: number; ox: number; oy: number; rmsPx: number; used: Anchor[]; rejected: Anchor[] }
export const merc = (lat: number, lon: number): [number, number] => [lon / 360 + 0.5, 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)];
export const unmerc = (x: number, y: number): [number, number] => [(Math.atan(Math.sinh((0.5 - y) * 2 * Math.PI)) * 180) / Math.PI, (x - 0.5) * 360];

function lsq(a: Anchor[]): Omit<Fit, "used" | "rejected"> {
  // minimise sum (s*mx+ox-px)^2 + (s*my+oy-py)^2
  const n = a.length; const m = a.map((p) => merc(p.lat, p.lon));
  const mx = m.reduce((t, v) => t + v[0], 0) / n, my = m.reduce((t, v) => t + v[1], 0) / n;
  const px = a.reduce((t, v) => t + v.px, 0) / n, py = a.reduce((t, v) => t + v.py, 0) / n;
  let num = 0, den = 0;
  a.forEach((p, i) => { const dx = m[i][0] - mx, dy = m[i][1] - my; num += dx * (p.px - px) + dy * (p.py - py); den += dx * dx + dy * dy; });
  const s = den ? num / den : 0; const ox = px - s * mx, oy = py - s * my;
  const rms = Math.sqrt(a.reduce((t, p, i) => t + (s * m[i][0] + ox - p.px) ** 2 + (s * m[i][1] + oy - p.py) ** 2, 0) / n);
  return { s, ox, oy, rmsPx: rms };
}

/** Robust fit (exhaustive RANSAC over anchor pairs): the model with most inliers wins, refit on inliers.
 *  Inlier = residual under 6 % of screen width. Needs >= 2 consistent anchors. */
export function fitGeoref(anchors: Anchor[], width: number): Fit | null {
  const tol = width * 0.06;
  const resid = (f: Omit<Fit, "used" | "rejected">, p: Anchor) => { const [x, y] = merc(p.lat, p.lon); return Math.hypot(f.s * x + f.ox - p.px, f.s * y + f.oy - p.py); };
  let best: Anchor[] = [];
  let bestRms = Infinity;
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    const pair = [anchors[i], anchors[j]];
    if (Math.hypot(pair[0].px - pair[1].px, pair[0].py - pair[1].py) < width * 0.1) continue;
    const f = lsq(pair); if (!(f.s > 0)) continue;
    const inl = anchors.filter((p) => resid(f, p) < tol);
    const g = lsq(inl);
    if (inl.length > best.length || (inl.length === best.length && g.rmsPx < bestRms)) { best = inl; bestRms = g.rmsPx; }
  }
  if (best.length < 2) return null;
  const f = lsq(best); if (!(f.s > 0)) return null;
  return { ...f, used: best, rejected: anchors.filter((a) => !best.includes(a)) };
}
export function pixelToLatLon(f: Fit, px: number, py: number): [number, number] { return unmerc((px - f.ox) / f.s, (py - f.oy) / f.s); }

// Small planar-geometry helpers (local equirectangular projection; accurate to <1 % at these scales).
export type LL = [number, number]; // [lon, lat] (GeoJSON order)
const R = 6371008.8;
export function haversine(a: LL, b: LL): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function lineLength(line: LL[]): number { let d = 0; for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]); return d; }

/** Distance from p to the polyline and the along-line distance (m) of the nearest point. */
export function nearestOnLine(p: LL, line: LL[], cum?: number[]): { dist: number; along: number } {
  const c = cum ?? cumulative(line);
  let best = { dist: Infinity, along: 0 };
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180), ky = 110540;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * kx, ay = (line[i - 1][1] - p[1]) * ky;
    const bx = (line[i][0] - p[0]) * kx, by = (line[i][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.dist) best = { dist: d, along: c[i - 1] + t * (c[i] - c[i - 1]) };
  }
  return best;
}
export function cumulative(line: LL[]): number[] { const c = [0]; for (let i = 1; i < line.length; i++) c.push(c[i - 1] + haversine(line[i - 1], line[i])); return c; }

export interface BBox { minLon: number; minLat: number; maxLon: number; maxLat: number }
export function bboxOf(line: LL[], padM = 0): BBox {
  let b = { minLon: 180, minLat: 90, maxLon: -180, maxLat: -90 };
  for (const [x, y] of line) b = { minLon: Math.min(b.minLon, x), minLat: Math.min(b.minLat, y), maxLon: Math.max(b.maxLon, x), maxLat: Math.max(b.maxLat, y) };
  const dy = padM / 110540, dx = padM / (111320 * Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180));
  return { minLon: b.minLon - dx, minLat: b.minLat - dy, maxLon: b.maxLon + dx, maxLat: b.maxLat + dy };
}
export function intersects(a: BBox, b: BBox): boolean { return a.minLon <= b.maxLon && b.minLon <= a.maxLon && a.minLat <= b.maxLat && b.minLat <= a.maxLat; }

/** Every vertex of any geometry, flattened. */
export function vertices(g: any): LL[] {
  if (!g) return [];
  switch (g.type) {
    case "Point": return [g.coordinates];
    case "MultiPoint": case "LineString": return g.coordinates;
    case "MultiLineString": case "Polygon": return g.coordinates.flat();
    case "MultiPolygon": return g.coordinates.flat(2);
    case "GeometryCollection": return g.geometries.flatMap(vertices);
    default: return [];
  }
}
function pointInRing(p: LL, ring: LL[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Route corridor: a feature is "along the route" if any part is within `bufferM` of the line
 *  (vertex distance, segment midpoints for long segments, or the route passes through a polygon).
 *  Returns along-route position (m) for ordering, or null. */
export function alongRoute(g: any, line: LL[], cum: number[], bufferM: number): { dist: number; along: number } | null {
  const pts = densify(vertices(g), 50);
  let best: { dist: number; along: number } | null = null;
  for (const p of pts) { const n = nearestOnLine(p, line, cum); if (n.dist <= bufferM && (!best || n.dist < best.dist)) best = n; }
  if (best) return best;
  const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
  for (const poly of polys) for (let i = 0; i < line.length; i++) if (pointInRing(line[i], poly[0])) return { dist: 0, along: cum[i] };
  return null;
}
export function densify(pts: LL[], stepM: number): LL[] {
  if (pts.length < 2) return pts;
  const out: LL[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1], pts[i]); const n = Math.min(200, Math.floor(d / stepM));
    for (let k = 1; k <= n; k++) out.push([pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * k) / (n + 1), pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * k) / (n + 1)]);
    out.push(pts[i]);
  }
  return out;
}
/** Point at a given fraction of the route length. */
export function pointAt(line: LL[], cum: number[], frac: number): LL {
  const target = cum[cum.length - 1] * frac;
  for (let i = 1; i < line.length; i++) if (cum[i] >= target) { const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])]; }
  return line[line.length - 1];
}

/** Route corridor with a grid index so long routes (1000 km, 10k+ vertices) stay fast. */
export class Corridor {
  readonly cum: number[]; readonly length: number; private grid = new Map<string, number[]>(); private cell = 0.01;
  constructor(readonly line: LL[], readonly bufferM: number) {
    this.cum = cumulative(line); this.length = this.cum[this.cum.length - 1] ?? 0;
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]];
      for (let x = Math.floor(Math.min(a[0], b[0]) / this.cell); x <= Math.floor(Math.max(a[0], b[0]) / this.cell); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / this.cell); y <= Math.floor(Math.max(a[1], b[1]) / this.cell); y++) {
          const k = `${x},${y}`; const l = this.grid.get(k); if (l) l.push(i); else this.grid.set(k, [i]);
        }
    }
  }
  /** Nearest point on the route for p if within the buffer (else null). */
  near(p: LL): { dist: number; along: number } | null {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell);
    const kx = 111320 * Math.cos((p[1] * Math.PI) / 180), ky = 110540;
    let best: { dist: number; along: number } | null = null; const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (seen.has(i)) continue; seen.add(i);
      const a = this.line[i - 1], b = this.line[i];
      const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
      const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / L2)) : 0;
      const d = Math.hypot(ax + t * ex, ay + t * ey);
      if (d <= this.bufferM && (!best || d < best.dist)) best = { dist: d, along: this.cum[i - 1] + t * (this.cum[i] - this.cum[i - 1]) };
    }
    return best;
  }
  /** Feature within buffer: any (densified) vertex near, or route vertex inside a polygon. */
  match(g: any): { dist: number; along: number } | null {
    let best: { dist: number; along: number } | null = null;
    for (const p of densify(vertices(g), Math.max(20, this.bufferM / 2))) { const n = this.near(p); if (n && (!best || n.dist < best.dist)) best = n; }
    if (best) return best;
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      const bb = bboxOf(poly[0]);
      for (let i = 0; i < this.line.length; i++) { const q = this.line[i]; if (q[0] >= bb.minLon && q[0] <= bb.maxLon && q[1] >= bb.minLat && q[1] <= bb.maxLat && pointInRing(q, poly[0])) return { dist: 0, along: this.cum[i] }; }
    }
    return null;
  }
  /** Part of the route inside a bbox (for querying city WFS only where the route is). */
  clip(b: BBox): BBox | null {
    const inside = this.line.filter((p) => p[0] >= b.minLon && p[0] <= b.maxLon && p[1] >= b.minLat && p[1] <= b.maxLat);
    return inside.length ? bboxOf(inside, this.bufferM + 50) : null;
  }
}

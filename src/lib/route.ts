// Routing with the public OSRM demo server (router.project-osrm.org, OSM data).
// Demo policy: light use only, max 1 request/s; Reitti makes 1-3 requests per route.
import { type LL, cumulative, nearestOnLine } from "./geo";
export const OSRM = "https://router.project-osrm.org/route/v1/driving/";
export interface Route { line: LL[]; distanceM: number; durationS: number; how: string; score?: number }

export function osrmUrl(points: LL[], alternatives = false): string {
  return `${OSRM}${points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";")}?overview=full&geometries=geojson&alternatives=${alternatives ? 3 : "false"}`;
}
export function parseOsrm(j: any, how: string): Route[] {
  if (j?.code !== "Ok") throw new Error(j?.message || j?.code || "OSRM-virhe");
  return j.routes.map((r: any, i: number) => ({ line: r.geometry.coordinates, distanceM: r.distance, durationS: r.duration, how: i ? `${how} (vaihtoehto ${i})` : how }));
}

/** Score a candidate against the traced line (median distance, m) and the km/duration read from the shot. */
export function scoreRoute(r: Route, hints: LL[], km: number | null, min: number | null): number {
  let shape = 0;
  if (hints.length) {
    const cum = cumulative(r.line);
    const ds = hints.map((h) => nearestOnLine(h, r.line, cum).dist).sort((a, b) => a - b);
    shape = ds[Math.floor(ds.length / 2)] / 1000; // km
  }
  const kmErr = km ? Math.abs(r.distanceM / 1000 - km) / km : 0;
  const minErr = !km && min ? Math.abs(r.durationS / 60 - min) / min : 0;
  return shape + 100 * kmErr + 50 * minErr;
}

type Fetcher = (url: string) => Promise<any>;
const defaultFetch: Fetcher = async (u) => { const r = await fetch(u); if (!r.ok && r.status !== 400) throw new Error(`OSRM ${r.status}`); return r.json(); };

/** Candidates: direct with alternatives, and through user/derived via points; best score wins. */
export async function planRoute(start: LL, end: LL, opts: { via?: LL[]; hints?: LL[]; km?: number | null; min?: number | null; fetcher?: Fetcher } = {}): Promise<{ best: Route; candidates: Route[] }> {
  const f = opts.fetcher ?? defaultFetch;
  const cands: Route[] = [];
  const via = opts.via ?? [];
  cands.push(...parseOsrm(await f(osrmUrl([start, ...via, end], via.length === 0)), via.length ? "lähtö → kautta-kohdat → määränpää" : "lyhin aika (OSRM)"));
  const hints = opts.hints ?? [];
  if (!via.length && hints.length >= 8) {
    const pick = [0.3, 0.6].map((q) => hints[Math.floor(hints.length * q)]);
    await new Promise((r) => setTimeout(r, 1100));
    try { cands.push(...parseOsrm(await f(osrmUrl([start, ...pick, end])), "kuvan reittiviivan mukaan")); } catch { /* optional */ }
  }
  for (const c of cands) c.score = scoreRoute(c, hints, opts.km ?? null, opts.min ?? null);
  cands.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  return { best: cands[0], candidates: cands };
}

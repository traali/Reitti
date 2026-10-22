// Screenshot -> route hints. Combines OCR text, the location puck, the highlighted line and
// georeferencing from labelled towns. Every guess carries how it was obtained.
import { type OcrLine, type ParsedShot, parseOcr } from "./ocrparse";
import { traceRoute, type Trace } from "./trace";
import { findLocationDot, type Dot } from "./dot";
import { type Anchor, type Fit, fitGeoref, pixelToLatLon } from "./georef";
import type { Geocoder, Place } from "./geocode";

export interface Extraction {
  parsed: ParsedShot;
  dot: Dot | null;
  trace: Trace | null;
  fit: Fit | null;
  destination: Place | null;
  start: { lat: number; lon: number; how: string } | null;
  routeHintPoints: [number, number][]; // lat,lon along the traced line, in route order (start -> end)
  notes: string[];
}

const BIG_PLACE = /place:(city|town|village|municipality|hamlet|suburb|island|archipelago)/;

export async function extract(px: Uint8ClampedArray | Uint8Array, W: number, H: number, lines: OcrLine[], geocode: Geocoder, search: Geocoder = geocode): Promise<Extraction> {
  const parsed = parseOcr(lines, W, H);
  const notes: string[] = [];
  const boxes = lines.filter((l) => l.conf > 50).map((l) => l.bbox);
  const trace = traceRoute(px, W, H, boxes);
  const dot = findLocationDot(px, W, H);
  let destination: Place | null = null;
  if (parsed.destination) {
    try { destination = (await search(parsed.destination))[0] ?? null; } catch { notes.push("Määränpään haku epäonnistui."); }
  }
  const anchors: Anchor[] = [];
  const hits = await Promise.all(parsed.labels.slice(0, 14).map(async (l) => {
    try { const hit = (await geocode(l.text, { placeOnly: true })).find((p) => BIG_PLACE.test(p.kind)); return hit ? { px: l.cx, py: l.cy, lat: hit.lat, lon: hit.lon, name: hit.name } : null; }
    catch { return null; } // one label failing is fine
  }));
  for (const h of hits) if (h) anchors.push(h);
  // The trace end farthest from the puck is probably the destination marker (if it is on screen).
  let far: [number, number] | null = null;
  if (trace) {
    const [a, b] = trace.ends;
    far = dot ? (Math.hypot(a[0] - dot.x, a[1] - dot.y) > Math.hypot(b[0] - dot.x, b[1] - dot.y) ? a : b) : null;
  }
  let fit = fitGeoref(anchors, W);
  if (destination && far) {
    const withDest = fitGeoref([...anchors, { px: far[0], py: far[1], lat: destination.lat, lon: destination.lon, name: `${destination.name} (reitin pää)` }], W);
    if (withDest && (!fit || withDest.used.length > fit.used.length)) fit = withDest;
  }
  let start: Extraction["start"] = null;
  if (fit) {
    const sp = dot ? [dot.x, dot.y] : trace && far ? (trace.ends[0] === far ? trace.ends[1] : trace.ends[0]) : null;
    if (sp) { const [lat, lon] = pixelToLatLon(fit, sp[0], sp[1]); start = { lat, lon, how: dot ? "sijaintipallo + kartan paikannimet" : "reitin pää + kartan paikannimet" }; }
  } else notes.push("Kartan paikannimistä ei saatu riittävästi kiintopisteitä lähtöpaikan arvioimiseen.");
  let routeHintPoints: [number, number][] = [];
  if (fit && trace) {
    let path = trace.path;
    if (dot && Math.hypot(path[0][0] - dot.x, path[0][1] - dot.y) > Math.hypot(path[path.length - 1][0] - dot.x, path[path.length - 1][1] - dot.y)) path = [...path].reverse();
    routeHintPoints = path.map(([x, y]) => pixelToLatLon(fit!, x, y));
  }
  return { parsed, dot, trace, fit, destination, start, routeHintPoints, notes };
}

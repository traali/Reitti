import type { Feature, FeatureCollection, LineString, MultiLineString, Point, Position } from "geojson";

/** Digitraffic maintenance tracking (state roads only, Harja). CC BY 4.0, Fintraffic / digitraffic.fi. */
export const DIGITRAFFIC_ROUTES = "https://tie.digitraffic.fi/api/maintenance/v1/tracking/routes";
export const PLOUGH_WINDOW_H = 12;
export const BANNER_RADIUS_M = 2000;
export const STATE_ROADS_NOTE = "Espoon kadut (Espoon kaupunki) ja valtion tiet (Fintraffic). Helsingin katuja ei ole avoimessa datassa.";
export const ESPOO_MAX_H = 48;
export const EMPTY_TEXT = "Ei auraustietoja viime tunneilta";
export const ERROR_TEXT = "Auraustietojen lataus epäonnistui";

/** Winter tasks shown in the layer, with Digitraffic's own Finnish names (from /tasks). */
export const WINTER_TASKS_FI: Record<string, string> = {
  PLOUGHING_AND_SLUSH_REMOVAL: "Auraus ja sohjonpoisto",
  SALTING: "Suolaus",
  LINE_SANDING: "Linjahiekoitus",
  SPOT_SANDING: "Pistehiekoitus",
  LEVELLING_OF_ROAD_SURFACE: "Pinnan tasaus",
  TRANSFER_OF_SNOW: "Lumensiirto",
  LOWERING_OF_SNOWBANKS: "Lumivallien madaltaminen",
  PLOUGHING_OF_SLUSH_DITCH: "Sohjo-ojien teko",
  REMOVAL_OF_BULGE_ICE: "Paannejään poisto",
};
const PLOUGH_TASKS = new Set(["PLOUGHING_AND_SLUSH_REMOVAL", "PLOUGHING_OF_SLUSH_DITCH", "TRANSFER_OF_SNOW", "LOWERING_OF_SNOWBANKS"]);

export type AgeClass = "lt1h" | "1to3h" | "3to12h" | "12to48h";
export const AGE_COLORS: Record<AgeClass, string> = { lt1h: "#22d3ee", "1to3h": "#3b82f6", "3to12h": "#a78bfa", "12to48h": "#64748b" };
export const AGE_LABELS: Record<AgeClass, string> = { lt1h: "alle 1 h", "1to3h": "1–3 h", "3to12h": "3–12 h", "12to48h": "12–48 h (vanha)" };

export interface PloughProps {
  tasksFi: string;
  endTime: string;
  timeFi: string;
  ageMin: number;
  age: AgeClass;
  plough: boolean;
  source: "state" | "espoo";
  street?: string;
}
export type PloughFC = FeatureCollection<LineString | MultiLineString | Point, PloughProps>;

export interface Bbox { minLon: number; minLat: number; maxLon: number; maxLat: number }

export function bboxAround(lat: number, lon: number, meters: number): Bbox {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return { minLon: lon - dLon, minLat: lat - dLat, maxLon: lon + dLon, maxLat: lat + dLat };
}

export function routesUrl(b: Bbox, now: Date, hours = PLOUGH_WINDOW_H): string {
  const from = new Date(now.getTime() - Math.min(hours, 23.9) * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
  const r = (n: number) => n.toFixed(4);
  return `${DIGITRAFFIC_ROUTES}?endFrom=${from}&xMin=${r(b.minLon)}&yMin=${r(b.minLat)}&xMax=${r(b.maxLon)}&yMax=${r(b.maxLat)}&domain=state-roads`;
}

/** "klo 08.45 (10.2.)" in Helsinki time. */
export function helsinkiTime(iso: string): string {
  const d = new Date(iso);
  const tz = { timeZone: "Europe/Helsinki" } as const;
  const hm = new Intl.DateTimeFormat("fi-FI", { ...tz, hour: "2-digit", minute: "2-digit" }).format(d);
  const dm = new Intl.DateTimeFormat("fi-FI", { ...tz, day: "numeric", month: "numeric" }).format(d);
  return `klo ${hm} (${dm})`;
}

function ageClass(min: number, maxMin = 720): AgeClass | null {
  if (min >= maxMin) return null;
  if (min < 60) return "lt1h";
  if (min < 180) return "1to3h";
  if (min < 720) return "3to12h";
  return "12to48h";
}

function coords(g: Feature["geometry"]): Position[] {
  if (!g) return [];
  if (g.type === "Point") return [g.coordinates];
  if (g.type === "LineString") return g.coordinates;
  if (g.type === "MultiLineString") return g.coordinates.flat();
  return [];
}

function inBbox(p: Position, b: Bbox) {
  return p[0] >= b.minLon && p[0] <= b.maxLon && p[1] >= b.minLat && p[1] <= b.maxLat;
}

/** Keep winter-task segments from the last 12 h inside the bbox, annotated with age + Finnish names. */
export function toPloughLayer(raw: unknown, now: Date, b: Bbox | null): PloughFC {
  const out: PloughFC = { type: "FeatureCollection", features: [] };
  const feats = (raw as FeatureCollection | null)?.features;
  if (!Array.isArray(feats)) throw new Error("Odottamaton vastaus");
  for (const f of feats) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    if (p.domain && p.domain !== "state-roads") continue;
    const tasks = (Array.isArray(p.tasks) ? p.tasks : []).map(String).filter((t) => t in WINTER_TASKS_FI);
    if (!tasks.length || typeof p.endTime !== "string") continue;
    const g = f.geometry;
    if (!g || !["Point", "LineString", "MultiLineString"].includes(g.type)) continue;
    if (b && !coords(g).some((c) => inBbox(c, b))) continue;
    const ageMin = Math.round((now.getTime() - Date.parse(p.endTime)) / 60000);
    const age = ageClass(ageMin);
    if (!age || Number.isNaN(ageMin)) continue;
    out.features.push({
      type: "Feature",
      geometry: g as LineString | MultiLineString | Point,
      properties: {
        tasksFi: tasks.map((t) => WINTER_TASKS_FI[t]).join(", "),
        endTime: p.endTime,
        timeFi: helsinkiTime(p.endTime),
        ageMin: Math.max(0, ageMin),
        age,
        plough: tasks.some((t) => PLOUGH_TASKS.has(t)),
        source: "state",
      },
    });
  }
  out.features.sort((a, c) => a.properties.ageMin - c.properties.ageMin);
  return out;
}

function meters(a: Position, lat: number, lon: number) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat - a[1]) * rad, dLon = (lon - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PloughBanner { text: string; ageMin: number; distanceM: number }

/** Most recent past run within radius of the venue. Only past runs, never predictions. */
export function venueBanner(fc: PloughFC, lat: number, lon: number, radius = BANNER_RADIUS_M): PloughBanner | null {
  let best: { f: PloughFC["features"][number]; d: number } | null = null;
  for (const f of fc.features) {
    const d = Math.min(...coords(f.geometry).map((c) => meters(c, lat, lon)));
    if (d > radius) continue;
    if (!best || f.properties.ageMin < best.f.properties.ageMin) best = { f, d };
  }
  if (!best) return null;
  const { ageMin, timeFi, tasksFi, plough, street, source } = best.f.properties;
  const ago = ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin / 60)} h ${ageMin % 60} min`;
  const dist = best.d < 100 ? "aivan lähellä" : `noin ${(best.d / 1000).toFixed(1).replace(".", ",")} km päässä`;
  const where = street ? `${street}, ${dist}` : dist;
  const head = plough ? `Aura-auto ajoi ${where} ${ago} sitten` : `${tasksFi}: ${where} ${ago} sitten`;
  const who = source === "espoo" ? "Espoon kaupunki" : "Fintraffic";
  return { text: `${head} (${tasksFi}, ${timeFi}; ${who}).`, ageMin, distanceM: Math.round(best.d) };
}

export type PloughStatus = "idle" | "loading" | "ready" | "empty" | "error";

export async function fetchPlough(b: Bbox, now: Date, fetcher: typeof fetch = fetch): Promise<PloughFC> {
  const res = await fetcher(routesUrl(b, now), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return toPloughLayer(await res.json(), now, b);
}

// ---------- Espoo city streets (Espoon kaupunki, CC BY 4.0) ----------
export const ESPOO_WFS = "https://kartat.espoo.fi/teklaogcweb/wfs.ashx?service=WFS&version=1.1.0&request=GetFeature&typeName=GIS:AuratKartalla";
/** Same-origin Pages Function that gzips and briefly caches the 4.7 MB uncompressed GML. */
export const ESPOO_PROXY = "/api/espoo-streets";

/** Espoo timestamps ("2026-10-08T08:45") are Helsinki wall-clock time without an offset. */
export function helsinkiLocalToDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const off = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t);
}

/** EPSG:3879 (ETRS-GK25FIN, TM lon0 25°, k 1, FE 25 500 000) to WGS84 lon/lat. */
export function gk25ToWgs84(e: number, n: number): [number, number] {
  const a = 6378137, f = 1 / 298.257222101, k0 = 1, lon0 = (25 * Math.PI) / 180, E0 = 25500000;
  const nn = f / (2 - f), A1 = (a / (1 + nn)) * (1 + nn ** 2 / 4 + nn ** 4 / 64);
  const e2 = 2 * f - f * f, ee = Math.sqrt(e2);
  const h1 = nn / 2 - (2 / 3) * nn ** 2 + (37 / 96) * nn ** 3, h2 = nn ** 2 / 48 + nn ** 3 / 15, h3 = (17 / 480) * nn ** 3;
  const x = n / (A1 * k0), y = (e - E0) / (A1 * k0);
  const xi = x - h1 * Math.sin(2 * x) * Math.cosh(2 * y) - h2 * Math.sin(4 * x) * Math.cosh(4 * y) - h3 * Math.sin(6 * x) * Math.cosh(6 * y);
  const eta = y - h1 * Math.cos(2 * x) * Math.sinh(2 * y) - h2 * Math.cos(4 * x) * Math.sinh(4 * y) - h3 * Math.cos(6 * x) * Math.sinh(6 * y);
  const beta = Math.asin(Math.sin(xi) / Math.cosh(eta));
  const l = Math.asin(Math.tanh(eta) / Math.cos(beta));
  let q = Math.asinh(Math.tan(beta)), qq = q;
  for (let i = 0; i < 6; i++) qq = q + ee * Math.atanh(ee * Math.tanh(qq));
  return [((lon0 + l) * 180) / Math.PI, (Math.atan(Math.sinh(qq)) * 180) / Math.PI];
}

/** WGS84 lon/lat to EPSG:3879 (Krüger series, sub-mm in Finland). */
export function wgs84ToGk25(lon: number, lat: number): [number, number] {
  const a = 6378137, f = 1 / 298.257222101, lon0 = (25 * Math.PI) / 180;
  const nn = f / (2 - f), A1 = (a / (1 + nn)) * (1 + nn ** 2 / 4 + nn ** 4 / 64);
  const ee = Math.sqrt(2 * f - f * f);
  const h1 = nn / 2 - (2 / 3) * nn ** 2 + (5 / 16) * nn ** 3, h2 = (13 / 48) * nn ** 2 - (3 / 5) * nn ** 3, h3 = (61 / 240) * nn ** 3;
  const phi = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180 - lon0;
  const q = Math.asinh(Math.tan(phi)) - ee * Math.atanh(ee * Math.sin(phi));
  const beta = Math.atan(Math.sinh(q));
  const eta0 = Math.atanh(Math.cos(beta) * Math.sin(l)), xi0 = Math.asin(Math.sin(beta) * Math.cosh(eta0));
  const xi = xi0 + h1 * Math.sin(2 * xi0) * Math.cosh(2 * eta0) + h2 * Math.sin(4 * xi0) * Math.cosh(4 * eta0) + h3 * Math.sin(6 * xi0) * Math.cosh(6 * eta0);
  const eta = eta0 + h1 * Math.cos(2 * xi0) * Math.sinh(2 * eta0) + h2 * Math.cos(4 * xi0) * Math.sinh(4 * eta0) + h3 * Math.cos(6 * xi0) * Math.sinh(6 * eta0);
  return [25500000 + A1 * eta, A1 * xi];
}

export function wgs84ToGk25Bbox(b: Bbox): [number, number, number, number] {
  const cs = [wgs84ToGk25(b.minLon, b.minLat), wgs84ToGk25(b.minLon, b.maxLat), wgs84ToGk25(b.maxLon, b.minLat), wgs84ToGk25(b.maxLon, b.maxLat)];
  const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  return [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))];
}

const ESPOO_TASK_FI: Record<string, string> = { aura: "Aurattu", hiekka: "Hiekoitettu", harja: "Harjattu", alatera: "Alaterä (jään poisto)" };

/** Parse the Espoo GML (no DOMParser so it runs in tests too). */
export function parseEspooGml(xml: string, now: Date, b: Bbox | null): PloughFC {
  if (!/<wfs:FeatureCollection/.test(xml)) throw new Error("Odottamaton vastaus");
  const out: PloughFC = { type: "FeatureCollection", features: [] };
  for (const m of xml.split("<gml:featureMember>").slice(1)) {
    const tag = (t: string) => new RegExp(`<GIS:${t}>([^<]*)</GIS:${t}>`).exec(m)?.[1] ?? "";
    const when = helsinkiLocalToDate(tag("time"));
    if (!when) continue;
    const ageMin = Math.round((now.getTime() - when.getTime()) / 60000);
    const age = ageClass(Math.max(0, ageMin), ESPOO_MAX_H * 60);
    if (!age) continue;
    const lines: Position[][] = [];
    for (const ls of m.split(/<gml:LineString[^>]*>/).slice(1)) {
      const pts = [...ls.split("</gml:LineString>")[0].matchAll(/<gml:pos>([\d.]+) ([\d.]+)<\/gml:pos>/g)].map((p) => gk25ToWgs84(+p[1], +p[2]));
      const list = ls.split("</gml:LineString>")[0].match(/<gml:posList[^>]*>([^<]*)</);
      if (list) { const v = list[1].trim().split(/\s+/).map(Number); for (let i = 0; i + 1 < v.length; i += 2) pts.push(gk25ToWgs84(v[i], v[i + 1])); }
      if (pts.length > 1) lines.push(pts);
    }
    if (!lines.length) continue;
    if (b && !lines.flat().some((c) => inBbox(c, b))) continue;
    const done = Object.keys(ESPOO_TASK_FI).filter((k) => tag(k) === "True").map((k) => ESPOO_TASK_FI[k]);
    const tasksFi = done.length ? done.join(" / ") : tag("tyolajit") || "Kunnossapito";
    out.features.push({
      type: "Feature",
      geometry: lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines },
      properties: { tasksFi, endTime: when.toISOString(), timeFi: helsinkiTime(when.toISOString()), ageMin: Math.max(0, ageMin), age, plough: tag("aura") === "True", source: "espoo", street: tag("Kadunnimi") || undefined },
    });
  }
  out.features.sort((a, c) => a.properties.ageMin - c.properties.ageMin);
  return out;
}

export async function fetchEspooStreets(b: Bbox, now: Date, fetcher: typeof fetch = fetch): Promise<PloughFC> {
  const [x1, y1, x2, y2] = wgs84ToGk25Bbox(b);
  const q = `bbox=${x1},${y1},${x2},${y2}`;
  let res: Response | null = null;
  try { res = await fetcher(`${ESPOO_PROXY}?${q}`); } catch { res = null; }
  // Pages Function missing (local dev) answers with the SPA's HTML: go straight to Espoo (CORS *).
  if (!res || !res.ok || !(res.headers?.get?.("content-type") ?? "").includes("xml")) res = await fetcher(`${ESPOO_WFS}&${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseEspooGml(await res.text(), now, b);
}

/** Both sources; one failing still shows the other. Throws only if both fail. */
export async function fetchWinterMaintenance(b: Bbox, now: Date, fetcher: typeof fetch = fetch): Promise<{ fc: PloughFC; failed: ("state" | "espoo")[] }> {
  const [s, e] = await Promise.allSettled([fetchPlough(b, now, fetcher), fetchEspooStreets(b, now, fetcher)]);
  const failed: ("state" | "espoo")[] = [];
  const feats: PloughFC["features"] = [];
  if (s.status === "fulfilled") feats.push(...s.value.features); else failed.push("state");
  if (e.status === "fulfilled") feats.push(...e.value.features); else failed.push("espoo");
  if (failed.length === 2) throw new Error("Molemmat lähteet epäonnistuivat");
  feats.sort((a, c) => a.properties.ageMin - c.properties.ageMin);
  return { fc: { type: "FeatureCollection", features: feats }, failed };
}

// ---------- Helsinki: prioritised winter routes (static plan, not live) ----------
export const HEL_PRIORITY_LABEL = "Talvihoidon ensisijaiset reitit (ei reaaliaikainen)";
export const HEL_PRIORITY_URL =
  "https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=avoindata:Talvihoidon_priorisoitu_reitisto&outputFormat=application/json&srsName=EPSG:4326";
export interface HelPriorityProps { nimi: string; hoitotapa: string; urakoitsija: string; paivitetty: string }

export function toHelPriority(raw: unknown): FeatureCollection<LineString | MultiLineString, HelPriorityProps> {
  const feats = (raw as FeatureCollection | null)?.features;
  if (!Array.isArray(feats)) throw new Error("Odottamaton vastaus");
  return {
    type: "FeatureCollection",
    features: feats
      .filter((f) => f.geometry && (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"))
      .map((f) => {
        const p = (f.properties ?? {}) as Record<string, unknown>;
        return {
          type: "Feature",
          geometry: f.geometry as LineString | MultiLineString,
          properties: { nimi: String(p.nimi ?? ""), hoitotapa: String(p.hoitotapa ?? ""), urakoitsija: String(p.urakoitsija ?? ""), paivitetty: String(p.paivitetty_tietopalveluun ?? "") },
        };
      }),
  };
}

export async function fetchHelPriority(fetcher: typeof fetch = fetch) {
  const res = await fetcher(HEL_PRIORITY_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return toHelPriority(await res.json());
}

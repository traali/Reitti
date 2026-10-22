// Data sources along the route. Every source reports its own status; nothing is invented.
import { type LL, type BBox, Corridor, bboxOf, intersects, pointAt } from "./geo";
import { toPloughLayer, routesUrl, parseEspooGml, wgs84ToGk25Bbox, ESPOO_WFS, helsinkiTime } from "./plough";

export type Kind = "tietyo" | "liikenne" | "kaivu" | "jarjestely" | "kunnossapito" | "keli" | "ennuste";
export interface Alert {
  id: string; kind: Kind; source: string; title: string; detail: string; when?: string;
  along: number; dist: number; geometry: any; point: LL;
}
export type Status = "ok" | "empty" | "error" | "notcovered";
export interface SourceResult { id: string; name: string; credit: string; status: Status; note: string; alerts: Alert[] }
type F = typeof fetch;

export const BUFFER_M = 150;
export const HELSINKI: BBox = { minLon: 24.78, minLat: 60.09, maxLon: 25.26, maxLat: 60.30 };
export const ESPOO: BBox = { minLon: 24.49, minLat: 60.08, maxLon: 24.87, maxLat: 60.37 };
const DT = "https://tie.digitraffic.fi";
const HEL_WFS = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
const DTH = { headers: { "Accept-Encoding": "gzip", "Digitraffic-User": "Reitti/1.0" } };

const fiDate = (s?: string | null) => (s ? new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", year: "numeric" }).format(new Date(s)) : "");
const firstPoint = (g: any): LL => { const v = g?.type === "Point" ? [g.coordinates] : JSON.stringify(g?.coordinates ?? []).match(/-?\d+\.\d+,-?\d+\.\d+/); if (!v) return [0, 0]; const s = Array.isArray(v[0]) ? v[0] : String(v[0]).split(",").map(Number); return [s[0], s[1]]; };
const ok = (base: Omit<SourceResult, "status" | "note" | "alerts">, alerts: Alert[], emptyNote: string): SourceResult =>
  ({ ...base, alerts, status: alerts.length ? "ok" : "empty", note: alerts.length ? `${alerts.length} kohdetta reitin varrella` : emptyNote });
const fail = (base: Omit<SourceResult, "status" | "note" | "alerts">, e: unknown): SourceResult =>
  ({ ...base, alerts: [], status: "error", note: `Haku epäonnistui (${e instanceof Error ? e.message : String(e)}). Tieto puuttuu, ei tarkoita ettei mitään olisi.` });
async function json(f: F, url: string, init?: RequestInit, timeoutMs = 25000) {
  const r = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- Digitraffic traffic messages ----------
export function toTrafficAlerts(fc: any, c: Corridor): Alert[] {
  const out: Alert[] = [];
  for (const f of fc?.features ?? []) {
    if (!f.geometry) continue;
    const m = c.match(f.geometry); if (!m) continue;
    const p = f.properties ?? {}; const a = p.announcements?.[0] ?? {};
    const phase = a.roadWorkPhases?.[0];
    const start = phase?.timeAndDuration?.startTime ?? a.timeAndDuration?.startTime, end = phase?.timeAndDuration?.endTime ?? a.timeAndDuration?.endTime;
    const feats = (a.features ?? []).map((x: any) => (x.quantity ? `${x.name} ${x.quantity} ${x.unit ?? ""}`.trim() : x.name)).filter(Boolean);
    const restr = (phase?.restrictions ?? []).map((r: any) => r.restriction?.name).filter(Boolean);
    out.push({
      id: `dt:${p.situationId}:${p.version}`, kind: p.situationType === "ROAD_WORK" ? "tietyo" : "liikenne", source: "Fintraffic / Digitraffic",
      title: (a.title ?? "Liikennetiedote").trim(), detail: [a.location?.description, [...new Set([...feats, ...restr])].join(", ")].filter(Boolean).join("\n"),
      when: start ? `${fiDate(start)}${end ? ` – ${fiDate(end)}` : " alkaen"}` : undefined, along: m.along, dist: m.dist, geometry: f.geometry, point: firstPoint(f.geometry),
    });
  }
  return out;
}
export async function fetchTraffic(c: Corridor, f: F = fetch): Promise<SourceResult> {
  const base = { id: "digitraffic-msg", name: "Tietyöt ja liikennetiedotteet", credit: "Fintraffic / digitraffic.fi, CC BY 4.0" };
  try {
    const types = ["ROAD_WORK", "TRAFFIC_ANNOUNCEMENT"];
    const fcs = await Promise.all(types.map((t) => json(f, `${DT}/api/traffic-message/v1/messages?inactiveHours=0&includeAreaGeometry=false&situationType=${t}`, DTH)));
    return ok(base, fcs.flatMap((fc) => toTrafficAlerts(fc, c)), "Ei voimassa olevia tietöitä tai tiedotteita reitin varrella (valtion tiet).");
  } catch (e) { return fail(base, e); }
}

// ---------- Helsinki city WFS (excavation + temporary traffic arrangements) ----------
export const HEL_LAYERS = [
  { type: "avoindata:Kaivuilmoitus_alue", kind: "kaivu" as const, s: "tyo_alkaa", e: "tyo_paattyy", label: "Kaivutyö" },
  { type: "avoindata:Kaivuilmoitus_piste", kind: "kaivu" as const, s: "tyo_alkaa", e: "tyo_paattyy", label: "Kaivutyö" },
  { type: "avoindata:Tilapainen_liikennejarjestely_alue", kind: "jarjestely" as const, s: "liikennejarjestely_alkaa", e: "liikennejarjestely_paattyy", label: "Tilapäinen liikennejärjestely" },
  { type: "avoindata:Tilapainen_liikennejarjestely_piste", kind: "jarjestely" as const, s: "liikennejarjestely_alkaa", e: "liikennejarjestely_paattyy", label: "Tilapäinen liikennejärjestely" },
];
export function helUrl(type: string, b: BBox): string {
  return `${HEL_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeName=${type}&outputFormat=application/json&srsName=EPSG:4326&count=2000&bbox=${b.minLat.toFixed(5)},${b.minLon.toFixed(5)},${b.maxLat.toFixed(5)},${b.maxLon.toFixed(5)},urn:ogc:def:crs:EPSG::4326`;
}
export function toHelAlerts(fc: any, layer: (typeof HEL_LAYERS)[number], c: Corridor, today: string): Alert[] {
  const out: Alert[] = [];
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {};
    if (p[layer.e] && String(p[layer.e]).slice(0, 10) < today) continue; // already ended
    if (p[layer.s] && String(p[layer.s]).slice(0, 10) > today) continue; // not started yet
    if (!f.geometry) continue;
    const m = c.match(f.geometry); if (!m) continue;
    out.push({
      id: `hel:${layer.type}:${f.id}`, kind: layer.kind, source: "Helsingin kaupunki",
      title: `${layer.label}: ${String(p.osoite ?? "").split(",")[0] || "osoite puuttuu"}`, detail: [p.tyon_tarkoitus, p.status].filter(Boolean).join("\n").slice(0, 400),
      when: `${fiDate(p[layer.s])} – ${fiDate(p[layer.e])}`, along: m.along, dist: m.dist, geometry: f.geometry, point: firstPoint(f.geometry),
    });
  }
  return out;
}
export async function fetchHelsinki(c: Corridor, now: Date, f: F = fetch): Promise<SourceResult> {
  const base = { id: "helsinki", name: "Helsingin kaivutyöt ja liikennejärjestelyt", credit: "Helsingin kaupunki, kartta.hel.fi, CC BY 4.0" };
  const b = c.clip(HELSINKI);
  if (!b) return { ...base, status: "notcovered", note: "Reitti ei kulje Helsingin alueella.", alerts: [] };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(now);
  const res = await Promise.allSettled(HEL_LAYERS.map(async (l) => toHelAlerts(await json(f, helUrl(l.type, b), undefined, 30000), l, c, today)));
  const got = res.filter((r): r is PromiseFulfilledResult<Alert[]> => r.status === "fulfilled");
  if (!got.length) return fail(base, (res[0] as PromiseRejectedResult).reason);
  const r = ok(base, got.flatMap((g) => g.value), "Ei voimassa olevia kaivutöitä tai liikennejärjestelyjä reitin varrella Helsingissä.");
  if (got.length < res.length) r.note += ` (${res.length - got.length}/${res.length} tasoa ei saatu haettua)`;
  return r;
}

// ---------- Maintenance: Digitraffic (state roads) + Espoo streets. Past work only. ----------
const ago = (min: number) => (min < 60 ? `${min} min sitten` : `${Math.floor(min / 60)} h ${min % 60} min sitten`);
export function maintenanceAlerts(fc: any, c: Corridor, src: string): Alert[] {
  const out: Alert[] = []; const seen = new Set<string>();
  for (const [i, x] of (fc?.features ?? []).entries()) {
    const p = x.properties;
    const key = p.street ? `${p.street}|${p.tasksFi}` : ""; // features are newest first: keep the latest per street
    if (key && seen.has(key)) continue;
    const m = c.match(x.geometry); if (!m) continue;
    if (key) seen.add(key);
    out.push({ id: `mt:${src}:${p.endTime}:${i}`, kind: "kunnossapito", source: src, title: `${p.tasksFi} ${ago(p.ageMin)}${p.street ? ` (${p.street})` : ""}`, detail: `Työ päättyi ${p.timeFi}. Vain toteutunut työ; tulevista ajoista ei ole tietoa.`, when: p.timeFi, along: m.along, dist: m.dist, geometry: x.geometry, point: firstPoint(x.geometry) });
  }
  return out;
}
export async function fetchMaintenance(c: Corridor, now: Date, f: F = fetch): Promise<SourceResult[]> {
  const state = { id: "digitraffic-maint", name: "Talvikunnossapito, valtion tiet", credit: "Fintraffic / digitraffic.fi (Harja), CC BY 4.0" };
  const espoo = { id: "espoo-aurat", name: "Talvikunnossapito, Espoon kadut", credit: "Espoon kaupunki, AuratKartalla, CC BY 4.0" };
  const bb = bboxOf(c.line, c.bufferM);
  const out: SourceResult[] = [];
  try { out.push(ok(state, maintenanceAlerts(toPloughLayer(await json(f, routesUrl(bb, now), DTH), now, bb), c, "Fintraffic"), "Ei kirjattuja talvihoitotöitä reitin varrella viimeisen 12 h aikana.")); } catch (e) { out.push(fail(state, e)); }
  const eb = c.clip(ESPOO);
  if (!eb) out.push({ ...espoo, status: "notcovered", note: "Reitti ei kulje Espoon alueella.", alerts: [] });
  else try {
    const [x1, y1, x2, y2] = wgs84ToGk25Bbox(eb);
    const q = `bbox=${x1},${y1},${x2},${y2}`;
    let r: Response | null = null;
    try { r = await f(`/api/espoo-streets?${q}`, { signal: AbortSignal.timeout(30000) }); } catch { r = null; }
    if (!r || !r.ok || !(r.headers?.get?.("content-type") ?? "").includes("xml")) r = await f(`${ESPOO_WFS}&${q}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    out.push(ok(espoo, maintenanceAlerts(parseEspooGml(await r.text(), now, eb), c, "Espoon kaupunki"), "Ei kirjattuja auraus- tai hiekoitustöitä reitin varrella viimeisen 48 h aikana."));
  } catch (e) { out.push(fail(espoo, e)); }
  if (c.clip(HELSINKI)) out.push({ id: "helsinki-maint", name: "Talvikunnossapito, Helsingin kadut", credit: "Helsingin kaupunki", status: "notcovered", note: "Helsingin katujen aurauksesta ei ole avointa reaaliaikaista dataa. Tätä ei voi näyttää.", alerts: [] });
  return out;
}

// ---------- Road weather stations (Digitraffic) ----------
const SENS = { ILMA: "ilma", TIE_1: "tie", KELI_1: "keli", SADE: "sade", TUULI: "tuuli" } as const;
export function pickStations(list: any, c: Corridor, max = 8, radius = 1000): { id: number; name: string; along: number; dist: number; point: LL }[] {
  const near = (list?.features ?? []).map((s: any) => {
    const pt: LL = [s.geometry.coordinates[0], s.geometry.coordinates[1]];
    const save = (c as any).bufferM; (c as any).bufferM = radius; const m = c.near(pt); (c as any).bufferM = save;
    return m && s.properties.collectionStatus === "GATHERING" ? { id: s.id, name: s.properties.name, along: m.along, dist: m.dist, point: pt } : null;
  }).filter(Boolean).sort((a: any, b: any) => a.along - b.along);
  if (near.length <= max) return near;
  return Array.from({ length: max }, (_, i) => near[Math.round((i * (near.length - 1)) / (max - 1))]);
}
export function stationAlert(st: ReturnType<typeof pickStations>[number], data: any, now: Date): Alert | null {
  const v = Object.fromEntries((data?.sensorValues ?? []).map((s: any) => [s.name, s]));
  const t = v.ILMA?.measuredTime; if (!t) return null;
  const age = Math.round((now.getTime() - Date.parse(t)) / 60000); if (age > 180) return null; // stale
  const parts = [
    v.ILMA ? `ilma ${String(v.ILMA.value).replace(".", ",")} °C` : "", v.TIE_1 ? `tie ${String(v.TIE_1.value).replace(".", ",")} °C` : "",
    v.KELI_1?.sensorValueDescriptionFi ? `keli: ${v.KELI_1.sensorValueDescriptionFi.toLowerCase()}` : "", v.SADE?.sensorValueDescriptionFi ? v.SADE.sensorValueDescriptionFi.toLowerCase() : "",
    v.KESKITUULI ? `tuuli ${String(v.KESKITUULI.value).replace(".", ",")} m/s` : "",
  ].filter(Boolean);
  return { id: `ws:${st.id}`, kind: "keli", source: "Fintraffic tiesääasema", title: `Tiesää ${st.name.replace(/_/g, " ")}`, detail: `${parts.join(", ")}. Mitattu ${helsinkiTime(t)}.`, when: helsinkiTime(t), along: st.along, dist: st.dist, geometry: { type: "Point", coordinates: st.point }, point: st.point };
}
export async function fetchRoadWeather(c: Corridor, now: Date, f: F = fetch): Promise<SourceResult> {
  const base = { id: "digitraffic-weather", name: "Tiesääasemat reitin varrella", credit: "Fintraffic / digitraffic.fi, CC BY 4.0" };
  try {
    const sts = pickStations(await json(f, `${DT}/api/weather/v1/stations`, DTH), c);
    const res = await Promise.allSettled(sts.map(async (s) => stationAlert(s, await json(f, `${DT}/api/weather/v1/stations/${s.id}/data`, DTH), now)));
    const alerts = res.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
    return ok(base, alerts, "Reitin varrella (alle 1 km) ei ole toiminnassa olevaa tiesääasemaa.");
  } catch (e) { return fail(base, e); }
}
void SENS;

// ---------- FMI forecast at start / middle / destination ----------
export function fmiUrl(p: LL, now: Date): string {
  const end = new Date(now.getTime() + 6 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
  return `https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::forecast::harmonie::surface::point::simple&latlon=${p[1].toFixed(4)},${p[0].toFixed(4)}&parameters=Temperature,Precipitation1h,WindSpeedMS&timestep=60&endtime=${end}`;
}
export function parseFmi(xml: string): { time: string; t?: number; rain?: number; wind?: number }[] {
  if (!/FeatureCollection/.test(xml)) throw new Error("Odottamaton vastaus");
  const rows = new Map<string, any>();
  for (const m of xml.matchAll(/<BsWfs:Time>([^<]+)<\/BsWfs:Time>\s*<BsWfs:ParameterName>([^<]+)<\/BsWfs:ParameterName>\s*<BsWfs:ParameterValue>([^<]+)<\/BsWfs:ParameterValue>/g)) {
    const r = rows.get(m[1]) ?? { time: m[1] }; const v = Number(m[3]);
    if (!Number.isNaN(v)) r[{ Temperature: "t", Precipitation1h: "rain", WindSpeedMS: "wind" }[m[2]] ?? m[2]] = v;
    rows.set(m[1], r);
  }
  return [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
}
const n1 = (x?: number) => (x == null ? "?" : x.toFixed(1).replace(".", ","));
export async function fetchForecast(c: Corridor, now: Date, f: F = fetch): Promise<SourceResult> {
  const base = { id: "fmi", name: "Sääennuste (lähtö, puoliväli, määränpää)", credit: "Ilmatieteen laitos, opendata.fmi.fi, CC BY 4.0" };
  const pts: [string, number][] = [["Lähtö", 0], ["Puoliväli", 0.5], ["Määränpää", 1]];
  const res = await Promise.allSettled(pts.map(async ([label, q]) => {
    const p = pointAt(c.line, c.cum, q);
    const r = await f(fmiUrl(p, now), { signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = parseFmi(await r.text()).slice(0, 4); if (!rows.length) return null;
    const rain = Math.max(...rows.map((x) => x.rain ?? 0));
    const a: Alert = { id: `fmi:${label}`, kind: "ennuste", source: "Ilmatieteen laitos", title: `${label}: ${n1(rows[0].t)} °C${rain >= 0.1 ? `, sadetta enint. ${n1(rain)} mm/h` : ", poutaa"}`,
      detail: rows.map((x) => `${helsinkiTime(x.time).replace(/ \(.*/, "")}: ${n1(x.t)} °C, sade ${n1(x.rain)} mm/h, tuuli ${n1(x.wind)} m/s`).join("\n"), when: "ennuste 4 h", along: c.length * q, dist: 0, geometry: { type: "Point", coordinates: p }, point: p };
    return a;
  }));
  const alerts = res.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  if (!alerts.length && res.some((r) => r.status === "rejected")) return fail(base, (res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason);
  return ok(base, alerts, "Ennustetta ei saatu näille pisteille.");
}

/** Everything in parallel; returns per-source results and all alerts in route order. */
export async function fetchAll(line: LL[], now = new Date(), f: F = fetch, onEach?: (r: SourceResult) => void): Promise<{ sources: SourceResult[]; alerts: Alert[] }> {
  const c = new Corridor(line, BUFFER_M);
  const tap = <T extends SourceResult | SourceResult[]>(p: Promise<T>) => p.then((r) => { for (const x of ([] as SourceResult[]).concat(r)) onEach?.(x); return r; });
  const all = await Promise.all([tap(fetchTraffic(c, f)), tap(fetchHelsinki(c, now, f)), tap(fetchMaintenance(c, now, f)), tap(fetchRoadWeather(c, now, f)), tap(fetchForecast(c, now, f))]);
  const sources = all.flat();
  const alerts = sources.flatMap((s) => s.alerts).sort((a, b) => a.along - b.along);
  return { sources, alerts };
}
export { intersects };

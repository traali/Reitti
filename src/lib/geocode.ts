// Geocoding with Photon (komoot, OSM data, ODbL). Fair use: debounced, cached, few requests per screenshot.
export interface Place { name: string; label: string; lat: number; lon: number; kind: string; country?: string }
export type Geocoder = (q: string, opts?: { placeOnly?: boolean; near?: [number, number] }) => Promise<Place[]>;
const PHOTON = "https://photon.komoot.io/api/";
const cache = new Map<string, Promise<Place[]>>();

export function photonUrl(q: string, opts: { placeOnly?: boolean; near?: [number, number] } = {}): string {
  const u = new URL(PHOTON);
  u.searchParams.set("q", q); u.searchParams.set("limit", "5");
  if (opts.placeOnly) u.searchParams.append("osm_tag", "place");
  if (opts.near) { u.searchParams.set("lat", String(opts.near[0])); u.searchParams.set("lon", String(opts.near[1])); }
  else { u.searchParams.set("lat", "62.5"); u.searchParams.set("lon", "25.5"); }
  return u.toString();
}

export function parsePhoton(j: any): Place[] {
  return (j?.features ?? []).map((f: any) => {
    const p = f.properties ?? {};
    const label = [p.name, p.street && p.housenumber ? `${p.street} ${p.housenumber}` : p.street, p.city && p.city !== p.name ? p.city : null, p.country !== "Suomi" ? p.country : null].filter(Boolean).join(", ");
    return { name: p.name ?? label, label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: `${p.osm_key}:${p.osm_value}`, country: p.countrycode };
  });
}

export const photon: Geocoder = (q, opts = {}) => {
  const url = photonUrl(q, opts);
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`Photon ${r.status}`); return r.json(); }).then(parsePhoton).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url)!;
};

export async function reverse(lat: number, lon: number): Promise<string | null> {
  try {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`);
    const p = parsePhoton(await r.json())[0];
    return p ? p.label : null;
  } catch { return null; }
}

// Nominatim (OSM Foundation): better at bare names like "Levi". Policy: max 1 request/s, so it is only
// used for the start/destination text, never for bulk lookups.
export function nominatimUrl(q: string, finlandOnly = true): string {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q); u.searchParams.set("format", "jsonv2"); u.searchParams.set("limit", "5");
  u.searchParams.set("accept-language", "fi");
  if (finlandOnly) u.searchParams.set("countrycodes", "fi");
  return u.toString();
}
export function parseNominatim(j: any): Place[] {
  return (Array.isArray(j) ? j : []).map((p: any) => ({
    name: p.name || p.display_name.split(",")[0], label: p.display_name.split(",").slice(0, 3).join(",").trim(),
    lat: Number(p.lat), lon: Number(p.lon), kind: `${p.category}:${p.type}`, country: "fi",
  }));
}
let lastNominatim = 0;
const ncache = new Map<string, Promise<Place[]>>();
export const nominatim: Geocoder = (q) => {
  const url = nominatimUrl(q);
  if (!ncache.has(url)) ncache.set(url, (async () => {
    const wait = lastNominatim + 1100 - Date.now(); lastNominatim = Math.max(Date.now(), lastNominatim + 1100);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await fetch(url); if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    return parseNominatim(await r.json());
  })().catch((e) => { ncache.delete(url); throw e; }));
  return ncache.get(url)!;
};
/** Text search for a start/destination: Nominatim first, Photon as fallback. */
export const searchPlace: Geocoder = async (q, o) => {
  if (o?.placeOnly) return photon(q, o);
  try { const n = await nominatim(q); if (n.length) return n; } catch { /* fall back */ }
  return photon(q, o);
};

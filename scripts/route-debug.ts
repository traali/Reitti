import { PNG } from "pngjs"; import fs from "node:fs"; import { extract } from "../src/lib/extract.ts"; import { photonUrl, parsePhoton, nominatimUrl, parseNominatim, type Geocoder } from "../src/lib/geocode.ts";
import { planRoute, osrmUrl } from "../src/lib/route.ts"; import { haversine } from "../src/lib/geo.ts";
const cacheFile = "tests/fixtures/geocode-cache.json"; const rcFile = "tests/fixtures/osrm-cache.json";
const cache: Record<string, any> = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
const rc: Record<string, any> = fs.existsSync(rcFile) ? JSON.parse(fs.readFileSync(rcFile, "utf8")) : {};
const UA = { headers: { "user-agent": "Reitti-tests (github.com/traali/Reitti)" } };
const geo: Geocoder = async (q, o) => { const u = photonUrl(q, o); if (!cache[u]) cache[u] = await (await fetch(u, UA)).json(); return parsePhoton(cache[u]); };
const search: Geocoder = async (q) => { const u = nominatimUrl(q); if (!cache[u]) { cache[u] = await (await fetch(u, UA)).json(); await new Promise(r => setTimeout(r, 1100)); } return parseNominatim(cache[u]); };
const fetcher = async (u: string) => { if (!rc[u]) { rc[u] = await (await fetch(u, UA)).json(); } return rc[u]; };
const truth: Record<string, [number, number]> = { "waze-kesalahti-1": [24.94, 60.17], "gmaps-levi-1": [24.94, 60.17], "apple-tampere-1": [24.85, 60.20] };
for (const f of process.argv.slice(2)) {
  const p = PNG.sync.read(fs.readFileSync(`tests/fixtures/${f}.png`));
  const lines = JSON.parse(fs.readFileSync(`tests/fixtures/${f}.ocr.json`, "utf8"));
  const x = await extract(p.data, p.width, p.height, lines, geo, search);
  if (!x.start || !x.destination) { console.log(f, "no start/dest"); continue; }
  const hints = x.routeHintPoints.map(([la, lo]) => [lo, la] as [number, number]);
  const r = await planRoute([x.start.lon, x.start.lat], [x.destination.lon, x.destination.lat], { hints, km: x.parsed.distanceKm, min: x.parsed.durationMin, fetcher });
  console.log(f, "start err km", (haversine([x.start.lon, x.start.lat], truth[f]) / 1000).toFixed(1), "readKm", x.parsed.distanceKm, "readMin", x.parsed.durationMin);
  for (const c of r.candidates) console.log("  ", c.how, (c.distanceM / 1000).toFixed(1), "km", Math.round(c.durationS / 60), "min score", c.score?.toFixed(2));
}
fs.writeFileSync(cacheFile, JSON.stringify(cache)); fs.writeFileSync(rcFile, JSON.stringify(rc));

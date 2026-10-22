// Runs the full extraction on fixtures with live Photon, recording geocodes to tests/fixtures/geocode-cache.json.
import { PNG } from "pngjs"; import fs from "node:fs"; import { extract } from "../src/lib/extract.ts"; import { photonUrl, parsePhoton, nominatimUrl, parseNominatim, type Geocoder } from "../src/lib/geocode.ts";
const cacheFile = "tests/fixtures/geocode-cache.json";
const cache: Record<string, any> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const geo: Geocoder = async (q, o) => { const u = photonUrl(q, o); if (!cache[u]) { cache[u] = await (await fetch(u, { headers: { "user-agent": "Reitti-tests (github.com/traali/Reitti)" } })).json(); await new Promise(r => setTimeout(r, 300)); } return parsePhoton(cache[u]); };
const search: Geocoder = async (q) => { const u = nominatimUrl(q); if (!cache[u]) { cache[u] = await (await fetch(u, { headers: { "user-agent": "Reitti-tests (github.com/traali/Reitti)" } })).json(); await new Promise(r => setTimeout(r, 1100)); } return parseNominatim(cache[u]); };
for (const f of process.argv.slice(2)) {
  const p = PNG.sync.read(fs.readFileSync(`tests/fixtures/${f}.png`));
  const lines = JSON.parse(fs.readFileSync(`tests/fixtures/${f}.ocr.json`, "utf8"));
  const x = await extract(p.data, p.width, p.height, lines, geo, search);
  console.log(f, JSON.stringify({ dest: x.destination?.label, destLL: x.destination && [x.destination.lat, x.destination.lon], start: x.start, dot: x.dot, used: x.fit?.used.map(a => a.name), rej: x.fit?.rejected.map(a => a.name), rms: x.fit?.rmsPx, labels: x.parsed.labels.map(l => l.text), hints: x.routeHintPoints.length, notes: x.notes }));
}
fs.writeFileSync(cacheFile, JSON.stringify(cache));

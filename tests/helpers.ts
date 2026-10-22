import fs from "node:fs"; import { PNG } from "pngjs";
import { photonUrl, parsePhoton, nominatimUrl, parseNominatim, type Geocoder } from "../src/lib/geocode";
const cache: Record<string, any> = JSON.parse(fs.readFileSync("tests/fixtures/geocode-cache.json", "utf8"));
export const osrmCache: Record<string, any> = JSON.parse(fs.readFileSync("tests/fixtures/osrm-cache.json", "utf8"));
/** Offline geocoders replaying recorded Photon/Nominatim answers (recorded with scripts/route-debug.ts). */
export const geo: Geocoder = async (q, o) => { const u = photonUrl(q, o); return cache[u] ? parsePhoton(cache[u]) : []; };
export const search: Geocoder = async (q) => { const u = nominatimUrl(q); return cache[u] ? parseNominatim(cache[u]) : []; };
export function load(name: string) {
  const p = PNG.sync.read(fs.readFileSync(`tests/fixtures/${name}.png`));
  return { px: p.data, W: p.width, H: p.height, lines: JSON.parse(fs.readFileSync(`tests/fixtures/${name}.ocr.json`, "utf8")) };
}

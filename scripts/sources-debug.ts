import fs from "node:fs"; import { fetchAll } from "../src/lib/sources.ts";
const rc = JSON.parse(fs.readFileSync("tests/fixtures/osrm-cache.json", "utf8"));
for (const [u, j] of Object.entries<any>(rc)) {
  const line = j.routes[0].geometry.coordinates; const t0 = Date.now();
  const r = await fetchAll(line, new Date());
  console.log(u.slice(48, 110), Date.now() - t0, "ms");
  for (const s of r.sources) console.log("  ", s.id, s.status, s.note.slice(0, 110));
  for (const a of r.alerts.slice(0, 4)) console.log("    *", Math.round(a.along / 1000), "km", a.kind, a.title.slice(0, 80));
}

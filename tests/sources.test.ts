import { describe, it, expect } from "vitest";
import { fetchAll, fetchTraffic, fetchHelsinki, toTrafficAlerts, parseFmi, stationAlert } from "../src/lib/sources";
import { Corridor } from "../src/lib/geo";
const line: [number, number][] = [[24.93, 60.17], [24.95, 60.19], [25.0, 60.25]];
const c = new Corridor(line, 150);
const now = new Date("2026-10-22T12:00:00Z");
const resp = (body: any, status = 200, ct = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": ct } });

describe("empty states", () => {
  it("every source reports empty / notcovered, never invents data", async () => {
    const f = (async (u: string) => {
      if (u.includes("opendata.fmi.fi")) return resp(`<wfs:FeatureCollection></wfs:FeatureCollection>`, 200, "text/xml");
      if (u.includes("espoo")) return resp(`<wfs:FeatureCollection></wfs:FeatureCollection>`, 200, "text/xml");
      return resp({ type: "FeatureCollection", features: [] });
    }) as typeof fetch;
    const r = await fetchAll(line, now, f);
    expect(r.alerts).toEqual([]);
    for (const s of r.sources) expect(["empty", "notcovered"]).toContain(s.status);
    expect(r.sources.find((s) => s.id === "helsinki-maint")!.status).toBe("notcovered");
    expect(r.sources.find((s) => s.id === "espoo-aurat")!.status).toBe("notcovered"); // route is not in Espoo
  });
});
describe("error states", () => {
  it("network failure is reported per source, with the reason", async () => {
    const f = (async () => { throw new Error("verkko poikki"); }) as typeof fetch;
    const r = await fetchAll(line, now, f);
    expect(r.alerts).toEqual([]);
    const traffic = r.sources.find((s) => s.id === "digitraffic-msg")!;
    expect(traffic.status).toBe("error"); expect(traffic.note).toMatch(/verkko poikki/);
    expect(r.sources.find((s) => s.id === "helsinki")!.status).toBe("error");
    expect(r.sources.find((s) => s.id === "fmi")!.status).toBe("error");
  });
  it("HTTP 500 is an error, not empty", async () => {
    const r = await fetchTraffic(c, (async () => resp("x", 500)) as typeof fetch);
    expect(r.status).toBe("error"); expect(r.note).toMatch(/500/);
  });
  it("Helsinki outside the route is notcovered without any request", async () => {
    let calls = 0; const far = new Corridor([[27, 61], [27.1, 61.1]], 150);
    const r = await fetchHelsinki(far, now, (async () => { calls++; return resp({}); }) as typeof fetch);
    expect(r.status).toBe("notcovered"); expect(calls).toBe(0);
  });
});
describe("parsers", () => {
  it("traffic message on the route is kept, one far away dropped", () => {
    const fc = { features: [
      { geometry: { type: "Point", coordinates: [24.95, 60.19] }, properties: { situationId: "A", version: 1, situationType: "ROAD_WORK", announcements: [{ title: "Tie 45, Helsinki. Tietyö.", location: { description: "Tuusulanväylä" }, roadWorkPhases: [{ timeAndDuration: { startTime: "2026-10-01T05:00:00Z", endTime: "2026-11-30T15:00:00Z" } }] }] } },
      { geometry: { type: "Point", coordinates: [26, 61] }, properties: { situationId: "B", version: 1, situationType: "ROAD_WORK", announcements: [{ title: "kaukana" }] } },
    ] };
    const a = toTrafficAlerts(fc, c);
    expect(a.map((x) => x.title)).toEqual(["Tie 45, Helsinki. Tietyö."]);
    expect(a[0].when).toMatch(/1\.10\.2026 – 30\.11\.2026/);
  });
  it("FMI simple XML", () => {
    const xml = `<wfs:FeatureCollection><BsWfs:Time>2026-10-22T13:00:00Z</BsWfs:Time>\n<BsWfs:ParameterName>Temperature</BsWfs:ParameterName>\n<BsWfs:ParameterValue>5.5</BsWfs:ParameterValue><BsWfs:Time>2026-10-22T13:00:00Z</BsWfs:Time><BsWfs:ParameterName>WindSpeedMS</BsWfs:ParameterName><BsWfs:ParameterValue>NaN</BsWfs:ParameterValue></wfs:FeatureCollection>`;
    expect(parseFmi(xml)).toEqual([{ time: "2026-10-22T13:00:00Z", t: 5.5 }]);
    expect(() => parseFmi("<html>")).toThrow();
  });
  it("stale road weather (over 3 h old) is dropped", () => {
    const st = { id: 1, name: "vt4_test", along: 0, dist: 10, point: [24.9, 60.2] as [number, number] };
    expect(stationAlert(st, { sensorValues: [{ name: "ILMA", value: 3, measuredTime: "2026-10-22T06:00:00Z" }] }, now)).toBeNull();
    expect(stationAlert(st, { sensorValues: [{ name: "ILMA", value: 3, measuredTime: "2026-10-22T11:50:00Z" }] }, now)!.detail).toMatch(/ilma 3 °C/);
  });
});

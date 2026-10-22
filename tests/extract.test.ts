import { describe, it, expect } from "vitest";
import { extract } from "../src/lib/extract";
import { planRoute } from "../src/lib/route";
import { haversine } from "../src/lib/geo";
import { geo, search, load, osrmCache } from "./helpers";

// Real iPhone screenshots (1170x2532). OCR output is recorded (tesseract.js fin+eng, PSM 11).
const HELSINKI: [number, number] = [24.94, 60.17];
const fetcher = async (u: string) => { if (!osrmCache[u]) throw new Error(`not recorded: ${u}`); return osrmCache[u]; };

describe("Waze: Your location -> Kesälahti", async () => {
  const s = load("waze-kesalahti-1");
  const x = await extract(s.px, s.W, s.H, s.lines, geo, search);
  it("reads header, via roads, distance and duration", () => {
    expect(x.parsed.app).toBe("waze");
    expect(x.parsed.destination).toMatch(/Kesälahti/);
    expect(x.parsed.viaRoads).toEqual(expect.arrayContaining(["7", "26", "6"]));
    expect(x.parsed.distanceKm).toBeCloseTo(385.7, 1);
    expect(x.parsed.durationMin).toBe(244);
  });
  it("geocodes the destination", () => { expect(x.destination!.lat).toBeCloseTo(61.89, 1); expect(x.destination!.lon).toBeCloseTo(29.83, 1); });
  it("estimates the start from the puck + town labels (Helsinki, within 10 km)", () => {
    expect(x.fit!.used.length).toBeGreaterThanOrEqual(5);
    expect(x.fit!.rejected.map((a) => a.name)).toContain("Sapolil"); // OCR junk geocoded to the USA is rejected
    expect(haversine([x.start!.lon, x.start!.lat], HELSINKI) / 1000).toBeLessThan(10);
  });
  it("routes within 10 % of the 385.7 km in the shot", async () => {
    const r = await planRoute([x.start!.lon, x.start!.lat], [x.destination!.lon, x.destination!.lat], { hints: x.routeHintPoints.map(([a, b]) => [b, a]), km: 385.7, min: 244, fetcher });
    expect(Math.abs(r.best.distanceM / 1000 - 385.7) / 385.7).toBeLessThan(0.1);
  });
});

describe("Google Maps: Your location -> Levi", async () => {
  const s = load("gmaps-levi-1");
  const x = await extract(s.px, s.W, s.H, s.lines, geo, search);
  it("reads destination and duration; distance is not visible", () => {
    expect(x.parsed.app).toBe("google");
    expect(x.parsed.destination).toMatch(/Levi/);
    expect(x.parsed.durationMin).toBe(704); // "11 hr 44 min" in the bottom sheet, not the 12 hr 13 min alternative bubble
    expect(x.parsed.distanceKm).toBeNull();
  });
  it("finds Levi (not Levinmäki)", () => { expect(x.destination!.lat).toBeCloseTo(67.78, 1); });
  it("start is only a coarse estimate (few labels): within 60 km of Helsinki", () => {
    expect(haversine([x.start!.lon, x.start!.lat], HELSINKI) / 1000).toBeLessThan(60);
  });
});

describe("Apple Maps: My Location -> Tampere", async () => {
  const s = load("apple-tampere-1");
  const x = await extract(s.px, s.W, s.H, s.lines, geo, search);
  it("reads destination, 187 km, 2 h", () => {
    expect(x.parsed.destination).toMatch(/Tampere/);
    expect(x.parsed.distanceKm).toBe(187);
    expect(x.parsed.durationMin).toBe(120);
  });
  it("start within 10 km of Helsinki", () => { expect(haversine([x.start!.lon, x.start!.lat], HELSINKI) / 1000).toBeLessThan(10); });
  it("routes within 5 % of 187 km", async () => {
    const r = await planRoute([x.start!.lon, x.start!.lat], [x.destination!.lon, x.destination!.lat], { hints: x.routeHintPoints.map(([a, b]) => [b, a]), km: 187, min: 120, fetcher });
    expect(Math.abs(r.best.distanceM / 1000 - 187) / 187).toBeLessThan(0.05);
  });
});

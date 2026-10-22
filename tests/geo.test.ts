import { describe, it, expect } from "vitest";
import { Corridor, haversine, bboxOf, pointAt } from "../src/lib/geo";
// Straight 10 km east-west line at 60.2 N.
const line: [number, number][] = Array.from({ length: 11 }, (_, i) => [24.8 + (i * 0.18) / 10, 60.2]);
const c = new Corridor(line, 150);
const north = (m: number) => m / 110540;
describe("route corridor (150 m buffer)", () => {
  it("length", () => expect(c.length / 1000).toBeCloseTo(haversine(line[0], line[10]) / 1000, 3));
  it("point 100 m off the line is inside, 200 m is outside", () => {
    expect(c.near([24.89, 60.2 + north(100)])!.dist).toBeCloseTo(100, -1);
    expect(c.near([24.89, 60.2 + north(200)])).toBeNull();
  });
  it("along-route position orders features", () => {
    const a = c.near([24.82, 60.2])!.along, b = c.near([24.95, 60.2])!.along;
    expect(a).toBeLessThan(b);
  });
  it("polygon the route passes through matches even if all vertices are far", () => {
    const d = north(400), poly = { type: "Polygon", coordinates: [[[24.88, 60.2 - d], [24.9, 60.2 - d], [24.9, 60.2 + d], [24.88, 60.2 + d], [24.88, 60.2 - d]]] };
    expect(c.match(poly)).not.toBeNull();
  });
  it("long line segment crossing near the route matches via densification", () => {
    expect(c.match({ type: "LineString", coordinates: [[24.9, 60.1], [24.9, 60.3]] })).not.toBeNull();
    expect(c.match({ type: "LineString", coordinates: [[25.2, 60.1], [25.2, 60.3]] })).toBeNull();
  });
  it("clip to a city bbox", () => {
    expect(c.clip({ minLon: 24.9, minLat: 60, maxLon: 25, maxLat: 61 })).not.toBeNull();
    expect(c.clip({ minLon: 26, minLat: 60, maxLon: 27, maxLat: 61 })).toBeNull();
  });
  it("bbox padding and midpoint", () => { expect(bboxOf(line, 1000).maxLat).toBeCloseTo(60.2 + north(1000), 5); expect(pointAt(line, c.cum, 0.5)[0]).toBeCloseTo(24.89, 3); });
});

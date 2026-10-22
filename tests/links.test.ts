import { describe, it, expect } from "vitest";
import { parseMapLink, isShortLink, parseLatLon } from "../src/lib/links";
import { parseDuration, parseDistanceKm } from "../src/lib/ocrparse";
describe("map links", () => {
  it("google dir path", () => expect(parseMapLink("https://www.google.com/maps/dir/Kamppi,+Helsinki/Porvoo/Kotka/@60.3,25.5,9z/data=!4m2")).toEqual({ origin: "Kamppi, Helsinki", destination: "Kotka", via: ["Porvoo"] }));
  it("google api=1", () => expect(parseMapLink("https://www.google.com/maps/dir/?api=1&origin=Espoo&destination=Tampere&waypoints=H%C3%A4meenlinna")).toEqual({ origin: "Espoo", destination: "Tampere", via: ["Hämeenlinna"] }));
  it("apple saddr/daddr", () => expect(parseMapLink("https://maps.apple.com/?saddr=Helsinki&daddr=Lahti%20to:Tampere")).toEqual({ origin: "Helsinki", destination: "Tampere", via: ["Lahti"] }));
  it("short links", () => { expect(isShortLink("https://maps.app.goo.gl/abc")).toBe(true); expect(isShortLink("https://example.com/x")).toBe(false); });
  it("garbage", () => { expect(parseMapLink("ei linkki")).toBeNull(); expect(parseMapLink("https://example.com/")).toBeNull(); });
  it("lat,lon", () => expect(parseLatLon("60.17, 24.94")).toEqual([24.94, 60.17]));
});
describe("ocr text parsing", () => {
  it("durations", () => { expect(parseDuration("4h 4m")).toBe(244); expect(parseDuration("11 hr 44 min")).toBe(704); expect(parseDuration("2 hrs")).toBe(120); expect(parseDuration("1 t 5 min")).toBe(65); });
  it("distance", () => { expect(parseDistanceKm("385,7 km")).toBe(385.7); expect(parseDistanceKm("187 km")).toBe(187); });
});

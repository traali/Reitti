// Shared map links -> start/destination text or coordinates. Short links are expanded by /api/resolve-link.
export interface LinkRoute { origin?: string; destination?: string; via: string[] }
export const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co", "maps.apple", "maps.apple.com", "waze.com", "www.waze.com", "ul.waze.com"];
const clean = (s: string) => decodeURIComponent(s.replace(/\+/g, " ")).trim();

export function isShortLink(u: string): boolean {
  try { const x = new URL(u); return ["maps.app.goo.gl", "goo.gl", "g.co", "maps.apple"].includes(x.hostname) || (x.hostname === "maps.apple.com" && /^\/p\//.test(x.pathname)); } catch { return false; }
}

export function parseMapLink(raw: string): LinkRoute | null {
  let u: URL; try { u = new URL(raw.trim()); } catch { return null; }
  const q = u.searchParams; const host = u.hostname.replace(/^www\./, "");
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === "maps.google.com") {
    if (q.get("api") === "1" || q.has("destination")) {
      const via = (q.get("waypoints") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
      return q.get("destination") ? { origin: q.get("origin") ?? undefined, destination: q.get("destination")!, via } : null;
    }
    if (q.has("daddr")) return { origin: q.get("saddr") ?? undefined, destination: q.get("daddr")!, via: [] };
    const m = u.pathname.match(/\/maps\/dir\/(.*)/);
    if (m) {
      const segs = m[1].split("/").filter((s) => s && !s.startsWith("@") && !s.startsWith("data=") && s !== "am=t").map(clean);
      if (segs.length >= 2) return { origin: segs[0] || undefined, destination: segs[segs.length - 1], via: segs.slice(1, -1) };
      if (segs.length === 1) return { destination: segs[0], via: [] };
    }
    const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (place) return { destination: clean(place[1]), via: [] };
    return null;
  }
  if (host === "maps.apple.com") {
    const d = q.get("daddr"); if (!d) { const ll = q.get("ll") ?? q.get("q"); return ll ? { destination: ll, via: [] } : null; }
    const parts = d.split(/\s+to:\s*/i).map((s) => s.trim()).filter(Boolean);
    return { origin: q.get("saddr") ?? undefined, destination: parts[parts.length - 1], via: parts.slice(0, -1) };
  }
  if (host.endsWith("waze.com")) {
    const ll = q.get("ll"); const qq = q.get("q");
    return ll || qq ? { destination: (ll ?? qq)!, via: [] } : null;
  }
  return null;
}

/** "60.17,24.94" -> [lon, lat] */
export function parseLatLon(s: string): [number, number] | null {
  const m = s.trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return null; const lat = +m[1], lon = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

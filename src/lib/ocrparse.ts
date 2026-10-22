// Parse OCR lines from a navigation-app screenshot into route hints.
// Everything returned is "what was read"; the UI always lets the user correct it.
export interface OcrLine { text: string; conf: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
export interface PlaceLabel { text: string; cx: number; cy: number; conf: number }
export interface ParsedShot {
  origin: string | null;
  originIsDevice: boolean;
  destination: string | null;
  viaRoads: string[];
  viaText: string | null;
  distanceKm: number | null;
  durationMin: number | null;
  labels: PlaceLabel[];
  app: "waze" | "google" | "apple" | "unknown";
}

const DEVICE = /\b(your location|my location|oma sijainti|sijaintisi|nykyinen sijainti|current location)\b/i;
const UI_WORDS = /\b(avoid|leave later|go now|go|start|add stops?|save|share|directions|options|fastest|best|typical traffic|best route|limited service|more|steps|aloita|lähde|tallenna|reittiohjeet|vaihtoehdot|nopein|paras|lisää pysähdys|add stop|eta|saapuminen|google ?maps|vältä|lähde myöhemmin)\b/i;
const COUNTRY = /^(finland|suomi|sweden|ruotsi|sverige|estonia|viro|eesti|norway|norja|norge|russia|venäjä|latvia|gulf of bothnia|gulf of finland|pohjanlahti|suomenlahti|baltic sea|itämeri)$/i;

export function parseDuration(s: string): number | null {
  const t = s.toLowerCase().replace(/,/g, ".");
  const m = t.match(/(\d{1,2})\s*(?:h|hr|hrs|hours?|t|tuntia?)\b(?:\s*(\d{1,2})\s*(?:m|min|mins|minutes?|minuuttia?)\b)?/);
  if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  const mm = t.match(/\b(\d{1,3})\s*(?:min|mins|minuuttia?)\b/);
  return mm ? Number(mm[1]) : null;
}

export function parseDistanceKm(s: string): number | null {
  const m = s.match(/(\d{1,4}(?:[.,]\d)?)\s*km\b/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function clean(s: string): string {
  return s.replace(/^[^A-Za-zÅÄÖåäöÜüÉé0-9]+/, "").replace(/[^A-Za-zÅÄÖåäöÜüÉé0-9.)]+$/, "").replace(/\s+/g, " ").trim();
}

function letters(s: string): number { return (s.match(/[A-Za-zÅÄÖåäöÜüÉé]/g) ?? []).length; }

/** "Via 7 / E18 - Valtatie 7 Porvoo; 26 Hamina; 6 -..." -> ["7","26","6"] plus text. */
export function parseVia(s: string): { roads: string[]; text: string } | null {
  const m = s.match(/\b(?:via|kautta|reitti)\s+(.+)$/i) ?? s.match(/^(.+)\s+kautta$/i);
  if (!m) return null;
  const text = m[1].trim();
  const roads: string[] = [];
  for (const part of text.split(/[;]/)) {
    const r = part.trim().match(/^(?:E\s?)?(\d{1,4})\b/i);
    if (r && !roads.includes(r[1])) roads.push(r[1]);
  }
  return { roads, text };
}

export function detectApp(all: string): ParsedShot["app"] {
  if (/google\s*:?\s*maps|\bhr\b.*\bmin\b/i.test(all)) return "google";
  if (/my location|\bhrs?\b.*fastest|add stop|\bGO\b/i.test(all) && !/go now/i.test(all)) return "apple";
  if (/leave later|go now|best route|avoid/i.test(all)) return "waze";
  return "unknown";
}

export function parseOcr(lines: OcrLine[], width: number, height: number): ParsedShot {
  const L = mergeFragments(lines).map((l) => ({ ...l, text: clean(l.text) })).filter((l) => l.text.length > 0);
  const all = L.map((l) => l.text).join("\n");
  const out: ParsedShot = { origin: null, originIsDevice: false, destination: null, viaRoads: [], viaText: null, distanceKm: null, durationMin: null, labels: [], app: detectApp(all) };

  // Header "A > B" / "A → B" (Waze)
  for (const l of L) {
    const m = l.text.match(/^(.{2,60}?)\s*(?:>|→|->|—>|›)\s*(.{2,60})$/);
    if (m && l.bbox.y0 < height * 0.25) {
      out.origin = clean(m[1]); out.destination = clean(m[2]); break;
    }
  }
  // Two stacked fields (Google top card, Apple sheet): a device-location line followed by the next place-like line.
  if (!out.destination) {
    const sorted = [...L].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const i = sorted.findIndex((l) => DEVICE.test(l.text) || /^(mistä|lähtö|from)\b/i.test(l.text));
    if (i >= 0) {
      out.origin = sorted[i].text.replace(/^(mistä|lähtö|from)\s*:?\s*/i, "");
      for (const n of sorted.slice(i + 1, i + 4)) {
        const t = n.text.replace(/^(mihin|kohde|määränpää|to)\s*:?\s*/i, "");
        if (n.bbox.y0 - sorted[i].bbox.y1 < height * 0.12 && letters(t) >= 3 && !UI_WORDS.test(t) && !parseDuration(t)) { out.destination = clean(t); break; }
      }
    }
  }
  if (out.origin && DEVICE.test(out.origin)) { out.originIsDevice = true; out.origin = null; }

  for (const l of L) {
    const v = parseVia(l.text);
    if (v && !out.viaText) { out.viaRoads = v.roads; out.viaText = v.text; }
  }
  // Distance/duration: prefer the line with both (summary), else the first found in the lower half.
  const lower = [...L].sort((a, b) => b.bbox.y0 - a.bbox.y0);
  for (const l of lower) { const d = parseDistanceKm(l.text); if (d != null) { out.distanceKm = d; break; } }
  const sheet = lower.filter((l) => l.bbox.y0 > height * 0.5);
  // Bottom-most duration = the selected route summary in the sheet (map bubbles above show alternatives).
  for (const l of sheet) { const d = parseDuration(l.text); if (d != null) { out.durationMin = d; break; } }

  // Map place labels: short, mostly letters, confident, not UI, not header/sheet lines.
  const used = new Set([out.origin, out.destination].filter(Boolean));
  for (const l of L) {
    const t = l.text.replace(/^[^A-Za-zÅÄÖåäö]+/, "");
    if (l.conf < 60 || t.length < 4 || letters(t) / t.length < 0.85 || t.split(" ").length > 3) continue;
    if (UI_WORDS.test(t) || DEVICE.test(t) || COUNTRY.test(t) || parseDuration(t) != null || used.has(t)) continue;
    if (!/^[A-ZÅÄÖ]/.test(t) || /[A-ZÅÄÖ]{3,}/.test(t)) continue;
    out.labels.push({ text: t, cx: (l.bbox.x0 + l.bbox.x1) / 2, cy: (l.bbox.y0 + l.bbox.y1) / 2, conf: l.conf });
  }
  return out;
}

/** Tesseract often splits a map label ("Ha" + "mina"); join pieces on the same baseline with a tiny gap. */
export function mergeFragments(lines: OcrLine[]): OcrLine[] {
  const out: OcrLine[] = []; const used = new Set<number>();
  const sorted = [...lines].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue; let cur = { ...sorted[i], bbox: { ...sorted[i].bbox } };
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue; const n = sorted[j]; const h = cur.bbox.y1 - cur.bbox.y0;
      if (Math.abs(n.bbox.y1 - cur.bbox.y1) < h * 0.35 && n.bbox.x0 - cur.bbox.x1 >= -2 && n.bbox.x0 - cur.bbox.x1 < h * 0.45 && /^[a-zåäö]/.test(n.text.trim())) {
        cur = { text: cur.text.trim() + n.text.trim(), conf: Math.min(cur.conf, n.conf), bbox: { x0: cur.bbox.x0, y0: Math.min(cur.bbox.y0, n.bbox.y0), x1: n.bbox.x1, y1: Math.max(cur.bbox.y1, n.bbox.y1) } };
        used.add(j);
      }
    }
    out.push(cur);
  }
  return out;
}

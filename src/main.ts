import "leaflet/dist/leaflet.css";
import "./style.css";
import L from "leaflet";
import { extract, type Extraction } from "./lib/extract";
import type { OcrLine } from "./lib/ocrparse";
import { photon, searchPlace, reverse } from "./lib/geocode";
import { planRoute, type Route } from "./lib/route";
import { fetchAll, type Alert, type SourceResult } from "./lib/sources";
import { parseMapLink, isShortLink, parseLatLon } from "./lib/links";
import type { LL } from "./lib/geo";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const km = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",")} km`;
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.round(min)} min`);

interface Field { ll?: LL; auto?: string }
const state: { x?: Extraction; origin: Field; dest: Field; route?: Route; alerts: Alert[]; seen: Set<string>; timer?: number } = { origin: {}, dest: {}, alerts: [], seen: new Set() };

function show(id: string) { $(id).hidden = false; $(id).scrollIntoView({ behavior: "smooth", block: "start" }); }
function msg(t: string, kind: "info" | "error" = "info") { const m = $("confirm-msg"); m.textContent = t; m.className = `msg ${kind}`; }
function progress(p: number | null, label = "") {
  const el = $("ocr-progress"); el.hidden = p === null;
  if (p !== null) { (el.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`; el.querySelector("span")!.textContent = label; }
}
for (const [id, key] of [["origin", "origin"], ["destination", "dest"]] as const)
  $(id).addEventListener("input", () => { state[key] = {}; });

// ---------- Screenshot ----------
let workerP: Promise<any> | null = null;
async function ocrWorker(onP: (p: number, s: string) => void) {
  if (!workerP) workerP = (async () => {
    const { createWorker } = await import("tesseract.js");
    const w = await createWorker(["fin", "eng"], 1, { logger: (m: any) => onP(m.progress ?? 0, m.status === "recognizing text" ? "Luetaan tekstiä…" : "Ladataan tekstintunnistusta…") });
    await w.setParameters({ tessedit_pageseg_mode: "11" as any });
    return w;
  })().catch((e) => { workerP = null; throw e; });
  return workerP;
}

$("file").addEventListener("change", async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
  progress(0, "Avataan kuvaa…");
  try {
    const bmp = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const w = await ocrWorker((p, s) => progress(p, s));
    progress(0.05, "Luetaan tekstiä…");
    const r = await w.recognize(file, {}, { blocks: true });
    const lines: OcrLine[] = [];
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) lines.push({ text: l.text.trim(), conf: Math.round(l.confidence), bbox: l.bbox });
    progress(0.9, "Tunnistetaan reittiä ja paikkoja…");
    const x = await extract(img.data, cv.width, cv.height, lines, photon, searchPlace);
    state.x = x;
    await fillFromExtraction(x);
    progress(null);
  } catch (e) {
    progress(null);
    show("confirm-card");
    msg(`Kuvan lukeminen epäonnistui (${e instanceof Error ? e.message : e}). Kirjoita lähtö ja määränpää itse.`, "error");
  }
});

async function fillFromExtraction(x: Extraction) {
  const p = x.parsed; const rows: string[] = [];
  const app = { google: "Google Maps", apple: "Apple Kartat", waze: "Waze", unknown: "tuntematon sovellus" }[p.app];
  rows.push(`<p><b>Sovellus:</b> ${app}</p>`);
  rows.push(`<p><b>Määränpää:</b> ${p.destination ? esc(p.destination) : "<i>ei luettu</i>"}${x.destination ? ` → ${esc(x.destination.label)}` : p.destination ? " (paikkaa ei löytynyt)" : ""}</p>`);
  rows.push(`<p><b>Lähtö:</b> ${p.origin ? esc(p.origin) : "<i>ei luettu</i>"}${p.originIsDevice ? " (laitteen sijainti)" : ""}</p>`);
  if (p.viaRoads.length || p.viaText) rows.push(`<p><b>Kautta:</b> ${esc(p.viaText || p.viaRoads.join(", "))}</p>`);
  const meta = [p.distanceKm ? `${String(p.distanceKm).replace(".", ",")} km` : "", p.durationMin ? hm(p.durationMin) : ""].filter(Boolean);
  rows.push(`<p><b>Matka/aika kuvassa:</b> ${meta.length ? meta.join(", ") : "<i>ei luettu</i>"}</p>`);
  if (p.labels.length) rows.push(`<p><b>Paikannimet kartalla:</b> ${esc(p.labels.map((l) => l.text).join(", "))}</p>`);
  if (x.fit) rows.push(`<p class="hint">Kartan sijainti päätelty ${x.fit.used.length} paikannimestä (${esc(x.fit.used.map((a) => a.name).join(", "))}), keskivirhe noin ${Math.round(x.fit.rmsPx)} px.</p>`);
  for (const n of x.notes) rows.push(`<p class="hint">${esc(n)}</p>`);
  $("read-summary").innerHTML = rows.join("");
  const o = $<HTMLInputElement>("origin"), d = $<HTMLInputElement>("destination"), v = $<HTMLInputElement>("via");
  d.value = x.destination?.label ?? p.destination ?? ""; state.dest = x.destination ? { ll: [x.destination.lon, x.destination.lat], auto: d.value } : {};
  v.value = "";
  if (x.start) {
    const name = await reverse(x.start.lat, x.start.lon);
    o.value = `${name ?? `${x.start.lat.toFixed(4)}, ${x.start.lon.toFixed(4)}`} (arvio)`;
    state.origin = { ll: [x.start.lon, x.start.lat], auto: o.value };
    msg(`Lähtöpaikka on arvio (${x.start.how}). Korjaa se, jos se on väärä, tai käytä sijaintiasi.`);
  } else { o.value = ""; state.origin = {}; msg("Lähtöpaikkaa ei voitu päätellä kuvasta. Kirjoita se tai käytä sijaintiasi.", "error"); }
  show("confirm-card");
}

// ---------- Link ----------
$("link-btn").addEventListener("click", async () => {
  let url = $<HTMLInputElement>("link").value.trim();
  show("confirm-card");
  try {
    if (isShortLink(url)) {
      msg("Avataan lyhytlinkkiä…");
      const r = await fetch(`/api/resolve-link?url=${encodeURIComponent(url)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      url = (await r.json()).url;
    }
    const lr = parseMapLink(url);
    if (!lr) { msg("Linkistä ei löytynyt reittiä. Kirjoita lähtö ja määränpää.", "error"); return; }
    state.x = undefined;
    $("read-summary").innerHTML = `<p><b>Linkistä luettu:</b> ${esc([lr.origin ?? "(oma sijainti)", ...lr.via, lr.destination ?? "?"].join(" → "))}</p>`;
    $<HTMLInputElement>("origin").value = lr.origin ?? ""; $<HTMLInputElement>("destination").value = lr.destination ?? ""; $<HTMLInputElement>("via").value = lr.via.join("; ");
    state.origin = {}; state.dest = {};
    msg(lr.origin ? "Tarkista ja hae reitti." : "Linkissä ei ollut lähtöpaikkaa: kirjoita se tai käytä sijaintiasi.");
  } catch (e) { msg(`Linkin avaaminen epäonnistui (${e instanceof Error ? e.message : e}).`, "error"); }
});
$("alt").addEventListener("toggle", () => { if (($("alt") as HTMLDetailsElement).open) $("confirm-card").hidden = false; });

$("locate").addEventListener("click", () => {
  if (!navigator.geolocation) return msg("Selain ei tue sijaintia.", "error");
  msg("Haetaan sijaintia…");
  navigator.geolocation.getCurrentPosition(async (p) => {
    const ll: LL = [p.coords.longitude, p.coords.latitude];
    const name = await reverse(ll[1], ll[0]);
    $<HTMLInputElement>("origin").value = `${name ?? `${ll[1].toFixed(4)}, ${ll[0].toFixed(4)}`} (sijaintisi)`;
    state.origin = { ll, auto: $<HTMLInputElement>("origin").value }; msg(`Sijainti saatu (tarkkuus noin ${Math.round(p.coords.accuracy)} m).`);
  }, (e) => msg(`Sijaintia ei saatu: ${e.message}`, "error"), { enableHighAccuracy: true, timeout: 15000 });
});

async function resolve(text: string, f: Field): Promise<LL | null> {
  if (f.ll && f.auto === text) return f.ll;
  const c = parseLatLon(text); if (c) return c;
  const hit = (await searchPlace(text.replace(/\((arvio|sijaintisi)\)$/, "").trim()))[0];
  return hit ? [hit.lon, hit.lat] : null;
}

// ---------- Route + sources ----------
$("go").addEventListener("click", async () => {
  const o = $<HTMLInputElement>("origin").value.trim(), d = $<HTMLInputElement>("destination").value.trim();
  if (!o || !d) return msg("Lähtö ja määränpää tarvitaan.", "error");
  const btn = $<HTMLButtonElement>("go"); btn.disabled = true;
  try {
    msg("Haetaan paikkoja…");
    const start = await resolve(o, state.origin); if (!start) return msg(`Lähtöpaikkaa "${o}" ei löytynyt.`, "error");
    const end = await resolve(d, state.dest); if (!end) return msg(`Määränpäätä "${d}" ei löytynyt.`, "error");
    const viaTexts = $<HTMLInputElement>("via").value.split(";").map((s) => s.trim()).filter(Boolean);
    const via: LL[] = [];
    for (const t of viaTexts) { const v = await resolve(t, {}); if (!v) return msg(`Kauttakohdetta "${t}" ei löytynyt.`, "error"); via.push(v); }
    msg("Lasketaan reittiä (OSRM)…");
    const fromShot = state.x && state.origin.auto === o && state.dest.auto === d;
    const hints: LL[] = fromShot ? state.x!.routeHintPoints.map(([la, lo]) => [lo, la] as LL) : [];
    const { best } = await planRoute(start, end, { via, hints, km: fromShot ? state.x!.parsed.distanceKm : null, min: fromShot ? state.x!.parsed.durationMin : null });
    state.route = best;
    renderRoute(best, fromShot ? state.x! : undefined);
    msg("");
    await loadSources(false);
  } catch (e) { msg(`Reitin haku epäonnistui (${e instanceof Error ? e.message : e}). Yritä hetken päästä uudelleen.`, "error"); }
  finally { btn.disabled = false; }
});

let map: L.Map | null = null, layer: L.LayerGroup | null = null;
function renderRoute(r: Route, x?: Extraction) {
  show("result-card");
  const cmp: string[] = [];
  if (x?.parsed.distanceKm) { const e = (r.distanceM / 1000 - x.parsed.distanceKm) / x.parsed.distanceKm * 100; cmp.push(`kuvassa ${String(x.parsed.distanceKm).replace(".", ",")} km (ero ${e > 0 ? "+" : ""}${e.toFixed(0)} %)`); }
  if (x?.parsed.durationMin) cmp.push(`kuvassa ${hm(x.parsed.durationMin)}`);
  const warn = cmp.length && x?.parsed.distanceKm && Math.abs(r.distanceM / 1000 - x.parsed.distanceKm) / x.parsed.distanceKm > 0.05
    ? `<p class="msg error">Laskettu reitti poikkeaa kuvan reitistä yli 5 %. Tarkista lähtö tai lisää kauttakohde.</p>` : "";
  $("route-summary").innerHTML = `<p><b>${km(r.distanceM)}</b>, noin ${hm(r.durationS / 60)} (${esc(r.how)})${cmp.length ? `<br><span class="hint">${cmp.join(", ")}</span>` : ""}</p>${warn}<p class="hint">Haetaan kohteet noin 150 m:n etäisyydeltä reitistä.</p>`;
  if (!map) {
    map = L.map("map", { zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMapin tekijät" }).addTo(map);
  }
  layer?.remove(); layer = L.layerGroup().addTo(map);
  const ll = r.line.map(([lo, la]) => [la, lo] as [number, number]);
  const pl = L.polyline(ll, { color: "#0ea5e9", weight: 5 }).addTo(layer);
  L.circleMarker(ll[0], { radius: 8, color: "#16a34a", fillOpacity: 1 }).bindTooltip("Lähtö").addTo(layer);
  L.circleMarker(ll[ll.length - 1], { radius: 8, color: "#dc2626", fillOpacity: 1 }).bindTooltip("Määränpää").addTo(layer);
  map.fitBounds(pl.getBounds(), { padding: [16, 16] });
  setTimeout(() => map!.invalidateSize(), 50);
}

const KIND: Record<Alert["kind"], [string, string]> = {
  tietyo: ["🚧", "Tietyö"], liikenne: ["⚠️", "Liikennetiedote"], kaivu: ["⛏️", "Kaivutyö"], jarjestely: ["🚦", "Liikennejärjestely"],
  kunnossapito: ["🧹", "Kunnossapito (tehty)"], keli: ["🌡️", "Tiesää"], ennuste: ["☁️", "Ennuste"],
};
const STATUS: Record<SourceResult["status"], string> = { ok: "✅", empty: "⚪", error: "❌", notcovered: "➖" };

async function loadSources(poll: boolean) {
  if (!state.route) return;
  const ul = $("sources");
  if (!poll) { ul.innerHTML = `<li>Haetaan tietoja lähteistä…</li>`; $("alerts").innerHTML = ""; }
  const live: SourceResult[] = [];
  const { sources, alerts } = await fetchAll(state.route.line, new Date(), fetch, (s) => { if (!poll) { live.push(s); renderSources(live, true); } });
  renderSources(sources, false);
  const fresh = alerts.filter((a) => !state.seen.has(a.id));
  if (poll && fresh.length && $<HTMLInputElement>("notify").checked && "Notification" in window && Notification.permission === "granted")
    new Notification(`Reitti: ${fresh.length} uutta`, { body: fresh.slice(0, 3).map((a) => a.title).join("\n") });
  for (const a of alerts) state.seen.add(a.id);
  state.alerts = alerts; renderAlerts(alerts);
}
function renderSources(s: SourceResult[], loading: boolean) {
  $("sources").innerHTML = s.map((x) => `<li class="src ${x.status}"><span>${STATUS[x.status]}</span><div><b>${esc(x.name)}</b><br>${esc(x.note)}<br><small>Lähde: ${esc(x.credit)}</small></div></li>`).join("") + (loading ? `<li>Haetaan muita lähteitä…</li>` : "");
}
function renderAlerts(alerts: Alert[]) {
  const ol = $("alerts");
  if (!alerts.length) { ol.innerHTML = `<li class="empty">Reitin varrelta ei löytynyt yhtään kohdetta saatavilla olevista lähteistä. Katso lähteiden tila yllä.</li>`; return; }
  ol.innerHTML = alerts.map((a, i) => `<li><button class="alert" data-i="${i}"><span class="n">${i + 1}</span><span class="k">${KIND[a.kind][0]} ${KIND[a.kind][1]} · ${km(a.along)} lähdöstä</span><b>${esc(a.title)}</b>${a.when ? `<span class="w">${esc(a.when)}</span>` : ""}<span class="d">${esc(a.detail).replace(/\n/g, "<br>")}</span><small>Lähde: ${esc(a.source)}</small></button></li>`).join("");
  if (layer) alerts.forEach((a, i) => {
    L.marker([a.point[1], a.point[0]], { icon: L.divIcon({ className: `pin ${a.kind}`, html: String(i + 1), iconSize: [26, 26] }) }).bindPopup(`<b>${esc(a.title)}</b><br>${esc(a.when ?? "")}`).addTo(layer!);
  });
  ol.querySelectorAll<HTMLButtonElement>("button.alert").forEach((b) => b.addEventListener("click", () => {
    const a = alerts[+b.dataset.i!]; map?.setView([a.point[1], a.point[0]], 14); $("map").scrollIntoView({ behavior: "smooth" });
  }));
}

$("notify").addEventListener("change", async (e) => {
  const on = (e.target as HTMLInputElement).checked;
  if (state.timer) { clearInterval(state.timer); state.timer = undefined; }
  if (!on) return;
  if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  if (!("Notification" in window) || Notification.permission !== "granted") { (e.target as HTMLInputElement).checked = false; alert("Selain ei salli ilmoituksia tälle sivulle."); return; }
  state.timer = window.setInterval(() => loadSources(true).catch(() => {}), 5 * 60_000);
});

// Pages Function: expand a shared Google/Apple Maps short link to its full URL (no content is fetched or stored).
// Only these hosts are followed, at most 5 redirects.
const ALLOW = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.apple|maps\.apple\.com|(www\.)?google\.[a-z.]+|maps\.google\.com|consent\.google\.com)$/;
export const onRequestGet = async ({ request }: { request: Request }) => {
  let url = new URL(request.url).searchParams.get("url") ?? "";
  for (let i = 0; i < 5; i++) {
    let u: URL; try { u = new URL(url); } catch { return Response.json({ error: "bad url" }, { status: 400 }); }
    if (u.protocol !== "https:" || !ALLOW.test(u.hostname)) return Response.json({ error: "host not allowed" }, { status: 400 });
    if (u.hostname === "consent.google.com" && u.searchParams.get("continue")) { url = u.searchParams.get("continue")!; continue; }
    const r = await fetch(u.toString(), { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Reitti link resolver)" } });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, u).toString(); continue; }
    return Response.json({ url: u.toString() }, { headers: { "cache-control": "public, max-age=3600" } });
  }
  return Response.json({ url }, { headers: { "cache-control": "public, max-age=3600" } });
};

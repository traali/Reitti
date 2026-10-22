// Pages Function: same-origin proxy for Espoo's winter-maintenance WFS (Espoon kaupunki, CC BY 4.0).
// Upstream serves ~4.7 MB of uncompressed GML; Cloudflare compresses this response and caches it briefly.
const UPSTREAM = "https://kartat.espoo.fi/teklaogcweb/wfs.ashx?service=WFS&version=1.1.0&request=GetFeature&typeName=GIS:AuratKartalla";

export const onRequestGet = async ({ request }: { request: Request }) => {
  const bbox = new URL(request.url).searchParams.get("bbox") ?? "";
  if (bbox && !/^\d{7,8}(\.\d+)?(,\d{7,8}(\.\d+)?){3}$/.test(bbox)) return new Response("bad bbox", { status: 400 });
  const url = bbox ? `${UPSTREAM}&bbox=${bbox}` : UPSTREAM;
  const up = await fetch(url, { cf: { cacheTtl: 120, cacheEverything: true } } as RequestInit);
  if (!up.ok) return new Response(`upstream ${up.status}`, { status: 502 });
  return new Response(up.body, {
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*" },
  });
};

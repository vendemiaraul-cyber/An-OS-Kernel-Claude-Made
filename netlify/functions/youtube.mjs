// ConMon Lab - YouTube Data API v3 proxy (Netlify Function).
//
// Keeps your API key on the server: set YOUTUBE_API_KEY in
// Netlify > Site configuration > Environment variables.
//
//   GET /api/youtube?endpoint=status
//   GET /api/youtube?endpoint=search&q=...&maxResults=12&order=relevance
//   GET /api/youtube?endpoint=videos&id=ID1,ID2
//   GET /api/youtube?endpoint=channels&id=CHANNEL_ID

const API = "https://www.googleapis.com/youtube/v3/";

// Only these endpoints and parameters are forwarded to Google.
const ALLOWED = {
  search: {
    fixed: { part: "snippet" },
    params: ["q", "type", "order", "maxResults", "pageToken", "safeSearch", "regionCode",
             "relevanceLanguage", "videoDuration", "videoEmbeddable", "channelId", "publishedAfter"],
    cacheSeconds: 300,
  },
  videos: {
    fixed: { part: "snippet,contentDetails,statistics" },
    params: ["id", "chart", "regionCode", "maxResults", "pageToken", "videoCategoryId"],
    cacheSeconds: 120,
  },
  channels: {
    fixed: { part: "snippet,statistics" },
    params: ["id"],
    cacheSeconds: 600,
  },
};

const json = (status, body, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });

function apiKey() {
  // Netlify global is available in Netlify Functions; process.env works locally too.
  const fromNetlify = typeof Netlify !== "undefined" ? Netlify.env.get("YOUTUBE_API_KEY") : undefined;
  return fromNetlify || process.env.YOUTUBE_API_KEY || "";
}

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: { message: "Only GET is supported." } });

  const url = new URL(req.url);
  const endpoint = url.searchParams.get("endpoint") || "";
  const key = apiKey();

  if (endpoint === "status") {
    return json(200, { serverKey: Boolean(key) }, { "cache-control": "no-store" });
  }

  const spec = ALLOWED[endpoint];
  if (!spec) return json(400, { error: { message: `Unknown endpoint "${endpoint}".` } });
  if (!key) {
    return json(503, { error: { code: "NO_SERVER_KEY",
      message: "YOUTUBE_API_KEY is not set on this Netlify site." } });
  }

  const upstream = new URL(API + endpoint);
  for (const [k, v] of Object.entries(spec.fixed)) upstream.searchParams.set(k, v);
  for (const name of spec.params) {
    const value = url.searchParams.get(name);
    if (value != null && value !== "") upstream.searchParams.set(name, value.slice(0, 500));
  }
  if (endpoint === "search" && !upstream.searchParams.get("q") && !upstream.searchParams.get("channelId")) {
    return json(400, { error: { message: "search needs a q (query) parameter." } });
  }
  upstream.searchParams.set("key", key);

  let res;
  try {
    res = await fetch(upstream, { headers: { accept: "application/json" } });
  } catch (err) {
    return json(502, { error: { message: "Could not reach the YouTube API." } });
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": res.ok ? `public, max-age=${spec.cacheSeconds}` : "no-store",
    },
  });
};

export const config = { path: "/api/youtube" };

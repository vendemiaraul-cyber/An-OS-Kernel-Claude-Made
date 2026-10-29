// ConMon Lab - Claude Haiku proxy for the "Haiku advancement" (Netlify Function).
//
// Keeps your Anthropic API key on the server: set ANTHROPIC_API_KEY in
// Netlify > Site configuration > Environment variables.
//
//   GET  /api/claude          -> { ready: true|false }
//   POST /api/claude          { system, messages, max_tokens } -> { text }

const MODEL = "claude-haiku-5-5";
const API = "https://api.anthropic.com/v1/messages";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function apiKey() {
  try { if (globalThis.Netlify && Netlify.env) return Netlify.env.get("ANTHROPIC_API_KEY") || ""; } catch (_) {}
  return process.env.ANTHROPIC_API_KEY || "";
}

export default async (req) => {
  const key = apiKey();
  if (req.method === "GET") return json(200, { ready: !!key, model: MODEL });
  if (req.method !== "POST") return json(405, { error: "Use GET or POST." });
  if (!key) return json(503, { error: "ANTHROPIC_API_KEY is not set on this Netlify site." });

  let body;
  try { body = await req.json(); } catch (_) { return json(400, { error: "Send JSON." }); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
  if (!messages.length) return json(400, { error: "No messages." });
  const clean = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }));
  if (!clean.length || clean[clean.length - 1].role !== "user") return json(400, { error: "The last message must be from the user." });

  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: Math.min(Number(body.max_tokens) || 4096, 8192),
      system: String(body.system || "").slice(0, 6000),
      messages: clean,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json(res.status, { error: (data.error && data.error.message) || `Anthropic answered ${res.status}` });
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return json(200, { text, model: data.model || MODEL });
};

export const config = { path: "/api/claude" };

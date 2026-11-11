// Diagnostics for the project's GEMINI_API_KEY (the key never leaves the function).
// GET: list models. POST {models: string[]}: send each a tiny JSON-schema request and report status / quota errors.
Deno.serve(async req => {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return new Response(JSON.stringify({ error: "no GEMINI_API_KEY" }), { status: 400 });
  const base = "https://generativelanguage.googleapis.com/v1beta";
  if (req.method === "POST") {
    const { models } = await req.json() as { models: string[] };
    const res = await Promise.all(models.map(async m => {
      const t = Date.now();
      const r = await fetch(`${base}/models/${m}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Name one classic colour that goes with navy. Answer in JSON." }] }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { color: { type: "string" } }, required: ["color"] } },
        }),
      });
      const b = await r.json();
      return { model: m, status: r.status, ms: Date.now() - t, text: b.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("")?.slice(0, 80), usage: b.usageMetadata, error: b.error?.message?.slice(0, 300) };
    }));
    return new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json" } });
  }
  const out: unknown[] = [];
  let page = "";
  do {
    const r = await fetch(`${base}/models?pageSize=1000${page ? `&pageToken=${page}` : ""}`, { headers: { "x-goog-api-key": key } });
    const b = await r.json();
    if (!r.ok) return new Response(JSON.stringify(b), { status: r.status });
    for (const m of b.models ?? []) out.push({ name: m.name, display: m.displayName, methods: m.supportedGenerationMethods, input: m.inputTokenLimit, output: m.outputTokenLimit, thinking: m.thinking });
    page = b.nextPageToken ?? "";
  } while (page);
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});

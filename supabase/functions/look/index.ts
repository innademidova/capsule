// Draws a woman wearing an outfit made of the owner's items (OpenAI gpt-image-2.6-sunburst).
// The item photos are the references; her appearance comes from style_profile.appearance (words, not photos).
// Writes photos/<uid>/looks/<uuid>.webp and returns its path. The key is a Supabase secret (OPENAI_API_KEY).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = "gpt-image-2.6-sunburst";
const QUALITY = "medium";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Piece = { id: string; category: string; kind: string | null; name: string | null; colors: string[]; photo_path: string | null };

// Outer layers first, so the model reads the outfit from the outside in
const ORDER = ["outerwear", "dress", "top", "bottom", "swim", "shoes", "bag", "accessory"];

function buildPrompt(pieces: Piece[], appearance: string, scene: string, vibe: string) {
  const list = pieces.map((p, n) => `- Image ${n + 1}: ${p.name ?? p.kind ?? p.category} (${p.category}${p.kind ? `, ${p.kind}` : ""}; ${p.colors.join(", ")})`).join("\n");
  const has = (c: string) => pieces.some(p => p.category === c);
  return `Photorealistic full-body street-style fashion photo, vertical, like a polished Instagram fashion post. One woman wearing a complete outfit made of exactly these pieces:
${list}

THE WOMAN
${appearance || "A woman in her late twenties with a natural, elegant look."}
Natural, relaxed and confident; a real person, not a mannequin. Light natural make-up.

THE CLOTHES (most important)
- Each piece must look exactly like its photo: the same colour and shade, fabric and texture, length, fit and every detail (buttons, collar, neckline, pleats, pockets, hardware, print).
- She wears every listed piece, styled the way a stylist would${vibe ? ` for a "${vibe}" look` : ""} (tucked, belted, sleeves pushed up, coat on the shoulders and so on, only when it suits).
- Do not add other visible garments.${has("shoes") ? "" : " She has no shoes in the list: give her simple, current shoes that suit the outfit and do not draw attention."}${has("bag") ? "" : " No bag unless it is in the list."} At most small, simple jewellery.

THE PHOTO
- ${scene || "A calm European city street in soft daylight, walking towards the camera."}
- Full body from head to shoes in the frame, camera at about waist height, soft natural light, gentle background blur, true-to-life colours.
- A single photo: no text, letters, logos, watermarks, collage, frames or borders.`;
}

async function download(sb: SupabaseClient, path: string) {
  const { data, error } = await sb.storage.from("photos").download(path);
  if (error || !data) throw new Error("Could not read a photo");
  return data;
}

// USD per 1M tokens, standard tier (developers.openai.com/api/docs/pricing, 2026-11-10)
const PRICE = { text_in: 5, image_in: 8, output: 30 };
type ImageUsage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };

function costOf(u: ImageUsage) {
  const text_in = u.input_tokens_details?.text_tokens ?? 0;
  const image_in = u.input_tokens_details?.image_tokens ?? Math.max(0, (u.input_tokens ?? 0) - text_in);
  const output = u.output_tokens ?? 0;
  const cost_usd = (text_in * PRICE.text_in + image_in * PRICE.image_in + output * PRICE.output) / 1e6;
  return { text_in, image_in, output, cost_usd };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Please sign in again" }, 401);
    if (!Deno.env.get("OPENAI_API_KEY")) throw new Error("OpenAI key is not set up yet.");
    const { item_ids = [], scene = "", vibe = "" } = await req.json() as { item_ids?: string[]; scene?: string; vibe?: string };
    const { data: rows } = await sb.from("items").select("id,category,kind,name,colors,photo_path").in("id", item_ids.slice(0, 10));
    const pieces = ((rows ?? []) as Piece[]).filter(p => p.photo_path)
      .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)).slice(0, 8);
    if (!pieces.length) throw new Error("No pieces with photos in this outfit");
    const { data: prof } = await sb.from("style_profile").select("appearance").maybeSingle();

    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", buildPrompt(pieces, prof?.appearance ?? "", scene, vibe));
    form.append("quality", QUALITY);
    form.append("size", "1024x1536");
    form.append("output_format", "webp");
    form.append("output_compression", "90");
    for (const [n, p] of pieces.entries()) {
      const img = await download(sb, p.photo_path!);
      form.append("image[]", img, `image-${n}.${img.type.split("/")[1] || "webp"}`);
    }
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: form,
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${body.error?.message ?? "unknown"}`);

    const path = `${user.id}/looks/${crypto.randomUUID()}.webp`;
    const { error } = await sb.storage.from("photos").upload(path, decodeBase64(body.data[0].b64_json), { contentType: "image/webp" });
    if (error) throw error;
    const usage = costOf(body.usage ?? {});
    await sb.from("ai_usage").insert({ kind: "look", model: MODEL, ...usage, raw: body.usage ?? null });
    return json({ path, ...usage });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

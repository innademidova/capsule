// Look images (OpenAI gpt-image-2.6-sunburst), two jobs:
// 1. {item_ids, scene, vibe, palette?, request_id?, index?}: a styling post in the format of the layout reference
//    (the user's own style_profile.look_reference, else the global app_settings.look_reference): the woman wearing the outfit on one side, the separate pieces and a palette on the
//    other, no text. The item photos are the clothing references; her appearance comes from style_profile.appearance.
//    With request_id/index the path is also written into that ai_requests row (looks[index].image_path).
// 2. {clean_path, global?}: removes text, page numbers and app icons from a screenshot meant to be the layout reference.
//    global: save it to photos/global/reference/ (the storage policy lets only admins write there).
// Writes to photos/<uid>/looks/ (or reference/) and returns the path. The key is a Supabase secret (OPENAI_API_KEY).
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

function buildPrompt(pieces: Piece[], appearance: string, scene: string, vibe: string, palette: string[], hasRef: boolean) {
  const list = pieces.map((p, n) => `- Image ${n + 1}: ${p.name ?? p.kind ?? p.category} (${p.category}${p.kind ? `, ${p.kind}` : ""}; ${p.colors.join(", ")})`).join("\n");
  const has = (c: string) => pieces.some(p => p.category === c);
  return `Create a vertical Instagram styling post (2:3) in exactly the same format as the layout reference${hasRef ? ` (the last image, image ${pieces.length + 1})` : ""}:
- Left part, about 55% of the width, full height: a photorealistic full-body street-style photo of one woman wearing the outfit.
- Right part: a plain warm off-white (#f3eee6) panel. At the top a row of ${palette.length || "3–5"} round colour dots${palette.length ? ` in these colours, left to right: ${palette.join(", ")}` : " with the main colours of the outfit"}. Below them, each piece of the outfit as a separate clean product photo (no person, no hanger), neatly arranged like the reference with small even gaps, all fully visible.
- The same pieces appear in both parts and look identical in both.
- ${hasRef ? "Copy ONLY the layout, proportions, spacing and mood of the reference. Do not copy its clothes, person, colours or any text." : "Clean, editorial, calm."}
- No text at all: no titles, numbers, lists, labels, logos, icons or watermarks.

The outfit is made of exactly these pieces:
${list}

THE WOMAN
${appearance || "A woman in her late twenties with a natural, elegant look."}
Natural, relaxed and confident; a real person, not a mannequin. Light natural make-up.

THE CLOTHES (most important)
- Each piece must look exactly like its photo: the same colour and shade, fabric and texture, length, fit and every detail (buttons, collar, neckline, pleats, pockets, hardware, print).
- She wears every listed piece, styled the way a stylist would${vibe ? ` for a "${vibe}" look` : ""} (tucked, belted, sleeves pushed up, coat on the shoulders and so on, only when it suits).
- Do not add other visible garments.${has("shoes") ? "" : " She has no shoes in the list: give her simple, current shoes that suit the outfit and do not draw attention."}${has("bag") ? "" : " No bag unless it is in the list."} At most small, simple jewellery.

THE PHOTO OF HER
- ${scene || "A calm European city street in soft daylight, walking towards the camera."}
- Full body from head to shoes, camera at about waist height, soft natural light, gentle background blur, true-to-life colours.`;
}

const CLEAN = `This is a screenshot of an Instagram styling post. Return the same post, cleaned:
- Remove ALL text: titles, numbers, page counters like "3/12", lists of item names, divider lines under or above text.
- Remove app interface elements such as the round mute/sound icon, progress dots and bars.
- Fill the removed areas so they match their surroundings (the photo background or the plain panel colour).
- Keep everything else exactly as it is: the photo of the woman, the product photos of the clothes, the round colour dots, the layout and proportions. Do not crop, move or redraw them.`;

async function download(sb: SupabaseClient, path: string) {
  const { data, error } = await sb.storage.from("photos").download(path);
  if (error || !data) throw new Error("Could not read a photo");
  return data;
}

async function callImages(form: FormData) {
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: form,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${body.error?.message ?? "unknown"}`);
  return { b64: body.data[0].b64_json as string, usage: (body.usage ?? {}) as ImageUsage };
}

async function save(sb: SupabaseClient, path: string, b64: string) {
  const { error } = await sb.storage.from("photos").upload(path, decodeBase64(b64), { contentType: "image/webp" });
  if (error) throw error;
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
    const body0 = await req.json() as { item_ids?: string[]; scene?: string; vibe?: string; palette?: string[]; request_id?: string; index?: number; clean_path?: string; global?: boolean };
    const { item_ids = [], scene = "", vibe = "", palette = [], request_id, index, clean_path, global = false } = body0;

    if (clean_path) {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", CLEAN);
      form.append("quality", QUALITY);
      form.append("size", "auto");
      form.append("output_format", "webp");
      form.append("output_compression", "90");
      const img = await download(sb, clean_path);
      form.append("image[]", img, `reference.${img.type.split("/")[1] || "png"}`);
      const out = await callImages(form);
      const path = `${global ? "global" : user.id}/reference/${crypto.randomUUID()}.webp`;
      await save(sb, path, out.b64);
      const usage = costOf(out.usage);
      await sb.from("ai_usage").insert({ kind: "reference", model: MODEL, ...usage, raw: out.usage });
      return json({ path, ...usage });
    }

    const { data: rows } = await sb.from("items").select("id,category,kind,name,colors,photo_path").in("id", item_ids.slice(0, 10));
    const pieces = ((rows ?? []) as Piece[]).filter(p => p.photo_path)
      .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)).slice(0, 8);
    if (!pieces.length) throw new Error("No pieces with photos in this outfit");
    const { data: prof } = await sb.from("style_profile").select("appearance,look_reference").maybeSingle();
    const { data: def } = await sb.from("app_settings").select("value").eq("key", "look_reference").maybeSingle();
    const refPath: string | null = prof?.look_reference ?? def?.value?.path ?? null;
    const ref = refPath ? await download(sb, refPath).catch(() => null) : null;

    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", buildPrompt(pieces, prof?.appearance ?? "", scene, vibe, palette.slice(0, 6), !!ref));
    form.append("quality", QUALITY);
    form.append("size", "1024x1536");
    form.append("output_format", "webp");
    form.append("output_compression", "90");
    for (const [n, p] of pieces.entries()) {
      const img = await download(sb, p.photo_path!);
      form.append("image[]", img, `image-${n}.${img.type.split("/")[1] || "webp"}`);
    }
    if (ref) form.append("image[]", ref, `layout.${ref.type.split("/")[1] || "webp"}`);
    const out = await callImages(form);

    const path = `${user.id}/looks/${crypto.randomUUID()}.webp`;
    await save(sb, path, out.b64);
    const usage = costOf(out.usage);
    await sb.from("ai_usage").insert({ kind: "look", model: MODEL, ...usage, raw: out.usage });
    if (request_id && index != null) await sb.rpc("set_look_image", { req: request_id, n: index, path });
    return json({ path, ...usage });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

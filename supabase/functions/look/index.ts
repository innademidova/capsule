// Look images: OpenAI gpt-image-2.6-sunburst first (she preferred its look on 2026-11-12: Gemini drew image numbers and
// hex codes and followed the template less), Gemini Nano Banana Pro at 2K (_shared/gemini-image.ts) as the fallback. Every image copies the layout of a template picture for its purpose:
// the user's own style_profile.templates[<id>], else the global app_settings 'template:<id>' (ids in src/lib.ts TEMPLATES).
// Three jobs:
// 1. {item_ids, scene, vibe, palette?, request_id?, index?}: template 'look', a styling post: the woman wearing the outfit on one side, the separate pieces and a palette on the
//    other, no text. The item photos are the clothing references; her appearance comes from style_profile.appearance.
//    With request_id/index the path is also written into that ai_requests row (looks[index].image_path).
// 3. {many: {anchor_id, title, looks: [{label, item_ids}], palette}, request_id?}: template 'many', one collage:
//    the anchor piece in the middle and the same woman in each look around it. Written to result.collage_path.
// 2. {clean_path, global?}: removes text, page numbers and app icons from a screenshot meant to be the layout reference.
//    global: save it to photos/global/reference/ (the storage policy lets only admins write there).
// Writes to photos/<uid>/looks/ (or reference/) and returns the path. The key is a Supabase secret (OPENAI_API_KEY).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { geminiImage, extOf } from "../_shared/gemini-image.ts";

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
- No text at all: no titles, numbers (the image numbers below are only for you), hex codes, lists, labels, logos, icons or watermarks.

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

type Many = { anchor_id: string; title: string; looks: { label: string; item_ids: string[] }[]; palette: string[] };

// One collage: the anchor piece in the middle, the same woman wearing each look around it
function buildManyPrompt(pieces: Piece[], appearance: string, many: Many, hasRef: boolean) {
  const num = new Map(pieces.map((p, n) => [p.id, n + 1]));
  const list = pieces.map((p, n) => `- Image ${n + 1}: ${p.name ?? p.kind ?? p.category} (${p.category}${p.kind ? `, ${p.kind}` : ""}; ${p.colors.join(", ")})`).join("\n");
  const looks = many.looks.map((l, k) => {
    const imgs = l.item_ids.map(id => num.get(id)).filter(Boolean);
    return `- Photo ${k + 1}, label "${l.label}": she wears images ${imgs.join(", ")}`;
  }).join("\n");
  const anchor = pieces[0];
  return `Create a vertical Pinterest-style styling collage (2:3) in the same format as the layout reference${hasRef ? ` (the last image, image ${pieces.length + 1})` : ""}:
- In the centre, large: a clean product photo of image 1 (${anchor.name ?? anchor.kind ?? anchor.category}) on its own, exactly as it is.
- Around it, ${many.looks.length} separate full-body street-style photos of the SAME woman, one per look below, arranged like the photos in the reference (torn-paper edges, small tilt, soft shadow), all fully visible and not overlapping the centre piece.
- Background: a warm, plain beige paper texture like the reference.
- Text, in the same elegant fonts and places as the reference, and nothing else: the headline "${many.title.toUpperCase()}" with "many looks" in script under it; next to each photo its short handwritten label with a small arrow; at the bottom a row of ${many.palette.length || 5} round colour dots${many.palette.length ? ` in these colours, left to right: ${many.palette.join(", ")}` : ""}. Spell every word exactly as given. The image numbers below are only for you: never draw numbers, hex codes or any other text.
- ${hasRef ? "Copy ONLY the layout, proportions, fonts and mood of the reference. Do not copy its clothes, person or colours." : "Calm, editorial, airy."}

The pieces (product photos):
${list}

The looks (every photo shows image 1 plus the listed pieces, and no other visible garments; simple shoes if none are listed):
${looks}

THE WOMAN (the same person in every photo)
${appearance || "A woman in her late twenties with a natural, elegant look."}
Natural, relaxed and confident; light natural make-up; different natural poses and city backgrounds per photo.

THE CLOTHES (most important)
- Each piece must look exactly like its photo: the same colour and shade, fabric and texture, length, fit and details.
- Image 1 must be identical in the centre and in every look.
- True-to-life colours, soft daylight.`;
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

async function save(sb: SupabaseClient, path: string, b64: string, mime: string) {
  const { error } = await sb.storage.from("photos").upload(path, decodeBase64(b64), { contentType: mime });
  if (error) throw error;
}

// Draws one picture and logs its cost. OpenAI first (with these form fields); Gemini if OpenAI fails and there is
// still time left in the function (~150 s wall clock). images: in the order the prompt numbers them.
async function paint(sb: SupabaseClient, kind: string, prompt: string, images: Blob[],
  o: { aspect?: string; size: "1K" | "2K"; openai: Record<string, string> }) {
  const started = Date.now();
  let why = "";
  if (Deno.env.get("OPENAI_API_KEY")) {
    try {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", prompt);
      for (const [k, v] of Object.entries(o.openai)) form.append(k, v);
      form.append("output_format", "webp");
      form.append("output_compression", "90");
      images.forEach((img, n) => form.append("image[]", img, `image-${n + 1}.${img.type.split("/")[1] || "png"}`));
      const out = await callImages(form);
      const usage = costOf(out.usage);
      await sb.from("ai_usage").insert({ kind, model: MODEL, ...usage, raw: out.usage });
      return { b64: out.b64, mime: "image/webp", model: "OpenAI", cost_usd: usage.cost_usd, skipped: [] as string[] };
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
      console.warn("openai image failed", why);
    }
  }
  const left = 140_000 - (Date.now() - started);
  if (left < 30_000) throw new Error(why || "No time left");
  const g = await geminiImage(prompt, images, { aspect: o.aspect, size: o.size, budgetMs: left });
  const { text_in, image_in, output, cost_usd } = g;
  await sb.from("ai_usage").insert({ kind, model: g.model, text_in, image_in, output, cost_usd, raw: g.raw });
  return { b64: g.b64, mime: g.mime, model: g.model, cost_usd, skipped: why ? [why, ...g.skipped] : g.skipped };
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
    if (!Deno.env.get("GEMINI_API_KEY") && !Deno.env.get("OPENAI_API_KEY")) throw new Error("No image AI key is set up yet.");
    const body0 = await req.json() as {
      item_ids?: string[]; scene?: string; vibe?: string; palette?: string[]; request_id?: string; index?: number;
      clean_path?: string; global?: boolean; many?: Many;
    };
    const { item_ids = [], scene = "", vibe = "", palette = [], request_id, index, clean_path, global = false, many } = body0;

    if (clean_path) {
      const img = await download(sb, clean_path);
      const out = await paint(sb, "reference", CLEAN, [img], { size: "2K", openai: { quality: QUALITY, size: "auto" } });
      const path = `${global ? "global" : user.id}/reference/${crypto.randomUUID()}.${extOf(out.mime)}`;
      await save(sb, path, out.b64, out.mime);
      return json({ path, cost_usd: out.cost_usd, model: out.model, skipped: out.skipped });
    }

    const { data: prof } = await sb.from("style_profile").select("appearance,templates").maybeSingle();
    const template = async (id: string) => {
      const { data: def } = await sb.from("app_settings").select("value").eq("key", `template:${id}`).maybeSingle();
      const path: string | null = prof?.templates?.[id] ?? def?.value?.path ?? null;
      return path ? await download(sb, path).catch(() => null) : null;
    };

    if (many) {
      // Every piece once: the anchor first, then the rest in the order the looks use them (max 14 + the template)
      const ids = [...new Set([many.anchor_id, ...many.looks.flatMap(l => l.item_ids)])].slice(0, 13); // Gemini takes at most 14 images: 13 pieces + the template
      const { data: rows } = await sb.from("items").select("id,category,kind,name,colors,photo_path").in("id", ids);
      const pieces = ids.map(id => ((rows ?? []) as Piece[]).find(p => p.id === id)).filter((p): p is Piece => !!p?.photo_path);
      if (!pieces.length || pieces[0].id !== many.anchor_id) throw new Error("The piece has no photo");
      const ref = await template("many");
      const images = await Promise.all(pieces.map(p => download(sb, p.photo_path!)));
      if (ref) images.push(ref);
      // Many small figures: OpenAI "medium" smeared faces and garment details; "high" cost only ~1c more there
      const out = await paint(sb, "looks-collage", buildManyPrompt(pieces, prof?.appearance ?? "", many, !!ref), images,
        { aspect: "2:3", size: "2K", openai: { quality: "high", size: "1024x1536" } });
      const path = `${user.id}/looks/${crypto.randomUUID()}.${extOf(out.mime)}`;
      await save(sb, path, out.b64, out.mime);
      if (request_id) await sb.rpc("set_request_collage", { req: request_id, path });
      return json({ path, cost_usd: out.cost_usd, model: out.model, skipped: out.skipped });
    }

    const { data: rows } = await sb.from("items").select("id,category,kind,name,colors,photo_path").in("id", item_ids.slice(0, 10));
    const pieces = ((rows ?? []) as Piece[]).filter(p => p.photo_path)
      .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)).slice(0, 8);
    if (!pieces.length) throw new Error("No pieces with photos in this outfit");
    const ref = await template("look");

    const images = await Promise.all(pieces.map(p => download(sb, p.photo_path!)));
    if (ref) images.push(ref);
    const out = await paint(sb, "look", buildPrompt(pieces, prof?.appearance ?? "", scene, vibe, palette.slice(0, 6), !!ref), images,
      { aspect: "2:3", size: "2K", openai: { quality: QUALITY, size: "1024x1536" } });
    const path = `${user.id}/looks/${crypto.randomUUID()}.${extOf(out.mime)}`;
    await save(sb, path, out.b64, out.mime);
    if (request_id && index != null) await sb.rpc("set_look_image", { req: request_id, n: index, path });
    return json({ path, cost_usd: out.cost_usd, model: out.model, skipped: out.skipped });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

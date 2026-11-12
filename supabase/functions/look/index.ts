// Look images with OpenAI gpt-image-2.6-sunburst (secret OPENAI_API_KEY).
// The instructions and the layout picture come from the image template for the purpose (table image_templates,
// _shared/templates.ts): the user's own version, else the default. This code only fills the {placeholders} and appends
// the technical part: which attached image is which and what each look is made of.
// Jobs:
// 1. {item_ids, scene, vibe, palette?, request_id?, index?}: template 'look', one outfit on her.
//    With request_id/index the path is also written into that ai_requests row (looks[index].image_path).
// 2. {many: {anchor_id, title, looks: [{label, item_ids}], palette}, request_id?}: template 'many', one collage with the
//    piece in the middle and the same woman in each look around it. Written to result.collage_path.
// 3. {clean_path, global?}: removes text, page numbers and app icons from a screenshot meant to be a template picture.
//    global: save it to photos/global/reference/ (the storage policy lets only admins write there).
// preview: true with job 1 or 2 returns {prompt} (the full text the model would get) without drawing anything.
// Writes to photos/<uid>/looks/ (or reference/) and returns the path.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { loadTemplate, fill, DEFAULT_APPEARANCE } from "../_shared/templates.ts";

const MODEL = "gpt-image-2.6-sunburst";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Piece = { id: string; category: string; kind: string | null; name: string | null; colors: string[]; photo_path: string | null };
type Many = { anchor_id: string; title: string; looks: { label: string; item_ids: string[] }[]; palette: string[] };

// Outer layers first, so the model reads the outfit from the outside in
const ORDER = ["outerwear", "dress", "top", "bottom", "swim", "shoes", "bag", "accessory"];

const pieceName = (p: Piece) => p.name ?? p.kind ?? p.category;

// The technical part after the user's instructions: the attached images in order
function imagesPart(pieces: Piece[], hasRef: boolean) {
  const list = pieces.map((p, n) => `- Image ${n + 1}: ${pieceName(p)} (${p.category}${p.kind ? `, ${p.kind}` : ""}; ${p.colors.join(", ")})`).join("\n");
  return `ATTACHED IMAGES
${list}
${hasRef ? `- Image ${pieces.length + 1}: the layout reference picture.` : "- No layout reference picture is attached: keep the layout calm and editorial."}
The image numbers are only for you: never draw numbers, file names or colour codes.`;
}

function lookPrompt(text: string, pieces: Piece[], appearance: string, scene: string, vibe: string, palette: string[], hasRef: boolean) {
  const has = (c: string) => pieces.some(p => p.category === c);
  const filled = fill(text, {
    vibe: vibe || "everyday",
    scene: scene || "A calm European city street in soft daylight, walking towards the camera.",
    palette: palette.length ? palette.join(", ") : "the main colours of the outfit",
    palette_count: palette.length ? String(palette.length) : "3–5",
    appearance: appearance || DEFAULT_APPEARANCE,
  });
  const notes = [
    `She wears exactly these pieces: images ${pieces.map((_, n) => n + 1).join(", ")}.`,
    has("shoes") ? "" : "She has no shoes in the list: give her simple, current shoes that suit the outfit and do not draw attention.",
    has("bag") ? "" : "No bag unless it is in the list.",
  ].filter(Boolean).map(l => `- ${l}`).join("\n");
  return `${filled}\n\n${imagesPart(pieces, hasRef)}\n\nTHE OUTFIT\n${notes}`;
}

function manyPrompt(text: string, pieces: Piece[], appearance: string, many: Many, hasRef: boolean) {
  const num = new Map(pieces.map((p, n) => [p.id, n + 1]));
  const filled = fill(text, {
    title: many.title.toUpperCase(),
    anchor: pieceName(pieces[0]),
    looks_count: String(many.looks.length),
    labels: many.looks.map(l => `"${l.label}"`).join(", "),
    palette: many.palette.length ? many.palette.join(", ") : "the main colours of the looks",
    palette_count: String(many.palette.length || 5),
    appearance: appearance || DEFAULT_APPEARANCE,
  });
  const looks = many.looks.map((l, k) =>
    `- Photo ${k + 1}, label "${l.label}": she wears images ${l.item_ids.map(id => num.get(id)).filter(Boolean).join(", ")}`).join("\n");
  return `${filled}\n\n${imagesPart(pieces, hasRef)}
Image 1 is the main piece.

THE LOOKS (every photo shows image 1 plus the listed pieces, and no other visible garments; simple shoes if none are listed)
${looks}`;
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

// Draws one picture, saves it as webp under `dir` and logs the cost. images: in the order the prompt numbers them.
async function paint(sb: SupabaseClient, kind: string, prompt: string, images: Blob[], quality: string, size: string, dir: string) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("quality", quality);
  form.append("size", size);
  form.append("output_format", "webp");
  form.append("output_compression", "90");
  images.forEach((img, n) => form.append("image[]", img, `image-${n + 1}.${img.type.split("/")[1] || "png"}`));
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` }, body: form,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${body.error?.message ?? "unknown"}`);
  const path = `${dir}/${crypto.randomUUID()}.webp`;
  const { error } = await sb.storage.from("photos").upload(path, decodeBase64(body.data[0].b64_json), { contentType: "image/webp" });
  if (error) throw error;
  const usage = costOf(body.usage ?? {});
  await sb.from("ai_usage").insert({ kind, model: MODEL, ...usage, raw: body.usage ?? null });
  return { path, cost_usd: usage.cost_usd, model: MODEL };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Please sign in again" }, 401);
    const body0 = await req.json() as {
      item_ids?: string[]; scene?: string; vibe?: string; palette?: string[]; request_id?: string; index?: number;
      clean_path?: string; global?: boolean; many?: Many; preview?: boolean;
    };
    const { item_ids = [], scene = "", vibe = "", palette = [], request_id, index, clean_path, global = false, many, preview = false } = body0;
    if (!preview && !Deno.env.get("OPENAI_API_KEY")) throw new Error("OpenAI key is not set up yet.");

    if (clean_path) {
      const out = await paint(sb, "reference", CLEAN, [await download(sb, clean_path)], "medium", "auto", `${global ? "global" : user.id}/reference`);
      return json(out);
    }

    const { data: prof } = await sb.from("style_profile").select("appearance").maybeSingle();
    const appearance = prof?.appearance ?? "";
    const refOf = async (path: string | null) => path ? await download(sb, path).catch(() => null) : null;

    if (many) {
      // Every piece once: the anchor first, then the rest in the order the looks use them (14 + the template)
      const ids = [...new Set([many.anchor_id, ...many.looks.flatMap(l => l.item_ids)])].slice(0, 14);
      const { data: rows } = await sb.from("items").select("id,category,kind,name,colors,photo_path").in("id", ids);
      const pieces = ids.map(id => ((rows ?? []) as Piece[]).find(p => p.id === id)).filter((p): p is Piece => !!p?.photo_path);
      if (!pieces.length || pieces[0].id !== many.anchor_id) throw new Error("The piece has no photo");
      const t = await loadTemplate(sb, "many");
      if (preview) return json({ prompt: manyPrompt(t.prompt, pieces, appearance, many, !!t.image_path) });
      const ref = await refOf(t.image_path);
      const images = await Promise.all(pieces.map(p => download(sb, p.photo_path!)));
      if (ref) images.push(ref);
      // Many small figures: "medium" smeared faces and garment details; "high" cost only ~1c more here
      const out = await paint(sb, "looks-collage", manyPrompt(t.prompt, pieces, appearance, many, !!ref), images, "high", "1024x1536", `${user.id}/looks`);
      if (request_id) await sb.rpc("set_request_collage", { req: request_id, path: out.path });
      return json(out);
    }

    const { data: rows } = await sb.from("items").select("id,category,kind,name,colors,photo_path").in("id", item_ids.slice(0, 10));
    const pieces = ((rows ?? []) as Piece[]).filter(p => p.photo_path)
      .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)).slice(0, 8);
    if (!pieces.length) throw new Error("No pieces with photos in this outfit");
    const t = await loadTemplate(sb, "look");
    if (preview) return json({ prompt: lookPrompt(t.prompt, pieces, appearance, scene, vibe, palette.slice(0, 6), !!t.image_path) });
    const ref = await refOf(t.image_path);
    const images = await Promise.all(pieces.map(p => download(sb, p.photo_path!)));
    if (ref) images.push(ref);
    const out = await paint(sb, "look", lookPrompt(t.prompt, pieces, appearance, scene, vibe, palette.slice(0, 6), !!ref), images, "medium", "1024x1536", `${user.id}/looks`);
    if (request_id && index != null) await sb.rpc("set_look_image", { req: request_id, n: index, path: out.path });
    return json(out);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

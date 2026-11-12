// Creates a photo of a single garment from a photo of a person (OpenAI gpt-image-2.6-sunburst, secret OPENAI_API_KEY).
// The instructions come from the 'garment' image template (table image_templates, _shared/templates.ts; {piece} is
// filled in); this code adds the technical part: which attached image is which, the set layout and her corrections.
// The result is a draft in storage: the item reaches the app only after approval.
// preview: true returns {prompt} without drawing anything.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { loadTemplate, fill } from "../_shared/templates.ts";

const MODEL = "gpt-image-2.6-sunburst";
const QUALITY = "medium"; // high = more detail, but roughly four times the cost and longer
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

function buildPrompt(text: string, piece: string, corrections: string[], refs: number, hasPrevious: boolean, set = false) {
  // Image order: original, then extra reference photos, then the previous attempt
  const lines = ["- Image 1 is the main photo, often of a person wearing the clothes."];
  if (refs) lines.push(`- Image${refs > 1 ? `s 2-${refs + 1} are` : " 2 is"} extra photo${refs > 1 ? "s" : ""} of the same garment from the owner (another angle, the back, a close-up, the true colour). Use them for details the main photo does not show.`);
  if (hasPrevious) lines.push(`- The last image (image ${refs + 2}) is your previous attempt: keep what is right in it and change only what the instructions ask for.`);
  const setPart = set ? `

THIS IS A MATCHING SET (a suit or co-ord); this overrides the single-garment wording above
- Create ONE image of all the pieces of the set: ${piece}
- Every piece appears once, laid out side by side (for example top on the left, bottom on the right), each one complete.
- Leave clear empty space between the pieces, at least 5% of the image width. No piece may touch, overlap or cast a shadow onto another: the image will be cut into one picture per piece.
- Only the set itself: no shoes, bags, belts or other accessories unless they are made of the same fabric as part of the set.
- All pieces are the same fabric: render them with exactly the same colour, shade and texture under the same light.` : "";
  const fixes = corrections.length
    ? `

INSTRUCTIONS FROM THE OWNER (all of them still apply, the last one is the newest)
${corrections.map(c => `- ${c}`).join("\n")}
Where an instruction conflicts with the rules above, follow the instruction.`
    : "";
  return `${fill(text, { piece })}

ATTACHED IMAGES
${lines.join("\n")}${setPart}${fixes}`;
}

async function download(sb: SupabaseClient, path: string) {
  const { data, error } = await sb.storage.from("photos").download(path);
  if (error || !data) throw new Error("Could not read the photo");
  return data;
}

async function callOpenAI(images: Blob[], prompt: string, background: "transparent" | "opaque") {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("quality", QUALITY);
  form.append("size", "auto");
  form.append("output_format", "png");
  form.append("background", background);
  images.forEach((img, i) => form.append("image[]", img, `image-${i}.${img.type.split("/")[1] || "png"}`));
  return await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: form,
  });
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
    const { source_path, ref_paths = [], previous_path, piece, corrections = [], set = false, preview = false } = await req.json() as {
      source_path: string; ref_paths?: string[]; previous_path?: string; set?: boolean; piece: string; corrections?: string[]; preview?: boolean;
    };
    const refs = ref_paths.slice(0, 8);
    const t = await loadTemplate(sb, "garment");
    const prompt = buildPrompt(t.prompt, piece, corrections, refs.length, !!previous_path, !!set);
    if (preview) return json({ prompt });
    if (!Deno.env.get("OPENAI_API_KEY")) throw new Error("OpenAI key is not set up yet.");
    const images = [await download(sb, source_path)];
    for (const r of refs) images.push(await download(sb, r));
    if (previous_path) images.push(await download(sb, previous_path));

    let r = await callOpenAI(images, prompt, "transparent");
    // If a transparent background is refused, use white; the app removes it
    if (r.status === 400 && (await r.clone().text()).includes("background")) r = await callOpenAI(images, prompt, "opaque");
    const body = await r.json();
    if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${body.error?.message ?? "unknown"}`);

    const path = `${user.id}/drafts/${crypto.randomUUID()}.png`;
    const { error } = await sb.storage.from("photos").upload(path, decodeBase64(body.data[0].b64_json), { contentType: "image/png" });
    if (error) throw error;
    const usage = costOf(body.usage ?? {});
    await sb.from("ai_usage").insert({ kind: "garment", model: MODEL, ...usage, raw: body.usage ?? null });
    return json({ path, ...usage, model: MODEL });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

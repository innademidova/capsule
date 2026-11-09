// Створює фото окремої речі зі знімка людини (OpenAI gpt-image-2.6-sunburst).
// Результат — чернетка у сховищі: у застосунку річ потрапляє лише після підтвердження.
// Ключ — у секретах Supabase (OPENAI_API_KEY).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = "gpt-image-2.6-sunburst";
const QUALITY = "medium"; // high — детальніше, але приблизно вчетверо дорожче і довше
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

function buildPrompt(piece: string, corrections: string[], hasPrevious: boolean) {
  const images = hasPrevious
    ? "The first image is the original photo. The second image is your previous attempt: keep what is right in it and change only what the corrections ask for."
    : "The image is a photo, often of a person wearing the clothes.";
  const fixes = corrections.length
    ? `\n\nCORRECTIONS FROM THE OWNER (all of them still apply, the last one is the newest)\n${corrections.map(c => `- ${c}`).join("\n")}\nWhere a correction conflicts with the accuracy rules below, follow the correction.`
    : "";
  return `${images}

Create ONE image of only this garment as a clean e-commerce product photo: ${piece}${fixes}

OUTPUT
- Transparent background. If transparency is not possible, use pure white #FFFFFF.
- Flat lay, viewed straight from above, garment centered, fully visible, nothing cropped, with small even margins.
- Garment laid out neatly in its natural shape: no body, mannequin, hanger, hands, hair or other clothes.
- Soft, even studio lighting, no harsh shadows, no props, no text, no watermark.

ACCURACY (most important)
- Reproduce the garment exactly as it appears in the photo. Do not redesign, "improve" or simplify it.
- Keep the exact colour and shade, fabric and texture (knit, linen, denim, satin and so on), pattern or print, and its scale.
- Keep every detail exactly: number, colour, shape and placement of buttons, zippers, pockets, seams, pleats, darts, collar and lapel shape, cuffs, belt, buckles, hardware, embroidery, logos.
- Keep the real proportions: length, sleeve length, fit (cropped, oversized, wide-leg and so on).
- Do not add anything that is not in the photo (labels, tags, extra buttons, linings, stitching).
- If part of the garment is hidden by arms, hair, a bag or another garment, complete it in the most plausible way consistent with the visible parts.`;
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

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Please sign in again" }, 401);
    if (!Deno.env.get("OPENAI_API_KEY")) throw new Error("OpenAI key is not set up yet.");
    const { source_path, previous_path, piece, corrections = [] } = await req.json() as {
      source_path: string; previous_path?: string; piece: string; corrections?: string[];
    };
    const images = [await download(sb, source_path)];
    if (previous_path) images.push(await download(sb, previous_path));
    const prompt = buildPrompt(piece, corrections, !!previous_path);

    let r = await callOpenAI(images, prompt, "transparent");
    // Якщо прозорий фон відмовить — білий, його прибере застосунок
    if (r.status === 400 && (await r.clone().text()).includes("background")) r = await callOpenAI(images, prompt, "opaque");
    const body = await r.json();
    if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${body.error?.message ?? "unknown"}`);

    const path = `${user.id}/drafts/${crypto.randomUUID()}.png`;
    const { error } = await sb.storage.from("photos").upload(path, decodeBase64(body.data[0].b64_json), { contentType: "image/png" });
    if (error) throw error;
    return json({ path });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// AI stylist Edge Function: every text task runs on OpenAI (OPENAI_API_KEY, model TAG_MODEL).
// Claude (ANTHROPIC_API_KEY) is kept as an option for when there is no OpenAI key; no Claude key is set.
// Handles one row from ai_requests: item tagging, outfit ideas, inspiration breakdown,
// style formulas, wardrobe check, before-you-buy. Writes the result to ai_requests.result,
// and a database trigger distributes it to the right tables.
// The key is a Supabase secret (ANTHROPIC_API_KEY, plus ANTHROPIC_WORKSPACE_ID if needed).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = "claude-opus-5-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const workspace = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
  defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
});

// ---------- Option lists (must match src/lib.ts) ----------

const CATEGORIES = ["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory", "swim"];
const COLORS = ["black", "white", "cream", "beige", "camel", "brown", "grey", "navy", "blue", "light-blue", "denim",
  "green", "olive", "red", "burgundy", "pink", "purple", "butter-yellow", "yellow", "orange", "silver", "gold", "print"];
const SEASONS = ["spring", "summer", "autumn", "winter"];
const STYLES = ["casual", "classic", "minimal", "elegant", "business", "sporty", "romantic", "edgy", "boho"];
const OCCASIONS = ["everyday", "work", "evening", "party", "date", "travel", "sport", "home"];

const str = { type: "string" };
const strs = { type: "array", items: str };
const enumArr = (e: string[]) => ({ type: "array", items: { type: "string", enum: e } });
const obj = (properties: Record<string, unknown>) =>
  ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

// Colors, styles and occasions can be edited on the admin page (table dict); the constants are the fallback
type Options = { colors: string[]; styles: string[]; occasions: string[] };
async function options(sb: SupabaseClient): Promise<Options> {
  // dict_effective = admin defaults + this user's own changes (the client carries the user's JWT)
  const { data } = await sb.from("dict_effective").select("type,id").in("type", ["color", "style", "occasion"]).order("sort");
  const of = (t: string, fallback: string[]) => { const v = (data ?? []).filter((r: { type: string }) => r.type === t).map((r: { id: string }) => r.id); return v.length ? v : fallback; };
  return { colors: of("color", COLORS), styles: of("style", STYLES), occasions: of("occasion", OCCASIONS) };
}
const tagSchema = (o: Options) => obj({
  category: { type: "string", enum: CATEGORIES }, kind: str, name: str,
  colors: enumArr(o.colors), seasons: enumArr(SEASONS), styles: enumArr(o.styles), occasions: enumArr(o.occasions),
  brand: str,
  materials: { type: "array", items: obj({ name: str, pct: { type: ["integer", "null"] } }) },
});

const SCHEMAS: Record<string, unknown> = {
  template_prompt: obj({ prompt: str }),
  tag: tagSchema({ colors: COLORS, styles: STYLES, occasions: OCCASIONS }),
  outfits: obj({
    outfits: { type: "array", items: obj({ title: str, item_ids: strs, why: str, tip: str }) },
    note: str,
  }),
  inspo: obj({
    summary: str, formula: str,
    pieces: { type: "array", items: obj({
      piece: str, category: { type: "string", enum: CATEGORIES },
      status: { type: "string", enum: ["have", "similar", "missing"] }, item_ids: strs, note: str,
    }) },
    to_buy: strs, tags: strs,
  }),
  formulas: obj({
    summary: str, formulas: { type: "array", items: obj({ title: str, recipe: str }) },
    palette: strs, key_pieces: strs,
  }),
  gaps: obj({
    summary: str,
    gaps: { type: "array", items: obj({ name: str, category: { type: "string", enum: CATEGORIES }, why: str, priority: { type: "integer" } }) },
    too_many: { type: "array", items: obj({ what: str, why: str }) },
    strengths: strs,
  }),
  // Fashion looks: around one item, or from a free request ("soft autumn looks for +15")
  looks: obj({
    title: str,
    palette: strs,
    looks: { type: "array", items: obj({ label: str, item_ids: strs, why: str, scene: str }) },
    missing: strs,
    note: str,
  }),
  buy: obj({
    verdict: { type: "string", enum: ["buy", "maybe", "skip"] }, summary: str,
    pairs_with: strs, similar: strs, outfit_ideas: strs,
  }),
};

// The account's interface language (profiles.language); the AI writes everything she reads in it.
// Stored values (kind, materials) and what the image model draws (look labels, titles, scenes) stay English.
const LANGUAGE: Record<string, string> = { uk: "Ukrainian", en: "English" };

const voice = (L: string) => `You are a warm, honest personal stylist for one woman. Her goal: dress stylishly with a small, well-combined
capsule wardrobe instead of buying more. All prose fields (summary, why, tip, note, recipe, formula, outfit_ideas, to_buy,
strengths, what) must be in ${L}${L === "Ukrainian" ? ", addressing her informally (second person singular)" : ""}, short and concrete. Never write Russian.
Short labels she reads (title, name, piece, tags, palette, key_pieces) are in ${L} too; kind is always lowercase English. When you refer to her items, use their ids exactly as given.`;

// ---------- The owner's data ----------

type Item = Record<string, unknown> & { id: string };

async function wardrobe(sb: SupabaseClient) {
  const { data: items } = await sb.from("items").select("id,category,kind,name,colors,seasons,styles,occasions,brand,materials,notes,set_id").eq("wishlist", false).order("created_at");
  const list = (items ?? []) as Item[];
  const text = list.map(i => [i.id, i.category, i.kind ?? "", i.name ?? "", (i.colors as string[]).join("/"),
    (i.seasons as string[]).join("/"), (i.styles as string[]).join("/"), (i.occasions as string[]).join("/"),
    i.brand ?? "", ((i.materials ?? []) as { name: string; pct: number | null }[]).map(m => m.pct != null ? `${m.pct}% ${m.name}` : m.name).join(" + "),
    i.notes ?? "", i.set_id ? `set ${String(i.set_id).slice(0, 8)}` : ""].join(" | ")).join("\n");
  return { list, text: `HER WARDROBE (${list.length} items; id | category | kind | name | colors | seasons | styles | occasions | brand | composition | notes | set; items with the same set code are one suit or co-ord, made in the same fabric: they can be worn together or split up):\n${text || "(empty)"}` };
}

async function imageBlock(sb: SupabaseClient, path: string): Promise<Anthropic.ImageBlockParam> {
  const { data, error } = await sb.storage.from("photos").download(path);
  if (error || !data) throw new Error("Could not read the photo");
  const type = data.type || (path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : "image/webp");
  return {
    type: "image",
    source: { type: "base64", media_type: type as "image/webp", data: encodeBase64(new Uint8Array(await data.arrayBuffer())) },
  };
}

// ---------- Tasks ----------

type Req = { id: string; kind: string; input: Record<string, unknown>; image_path: string | null };

async function buildPrompt(sb: SupabaseClient, r: Req, L: string): Promise<{ content: Anthropic.ContentBlockParam[]; effort: "low" | "medium" }> {
  const i = r.input;
  switch (r.kind) {
    case "template_prompt": {
      // A new template picture: rewrite the image-model instructions so they describe this picture's layout
      if (!r.image_path) throw new Error("No template picture");
      const current = String(i.current ?? ""), marks = ((i.placeholders as string[] | undefined) ?? []).map(p => `{${p}}`).join(", ");
      return { effort: "medium", content: [await imageBlock(sb, r.image_path), { type: "text", text:
        `This picture is the new layout template for an AI image model (${i.purpose === "many"
          ? "one collage: one clothing piece in the middle and several looks with it around it"
          : "a styling post: one woman wearing one outfit, plus the separate pieces"}). The model gets these instructions,
the product photos of her clothes and this picture, and must draw a new picture in the same format with HER clothes.

Write the instructions in English for this picture, as a plain text in the same structure as the current ones below:
- Describe the layout of THIS picture precisely: format and proportions, where each element is and how big, the background,
  frames or edges, fonts and every kind of text it has (or that it has none), the colour dots, the mood and light.
- Keep the data placeholders exactly as written, in braces, where the data belongs: ${marks}. Never invent names, colours or text instead of them.
- Keep the sections about the woman and the clothes and their accuracy rules unless the picture clearly contradicts them.
- Tell the model to copy only the layout and mood of the picture, never its clothes, person or colours.
- Do not describe which attached image is which: the app adds that part itself.

CURRENT INSTRUCTIONS (written for the previous picture)
${current}` }] };
    }
    case "tag": {
      if (!r.image_path) throw new Error("No photo to tag");
      // Original photos (and close-ups of labels) that the item image was made from
      const extra = ((i.extra_paths as string[] | undefined) ?? []).slice(0, 8);
      const images = [await imageBlock(sb, r.image_path)];
      for (const p of extra) images.push(await imageBlock(sb, p));
      const { data: mats } = await sb.from("dict_effective").select("label").eq("type", "material");
      const known = (mats ?? []).map((m: { label: string }) => m.label).join(", ");
      return { effort: "low", content: [...images, { type: "text", text:
        `Describe this clothing item for her digital wardrobe. kind: a short lowercase type like "sweater", "straight jeans",
"ankle boots". name: a short ${L} product-style name, like "Cream cable-knit sweater". Pick only fitting colors
(main colors first), seasons, styles and occasions. A body-hugging one-piece is a bodysuit (category "top"), not a swimsuit, unless she says the category is "swim".${i.category ? ` She says the category is "${i.category}".` : ""}
${extra.length ? `Image 1 is the item. The other ${extra.length} image(s) are the original photos it was made from; they may show a logo or a care label.\n` : ""}${i.notes ? `Her notes about this item: ${i.notes}\n` : ""}brand: only if she names it or a brand name is clearly readable on a logo or label in the images; otherwise "". Never guess a brand from the style.
materials: the composition only if she gives it or a care/composition label is clearly readable in the images, e.g. [{"name":"Cotton","pct":95},{"name":"Elastane","pct":5}]; pct is null when the label shows no percent. Otherwise []. Never guess the fabric from looks. Use these names when they fit: ${known}.` }] };
    }
    case "outfits": {
      const w = await wardrobe(sb);
      return { effort: "medium", content: [{ type: "text", text: `${w.text}

Suggest ${i.count ?? 3} different complete outfits ONLY from her items for this request:
occasion: ${i.occasion || "any"}; weather: ${i.weather || "not given"}; mood/wish: ${i.mood || "not given"}.
Each outfit: 2–6 item ids that really work together (top+bottom or dress, shoes; outerwear/bag/accessory when they help;
respect the weather). title: short ${L} name of the look. why: 1–2 sentences on why it works (colors, proportions).
tip: one styling trick (tuck, roll sleeves, belt…). If something important is
missing for this request, say so briefly in note (else empty string).` }] };
    }
    case "inspo": {
      const w = await wardrobe(sb);
      const { data: ins } = await sb.from("inspirations").select("image_path,note").eq("id", i.inspiration_id).single();
      if (!ins) throw new Error("Inspiration not found");
      return { effort: "medium", content: [await imageBlock(sb, ins.image_path), { type: "text", text: `${w.text}

This is a look she saved because she likes it${ins.note ? ` (her note: "${ins.note}")` : ""}. Break it down:
summary: what makes this look work (2–3 sentences). formula: the reusable recipe in one line (e.g. "light knit +
straight dark denim + loafers + structured bag", written in ${L}). pieces: every visible piece; status "have" if she owns essentially the same
item, "similar" if she owns something that can replace it (say how in note), "missing" if not; item_ids = her matching items.
to_buy: only the missing pieces that would unlock the most outfits for her. tags: 2–5 ${L} style tags.` }] };
    }
    case "formulas": {
      const { data: ins } = await sb.from("inspirations").select("note,analysis").not("analysis", "is", null);
      const looks = (ins ?? []).map((x: { note: string | null; analysis: Record<string, unknown> }, n: number) =>
        `${n + 1}. ${x.analysis.formula} | ${(x.analysis.tags as string[] ?? []).join(", ")} | ${x.analysis.summary}${x.note ? ` | her note: ${x.note}` : ""}`).join("\n");
      if (!looks) throw new Error("Analyze a few inspiration looks first");
      return { effort: "medium", content: [{ type: "text", text: `Breakdowns of the looks she saved:\n${looks}

Find HER recurring style patterns across these looks. summary: 2–3 short paragraphs about her style DNA. formulas: 3–6
reusable outfit formulas (title and recipe in ${L}). palette: her recurring colors (${L}). key_pieces:
the pieces that appear again and again (${L}).` }] };
    }
    case "gaps": {
      const w = await wardrobe(sb);
      const { data: prof } = await sb.from("style_profile").select("summary,formulas").maybeSingle();
      return { effort: "medium", content: [{ type: "text", text: `${w.text}
${prof ? `\nHER STYLE PROFILE: ${prof.summary}\nFormulas: ${JSON.stringify(prof.formulas)}` : ""}

Analyze her wardrobe as a capsule. summary: 2–3 sentences, honest. gaps: missing basics or pieces that would create the
most new outfits (priority 1 = must-have, 2 = good to have, 3 = someday), name in ${L}. too_many: categories/colors
she has more than she needs (empty array if none). strengths: what already works well.` }] };
    }
    case "looks": {
      const w = await wardrobe(sb);
      const { data: prof } = await sb.from("style_profile").select("summary,appearance").maybeSingle();
      const count = Math.min(6, Math.max(1, Number(i.count) || 4));
      const blocks: Anthropic.ContentBlockParam[] = [];
      let anchor = "";
      if (i.item_id) {
        const { data: it } = await sb.from("items").select("id,category,kind,name,colors,styles,photo_path,wishlist").eq("id", i.item_id).single();
        if (!it) throw new Error("Item not found");
        if (it.photo_path) blocks.push(await imageBlock(sb, it.photo_path));
        anchor = `THE ITEM (shown in the image): id ${it.id} | ${it.category} | ${it.kind ?? ""} | ${it.name ?? ""} | ${(it.colors as string[]).join("/")}${it.wishlist ? " | she does not own it yet, she is thinking of buying it" : ""}`;
      }
      const task = i.item_id
        ? `Create ${count} different fashionable looks that ALL include THE ITEM (put its id in every look), each one for a different vibe, e.g. casual day, city chic, office style, cozy vibes, feminine touch, evening out.${i.request ? ` Her wish: ${i.request}.` : ""}`
        : `Create ${count} different fashionable looks for her request: "${i.request || "any"}".`;
      blocks.push({ type: "text", text: `${w.text}
${prof?.summary ? `\nHER STYLE PROFILE: ${prof.summary}` : ""}${prof?.appearance ? `\nHER APPEARANCE: ${prof.appearance}` : ""}
${anchor ? `\n${anchor}\n` : ""}
${task}${i.weather ? ` Weather: ${i.weather}.` : ""}

Think like a fashion editor making an Instagram carousel: current, polished, wearable street style, not a catalogue.
Rules for each look:
- item_ids: 2–7 of her item ids that truly work together: a top + bottom or a dress, then outerwear, bag, belt or other accessories when they lift the look. Respect the season and weather. Use only ids from the lists above.
- No two looks may be the same combination; vary silhouettes, layers and colour stories.
- label: 1–3 lowercase English words naming the vibe (it is drawn on the picture, so always English), e.g. "city chic".
- why: one short sentence in ${L} on why it works (colours, proportions, the styling trick).
- scene: one English sentence for a photographer: the place, light and pose that suit the vibe and season, e.g. "a cobbled old-town street in soft autumn daylight, walking towards the camera with a coffee". Do not describe the clothes.
title: a short English headline for the whole set (drawn on the picture, so always English), e.g. "one sweater, many looks" or "soft autumn layers".
palette: 3–6 hex colours that sum up the looks, main colour first.
missing: up to 3 short ${L} names of pieces she does not have that would make these looks better (e.g. "white leather sneakers"), [] if nothing. Shoes count: she may have few in the app.
note: one short sentence in ${L} if something important is missing for this request, else "".` });
      return { effort: "medium", content: blocks };
    }
    case "buy": {
      if (!r.image_path) throw new Error("No photo of the item");
      const w = await wardrobe(sb);
      return { effort: "medium", content: [await imageBlock(sb, r.image_path), { type: "text", text: `${w.text}

She is thinking of buying the item in this photo${i.note ? ` (her note: "${i.note}")` : ""}${i.price ? `, price ${i.price}` : ""}.
Be honest: does it fit her wardrobe? pairs_with: ids of her items it combines well with. similar: ids of items she already has
that do the same job. outfit_ideas: 2–3 concrete outfits with it from her items (${L}). verdict: "buy" if it creates
many new outfits and fills a gap, "skip" if it duplicates what she has or combines with little, otherwise "maybe".
summary: 2–3 sentences with the main reason.` }] };
    }
  }
  throw new Error("Unknown request kind");
}

const TAG_MODEL = "gpt-6.1-terra"; // every text task

// USD per 1M tokens for TAG_MODEL, standard tier (developers.openai.com/api/docs/pricing, 2026-11-10)
const TAG_PRICE = { input: 1, cached: 0.05, cache_write: 1.25, output: 5 };

async function withOpenAI(sb: SupabaseClient, kind: string, schema: unknown, content: unknown, meta: Meta, L: string) {
  const blocks = content as ({ type: "text"; text: string } | Anthropic.ImageBlockParam)[];
  const input = blocks.map(b => b.type === "text"
    ? { type: "input_text", text: b.text }
    : { type: "input_image", image_url: `data:${(b.source as Anthropic.Base64ImageSource).media_type};base64,${(b.source as Anthropic.Base64ImageSource).data}` });
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TAG_MODEL,
      input: [{ role: "system", content: voice(L) }, { role: "user", content: input }],
      text: { format: { type: "json_schema", name: kind, schema, strict: true } },
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${body.error?.message ?? "unknown"}`);
  if (body.status === "incomplete") throw new Error("The answer was too long, try again");
  const parts = (body.output ?? []).flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? []);
  if (parts.some((p: { type: string }) => p.type === "refusal")) throw new Error("The AI declined this request");
  const u = body.usage ?? {};
  const cached_in = u.input_tokens_details?.cached_tokens ?? 0, output = u.output_tokens ?? 0;
  // input_tokens includes cache reads and cache writes; writes are billed above the normal input rate
  const writes = u.input_tokens_details?.cache_write_tokens ?? 0;
  const text_in = (u.input_tokens ?? 0) - cached_in;
  const cost_usd = ((text_in - writes) * TAG_PRICE.input + writes * TAG_PRICE.cache_write + cached_in * TAG_PRICE.cached + output * TAG_PRICE.output) / 1e6;
  await sb.from("ai_usage").insert({ kind, model: TAG_MODEL, text_in, cached_in, output, cost_usd, raw: body.usage ?? null });
  meta.cost_usd = cost_usd;
  return JSON.parse(parts.filter((p: { type: string }) => p.type === "output_text").map((p: { text: string }) => p.text).join(""));
}

// Per-request extras for the response: the cost and which model answered
type Meta = { cost_usd: number | null; model: string | null; skipped: string[] };

async function run(sb: SupabaseClient, r: Req, meta: Meta) {
  const { data: prof } = await sb.from("profiles").select("language").maybeSingle();
  const L = LANGUAGE[prof?.language ?? ""] ?? "Ukrainian";
  const { content, effort } = await buildPrompt(sb, r, L);
  const schema = r.kind === "tag" ? tagSchema(await options(sb)) : SCHEMAS[r.kind];
  if (Deno.env.get("OPENAI_API_KEY")) {
    const out = await withOpenAI(sb, r.kind, schema, content, meta, L);
    meta.model = TAG_MODEL; return out;
  }
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("AI key is not set up yet.");
  meta.model = "Claude";
  const res = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: voice(L),
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  } as never) as Anthropic.Beta.BetaMessage;
  if (res.stop_reason === "refusal") throw new Error("The AI declined this request");
  if (res.stop_reason === "max_tokens") throw new Error("The answer was too long, try again");
  const text = res.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("");
  return JSON.parse(text);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  let id = "";
  const meta: Meta = { cost_usd: null, model: null, skipped: [] };
  try {
    ({ id } = await req.json());
    const { data: r, error } = await sb.from("ai_requests").select("id,kind,input,image_path").eq("id", id).single();
    if (error || !r) return json({ error: "Request not found" }, 404);
    const result = await run(sb, r as Req, meta);
    await sb.from("ai_requests").update({ status: "done", mode: "now", result, model: meta.model }).eq("id", id);
    return json({ result, cost_usd: meta.cost_usd, model: meta.model, skipped: meta.skipped });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `AI error ${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e);
    if (id) await sb.from("ai_requests").update({ status: "error", error: msg }).eq("id", id);
    return json({ error: msg }, 400);
  }
});

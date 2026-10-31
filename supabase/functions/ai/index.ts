// Серверна функція ІІ-стиліста (Claude Opus 5.5 через API).
// Обробляє один запит з таблиці ai_requests: розмітка речі, підбір образів, розбір натхнення,
// стильові формули, аналіз гардероба, «перед покупкою». Результат пише в ai_requests.result,
// а тригер у базі сам розкладає його по таблицях.
// Ключ — у секретах Supabase (ANTHROPIC_API_KEY, за потреби ANTHROPIC_WORKSPACE_ID).
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

// ---------- Довідники (мають збігатися з src/lib.ts) ----------

const CATEGORIES = ["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory"];
const COLORS = ["black", "white", "cream", "beige", "camel", "brown", "grey", "navy", "blue", "light-blue", "denim",
  "green", "olive", "red", "burgundy", "pink", "purple", "yellow", "orange", "silver", "gold", "print"];
const SEASONS = ["spring", "summer", "autumn", "winter"];
const STYLES = ["casual", "classic", "minimal", "elegant", "business", "sporty", "romantic", "edgy", "boho"];
const OCCASIONS = ["everyday", "work", "evening", "party", "date", "travel", "sport", "home"];

const str = { type: "string" };
const strs = { type: "array", items: str };
const enumArr = (e: string[]) => ({ type: "array", items: { type: "string", enum: e } });
const obj = (properties: Record<string, unknown>) =>
  ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const TAG = obj({
  category: { type: "string", enum: CATEGORIES }, kind: str, name: str,
  colors: enumArr(COLORS), seasons: enumArr(SEASONS), styles: enumArr(STYLES), occasions: enumArr(OCCASIONS),
});

const SCHEMAS: Record<string, unknown> = {
  tag: TAG,
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
  buy: obj({
    verdict: { type: "string", enum: ["buy", "maybe", "skip"] }, summary: str,
    pairs_with: strs, similar: strs, outfit_ideas: strs,
  }),
};

const VOICE = `You are a warm, honest personal stylist for one woman. Her goal: dress stylishly with a small, well-combined
capsule wardrobe instead of buying more. All prose fields (summary, why, tip, note, recipe, formula, outfit_ideas, to_buy,
strengths, what) must be in Ukrainian, addressing her as "ти", short and concrete. Never write Russian.
Short labels (title, name, piece, kind, tags, palette, key_pieces) are in English. When you refer to her items, use their ids exactly as given.`;

// ---------- Дані користувачки ----------

type Item = Record<string, unknown> & { id: string };

async function wardrobe(sb: SupabaseClient) {
  const [{ data: items }, { data: wear }] = await Promise.all([
    sb.from("items").select("id,category,kind,name,colors,seasons,styles,occasions,brand,notes").order("created_at"),
    sb.from("wear_log").select("item_ids"),
  ]);
  const worn = new Map<string, number>();
  (wear ?? []).forEach((w: { item_ids: string[] }) => w.item_ids.forEach(id => worn.set(id, (worn.get(id) ?? 0) + 1)));
  const list = (items ?? []) as Item[];
  const text = list.map(i => [i.id, i.category, i.kind ?? "", i.name ?? "", (i.colors as string[]).join("/"),
    (i.seasons as string[]).join("/"), (i.styles as string[]).join("/"), (i.occasions as string[]).join("/"),
    i.brand ?? "", i.notes ?? "", `worn ${worn.get(i.id) ?? 0}x`].join(" | ")).join("\n");
  return { list, text: `HER WARDROBE (${list.length} items; id | category | kind | name | colors | seasons | styles | occasions | brand | notes | wear count):\n${text || "(empty)"}` };
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

// ---------- Завдання ----------

type Req = { id: string; kind: string; input: Record<string, unknown>; image_path: string | null };

async function buildPrompt(sb: SupabaseClient, r: Req): Promise<{ content: Anthropic.ContentBlockParam[]; effort: "low" | "medium" }> {
  const i = r.input;
  switch (r.kind) {
    case "tag": {
      if (!r.image_path) throw new Error("No photo to tag");
      return { effort: "low", content: [await imageBlock(sb, r.image_path), { type: "text", text:
        `Describe this clothing item for her digital wardrobe. kind: a short lowercase type like "sweater", "straight jeans",
"ankle boots". name: a short English product-style name, e.g. "Cream cable-knit sweater". Pick only fitting colors
(main colors first), seasons, styles and occasions.${i.category ? ` She says the category is "${i.category}".` : ""}` }] };
    }
    case "outfits": {
      const w = await wardrobe(sb);
      return { effort: "medium", content: [{ type: "text", text: `${w.text}

Suggest ${i.count ?? 3} different complete outfits ONLY from her items for this request:
occasion: ${i.occasion || "any"}; weather: ${i.weather || "not given"}; mood/wish: ${i.mood || "not given"}.
Each outfit: 2–6 item ids that really work together (top+bottom or dress, shoes; outerwear/bag/accessory when they help;
respect the weather). title: short English name of the look. why: 1–2 sentences on why it works (colors, proportions).
tip: one styling trick (tuck, roll sleeves, belt…). Prefer items she wears rarely when they fit. If something important is
missing for this request, say so briefly in note (else empty string).` }] };
    }
    case "inspo": {
      const w = await wardrobe(sb);
      const { data: ins } = await sb.from("inspirations").select("image_path,note").eq("id", i.inspiration_id).single();
      if (!ins) throw new Error("Inspiration not found");
      return { effort: "medium", content: [await imageBlock(sb, ins.image_path), { type: "text", text: `${w.text}

This is a look she saved because she likes it${ins.note ? ` (her note: "${ins.note}")` : ""}. Break it down:
summary: what makes this look work (2–3 sentences). formula: the reusable recipe in one line (e.g. "світлий трикотаж +
пряма темна деніма + лофери + структурна сумка"). pieces: every visible piece; status "have" if she owns essentially the same
item, "similar" if she owns something that can replace it (say how in note), "missing" if not; item_ids = her matching items.
to_buy: only the missing pieces that would unlock the most outfits for her. tags: 2–5 English style tags.` }] };
    }
    case "formulas": {
      const { data: ins } = await sb.from("inspirations").select("note,analysis").not("analysis", "is", null);
      const looks = (ins ?? []).map((x: { note: string | null; analysis: Record<string, unknown> }, n: number) =>
        `${n + 1}. ${x.analysis.formula} | ${(x.analysis.tags as string[] ?? []).join(", ")} | ${x.analysis.summary}${x.note ? ` | her note: ${x.note}` : ""}`).join("\n");
      if (!looks) throw new Error("Analyze a few inspiration looks first");
      return { effort: "medium", content: [{ type: "text", text: `Breakdowns of the looks she saved:\n${looks}

Find HER recurring style patterns across these looks. summary: 2–3 short paragraphs about her style DNA. formulas: 3–6
reusable outfit formulas (title in English, recipe in Ukrainian). palette: her recurring colors (English). key_pieces:
the pieces that appear again and again (English).` }] };
    }
    case "gaps": {
      const w = await wardrobe(sb);
      const { data: prof } = await sb.from("style_profile").select("summary,formulas").maybeSingle();
      return { effort: "medium", content: [{ type: "text", text: `${w.text}
${prof ? `\nHER STYLE PROFILE: ${prof.summary}\nFormulas: ${JSON.stringify(prof.formulas)}` : ""}

Analyze her wardrobe as a capsule. summary: 2–3 sentences, honest. gaps: missing basics or pieces that would create the
most new outfits (priority 1 = must-have, 2 = good to have, 3 = someday), name in English. too_many: categories/colors
she has more than she needs (empty array if none). strengths: what already works well.` }] };
    }
    case "buy": {
      if (!r.image_path) throw new Error("No photo of the item");
      const w = await wardrobe(sb);
      return { effort: "medium", content: [await imageBlock(sb, r.image_path), { type: "text", text: `${w.text}

She is thinking of buying the item in this photo${i.note ? ` (her note: "${i.note}")` : ""}${i.price ? `, price ${i.price}` : ""}.
Be honest: does it fit her wardrobe? pairs_with: ids of her items it combines well with. similar: ids of items she already has
that do the same job. outfit_ideas: 2–3 concrete outfits with it from her items (Ukrainian). verdict: "buy" if it creates
many new outfits and fills a gap, "skip" if it duplicates what she has or combines with little, otherwise "maybe".
summary: 2–3 sentences with the main reason.` }] };
    }
  }
  throw new Error("Unknown request kind");
}

async function run(sb: SupabaseClient, r: Req) {
  const { content, effort } = await buildPrompt(sb, r);
  const res = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: VOICE,
    output_config: { effort, format: { type: "json_schema", schema: SCHEMAS[r.kind] } },
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
  try {
    ({ id } = await req.json());
    const { data: r, error } = await sb.from("ai_requests").select("id,kind,input,image_path").eq("id", id).single();
    if (error || !r) return json({ error: "Request not found" }, 404);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("AI key is not set up yet. Use “Add to queue” for now.");
    const result = await run(sb, r as Req);
    await sb.from("ai_requests").update({ status: "done", mode: "now", result }).eq("id", id);
    return json({ result });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `AI error ${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e);
    if (id) await sb.from("ai_requests").update({ status: "error", error: msg }).eq("id", id);
    return json({ error: msg }, 400);
  }
});

// The assistant: a chat with her stylist that knows the screen she is on, reads her data and acts in the app.
// OpenAI Responses API with function tools (model MODEL, secret OPENAI_API_KEY). It runs with her JWT, so RLS keeps
// every read and write to her own rows. There are no delete tools, and paid pictures are never drawn here: a proposed
// look comes back as a card, and the app draws it only when she taps "Show on me".
// Body: {thread_id, message, context: {screen, item_id?, outfit_id?, inspiration_id?, entry_id?}}
// Answer: {reply, cards, actions, changed, cost_usd}. Both messages are stored in agent_messages.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = "gpt-6.1-terra";
// USD per 1M tokens, standard tier (developers.openai.com/api/docs/pricing, 2026-11-10)
const PRICE = { input: 1, cached: 0.05, cache_write: 1.25, output: 5 };
const MAX_ROUNDS = 6;
const HISTORY = 16;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const CATEGORIES = ["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory", "swim", "sleep"];
const SEASONS = ["spring", "summer", "autumn", "winter"];
const LANGUAGE: Record<string, string> = { uk: "Ukrainian", en: "English" };

const str = { type: "string" };
const strs = { type: "array", items: str };
const orNull = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
const obj = (properties: Record<string, unknown>) =>
  ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const fn = (name: string, description: string, properties: Record<string, unknown>) =>
  ({ type: "function", name, description, strict: true, parameters: obj(properties) });

const TOOLS = [
  fn("get_item", "Full details of one of her items or wishlist pieces: all fields, notes, how many saved looks and outfits use it.", { id: str }),
  fn("list_outfits", "Her saved outfits: id, name, occasions, item ids, source (manual collage, ai, or her own photo of what she wore), whether it did not work and her notes.", {}),
  fn("list_inspirations", "Her saved inspiration looks: id, note, linked item ids, short breakdown if any.", {}),
  fn("propose_look", "Show her ONE outfit as a card in the chat (the pieces, a Save button and a Show on me button that draws her wearing it for about 9 cents). Call it once per look; up to 4 looks per answer.", {
    label: { ...str, description: "1-3 lowercase English words naming the vibe, e.g. city chic" },
    item_ids: { ...strs, description: "2-7 ids of her items (wardrobe, or wishlist when it is about that piece)" },
    why: { ...str, description: "one short sentence in her language" },
    scene: { ...str, description: "one English sentence for a photographer: place, light, pose; no clothes" },
  }),
  fn("set_need", "Mark how much she needs wishlist pieces: 1 = must have, 2 = good to have, 3 = someday/optional, null = clear the mark.", {
    items: { type: "array", items: obj({ id: str, need: orNull({ type: "integer", enum: [1, 2, 3] }), why: str }) },
  }),
  fn("update_item", "Change fields of one item. Pass null for every field that stays as it is.", {
    id: str,
    name: orNull(str),
    notes: orNull({ ...str, description: "the full new description, in English like her other notes" }),
    styles: orNull(strs), occasions: orNull(strs),
    seasons: orNull({ type: "array", items: { type: "string", enum: SEASONS } }),
  }),
  fn("add_looking_for", "Add an entry to her Looking for list (things to find, with or without a shop).", {
    name: { ...str, description: "in her language" },
    category: orNull({ type: "string", enum: CATEGORIES }),
    why: orNull(str),
    priority: { type: "integer", enum: [1, 2, 3], description: "1 must have, 2 good to have, 3 someday" },
    occasions: strs,
  }),
  fn("link_candidates", "Attach wishlist pieces to a Looking for entry as options that could close it.", { entry_id: str, item_ids: strs }),
  fn("add_note", "Save a rule or an insight to her notes (Shop tab).", {
    kind: { type: "string", enum: ["rule", "insight"] }, title: str, body: str,
  }),
  fn("link_look", "Link items to one of her saved inspiration looks (the look then shows them, the item shows the look).", { inspiration_id: str, item_ids: strs }),
];

type Row = Record<string, unknown> & { id: string };
type Card = { label: string; item_ids: string[]; why: string; scene: string };
type Action = { tool: string; text: string };

const line = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const short = (v: unknown, n: number) => { const s = line(v); return s.length > n ? s.slice(0, n) + "…" : s; };

// Everything she has, compact: the model sees the lists in every turn (OpenAI caches the long same prefix)
async function snapshot(sb: SupabaseClient) {
  const [items, notes, shopping, insp, prof, profile, misses] = await Promise.all([
    sb.from("items").select("id,wishlist,category,kind,name,colors,seasons,styles,occasions,brand,need,notes,set_id").order("created_at"),
    sb.from("notes").select("kind,title,body,pinned").order("pinned", { ascending: false }).order("created_at"),
    sb.from("shopping").select("id,name,category,why,priority,occasions,item_ids").eq("done", false).order("priority").order("created_at"),
    sb.from("inspirations").select("item_ids"),
    sb.from("style_profile").select("summary,appearance").maybeSingle(),
    sb.from("profiles").select("language").maybeSingle(),
    sb.from("outfits").select("name,notes,layout,worn_on").eq("source", "worn").eq("miss", true).order("created_at"),
  ]);
  const all = (items.data ?? []) as Row[];
  const looks = (id: string) => (insp.data ?? []).filter((x: { item_ids: string[] | null }) => (x.item_ids ?? []).includes(id)).length;
  const row = (i: Row) => [i.id, i.category, i.kind ?? "", i.name ?? "", (i.colors as string[]).join("/"), (i.seasons as string[]).join("/"),
    (i.styles as string[]).join("/"), (i.occasions as string[]).join("/"), i.brand ?? "",
    i.wishlist ? `need ${i.need ?? "-"}, looks ${looks(i.id)}` : (i.set_id ? `set ${String(i.set_id).slice(0, 8)}` : ""),
    short(i.notes, 160)].join(" | ");
  const own = all.filter(i => !i.wishlist), wish = all.filter(i => i.wishlist);
  const rules = (notes.data ?? []).filter((n: { kind: string }) => n.kind === "rule");
  const insights = (notes.data ?? []).filter((n: { kind: string }) => n.kind === "insight");
  const text = `HER WARDROBE (${own.length}; id | category | kind | name | colors | seasons | styles | occasions | brand | set | notes):
${own.map(row).join("\n") || "(empty)"}

HER WISHLIST (${wish.length} pieces she does not own yet; ... | need: 1 must have, 2 good to have, 3 someday, - not rated; looks = saved inspiration looks that need it | notes with price):
${wish.map(row).join("\n") || "(empty)"}

HER RULES (strict, from experience):
${rules.map((n: { title: string; body: string }) => `- ${line(n.title)}${n.body ? `: ${short(n.body, 400)}` : ""}`).join("\n") || "(none)"}

HER INSIGHTS:
${insights.map((n: { title: string; body: string }) => `- ${line(n.title)}${n.body ? `: ${short(n.body, 300)}` : ""}`).join("\n") || "(none)"}

HER OWN OUTFITS THAT DID NOT WORK (photos of what she wore; her notes say what to avoid):
${(misses.data ?? []).map((o: Record<string, unknown>) => `- ${line(o.name) || "outfit"}${o.worn_on ? ` (${o.worn_on})` : ""}: ${short(o.notes, 300) || "no notes"} | items ${(o.layout as { item_id: string }[]).map(l => l.item_id).join(", ")}`).join("\n") || "(none)"}

HER LOOKING FOR LIST (id | name | category | priority | details | candidate item ids):
${(shopping.data ?? []).map((s: Row) => [s.id, s.name, s.category ?? "", s.priority, short(s.why, 160), ((s.item_ids ?? []) as string[]).join(",")].join(" | ")).join("\n") || "(empty)"}
${prof.data?.summary ? `\nHER STYLE PROFILE: ${line(prof.data.summary)}` : ""}${prof.data?.appearance ? `\nHER APPEARANCE: ${line(prof.data.appearance)}` : ""}`;
  return { text, all, L: LANGUAGE[profile.data?.language ?? ""] ?? "Ukrainian" };
}

// What she is looking at, so "these trousers" or "this look" make sense
async function screenText(sb: SupabaseClient, ctx: Record<string, string | undefined>, all: Row[]) {
  const parts = [`screen: ${ctx.screen ?? "unknown"}`];
  if (ctx.item_id) {
    const it = all.find(i => i.id === ctx.item_id);
    if (it) parts.push(`she has this ${it.wishlist ? "wishlist piece" : "item"} open: id ${it.id} | ${it.name ?? it.kind ?? it.category} (its photo is attached)`);
  }
  if (ctx.outfit_id) {
    const { data: o } = await sb.from("outfits").select("id,name,layout,notes").eq("id", ctx.outfit_id).maybeSingle();
    if (o) parts.push(`she has this outfit open: id ${o.id} | ${o.name ?? "outfit"} | items ${(o.layout as { item_id: string }[]).map(l => l.item_id).join(", ")}`);
  }
  if (ctx.inspiration_id) {
    const { data: x } = await sb.from("inspirations").select("id,note,item_ids").eq("id", ctx.inspiration_id).maybeSingle();
    if (x) parts.push(`she has this saved inspiration look open: id ${x.id}${x.note ? ` | note: ${line(x.note)}` : ""} | linked items ${(x.item_ids ?? []).join(", ") || "none"} (its picture is attached)`);
  }
  if (ctx.entry_id) {
    const { data: e } = await sb.from("shopping").select("id,name,why").eq("id", ctx.entry_id).maybeSingle();
    if (e) parts.push(`she has this Looking for entry open: id ${e.id} | ${e.name}${e.why ? ` | ${line(e.why)}` : ""}`);
  }
  return parts.join("\n");
}

async function imageInput(sb: SupabaseClient, path: string | null | undefined) {
  if (!path) return null;
  const { data } = await sb.storage.from("photos").download(path);
  if (!data) return null;
  const type = data.type || (path.endsWith(".png") ? "image/png" : path.endsWith(".jpg") ? "image/jpeg" : "image/webp");
  return { type: "input_image", image_url: `data:${type};base64,${encodeBase64(new Uint8Array(await data.arrayBuffer()))}` };
}

const voice = (L: string) => `You are the assistant inside Capsule, her personal wardrobe app: a warm, honest stylist and helper for one woman.
Her goal: dress stylishly with a small, well-combined capsule wardrobe instead of buying more; her style leans elegant.
Write in ${L}${L === "Ukrainian" ? ", addressing her informally (second person singular)" : ""}. Never write Russian, even if she does.
Be short and concrete. Plain text: short paragraphs or "- " lists, no headings, tables or bold.

She can ask anything: advice, analysis, or actions in the app. Act with the tools; never say you did something without the tool call.
- Looks: when she asks for a look, an outfit idea or to "generate/draw" one, call propose_look (one call per look). The app shows the
  pieces with Save and "Show on me" (draws her wearing it, about 9 cents, only when she taps). You never draw pictures yourself.
  Use her wardrobe; use wishlist pieces only when the look is about that piece or she asks, and say which pieces she does not own yet.
  Respect the season, her style and her rules. Mention missing pieces (shoes are often missing in the app) in words.
- Changes (marking wishlist pieces, editing an item's name or description, adding to Looking for, linking pieces or looks, saving
  a rule or an insight): do them with the tools when she asks, then say in one line what changed. Do not change things she did not ask for.
- To rate the wishlist, read the lists, then call set_need for every piece at once: be strict, about a third at most are must-haves,
  and of several pieces doing the same job only one can be a must-have.
- You cannot delete anything, buy anything, open shop links or change how the app works; say so briefly when asked.
- Her rules are strict: never suggest or approve anything that breaks one, and name the rule when it matters.
- Her outfits that did not work are lessons: do not repeat what her notes there warn about.
- Use ids exactly as given; never show ids to her, call pieces by their names.`;

async function runTool(sb: SupabaseClient, name: string, a: Record<string, unknown>, all: Row[], cards: Card[], actions: Action[]) {
  const known = (ids: unknown) => ((ids ?? []) as string[]).filter(id => all.some(i => i.id === id));
  const title = (id: string) => { const i = all.find(x => x.id === id); return String(i?.name ?? i?.kind ?? "item"); };
  switch (name) {
    case "get_item": {
      const { data } = await sb.from("items").select("*").eq("id", String(a.id)).maybeSingle();
      if (!data) return { error: "not found" };
      const { data: insp } = await sb.from("inspirations").select("id").contains("item_ids", [data.id]);
      const { data: outs } = await sb.from("outfits").select("id,layout");
      const { photo_path: _p, thumb_path: _t, more_photos: _m, user_id: _u, ...rest } = data;
      return { ...rest, saved_looks: insp?.length ?? 0,
        outfits: (outs ?? []).filter((o: { layout: { item_id: string }[] }) => o.layout.some(l => l.item_id === data.id)).length };
    }
    case "list_outfits": {
      const { data } = await sb.from("outfits").select("id,name,occasions,seasons,layout,source,notes,miss,worn_on").order("created_at");
      return (data ?? []).map((o: Row) => ({ id: o.id, name: o.name, occasions: o.occasions,
        source: o.source === "worn" ? "her own photo" : o.source, did_not_work: o.miss, worn_on: o.worn_on,
        item_ids: (o.layout as { item_id: string }[]).map(l => l.item_id), notes: short(o.notes, o.miss ? 400 : 120) }));
    }
    case "list_inspirations": {
      const { data } = await sb.from("inspirations").select("id,note,item_ids,analysis,created_at").order("created_at");
      return (data ?? []).map((x: Row) => ({ id: x.id, note: x.note, item_ids: x.item_ids,
        breakdown: x.analysis ? short((x.analysis as { formula?: string; summary?: string }).formula ?? (x.analysis as { summary?: string }).summary, 200) : null }));
    }
    case "propose_look": {
      const ids = known(a.item_ids);
      if (ids.length < 1) return { error: "none of these ids are hers" };
      if (cards.length >= 4) return { error: "four looks per answer at most" };
      cards.push({ label: line(a.label), item_ids: ids, why: line(a.why), scene: line(a.scene) });
      return { ok: true, shown_as_card: cards.length };
    }
    case "set_need": {
      const rows = ((a.items ?? []) as { id: string; need: number | null; why: string }[])
        .filter(r => all.some(i => i.id === r.id && i.wishlist));
      for (const r of rows) {
        const { error } = await sb.from("items").update({ need: r.need, need_why: r.need ? line(r.why) || null : null }).eq("id", r.id);
        if (error) return { error: error.message };
      }
      if (rows.length) actions.push({ tool: name, text: String(rows.length) });
      return { ok: true, updated: rows.length };
    }
    case "update_item": {
      const patch: Record<string, unknown> = {};
      for (const k of ["name", "notes", "styles", "occasions", "seasons"]) if (a[k] != null) patch[k] = a[k];
      if (!Object.keys(patch).length) return { error: "nothing to change" };
      const { error } = await sb.from("items").update(patch).eq("id", String(a.id));
      if (error) return { error: error.message };
      actions.push({ tool: name, text: title(String(a.id)) });
      return { ok: true };
    }
    case "add_looking_for": {
      const { data, error } = await sb.from("shopping").insert({ name: line(a.name), category: a.category ?? null, why: a.why ?? null,
        priority: a.priority ?? 2, occasions: a.occasions ?? [] }).select("id").single();
      if (error) return { error: error.message };
      actions.push({ tool: name, text: line(a.name) });
      return { ok: true, id: data.id };
    }
    case "link_candidates": {
      const { data: e } = await sb.from("shopping").select("item_ids,name").eq("id", String(a.entry_id)).maybeSingle();
      if (!e) return { error: "entry not found" };
      const ids = [...new Set([...(e.item_ids ?? []), ...known(a.item_ids)])];
      const { error } = await sb.from("shopping").update({ item_ids: ids }).eq("id", String(a.entry_id));
      if (error) return { error: error.message };
      actions.push({ tool: name, text: e.name });
      return { ok: true };
    }
    case "add_note": {
      const { error } = await sb.from("notes").insert({ kind: a.kind, title: line(a.title), body: String(a.body ?? "").trim() });
      if (error) return { error: error.message };
      actions.push({ tool: name, text: line(a.title) });
      return { ok: true };
    }
    case "link_look": {
      const { data: x } = await sb.from("inspirations").select("item_ids").eq("id", String(a.inspiration_id)).maybeSingle();
      if (!x) return { error: "look not found" };
      const ids = [...new Set([...(x.item_ids ?? []), ...known(a.item_ids)])];
      const { error } = await sb.from("inspirations").update({ item_ids: ids }).eq("id", String(a.inspiration_id));
      if (error) return { error: error.message };
      actions.push({ tool: name, text: known(a.item_ids).map(title).join(", ") });
      return { ok: true };
    }
  }
  return { error: `unknown tool ${name}` };
}

type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } };

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Please sign in again" }, 401);
    const body = await req.json() as { thread_id?: string; message?: string; context?: Record<string, string | undefined> };
    const message = String(body.message ?? "").trim(), thread_id = String(body.thread_id ?? "");
    const ctx = body.context ?? {};
    if (!message || !/^[0-9a-f-]{36}$/.test(thread_id)) return json({ error: "Empty message" }, 400);
    if (!Deno.env.get("OPENAI_API_KEY")) throw new Error("OpenAI key is not set up yet.");

    const { data: past } = await sb.from("agent_messages").select("role,content,cards").eq("thread_id", thread_id)
      .order("created_at", { ascending: false }).limit(HISTORY);
    await sb.from("agent_messages").insert({ thread_id, role: "user", content: message, context: ctx });

    const snap = await snapshot(sb);
    const screen = await screenText(sb, ctx, snap.all);
    const picture = ctx.item_id ? snap.all.find(i => i.id === ctx.item_id) : null;
    let image = picture ? await imageInput(sb, (await sb.from("items").select("photo_path").eq("id", picture.id).single()).data?.photo_path) : null;
    if (!image && ctx.inspiration_id) image = await imageInput(sb, (await sb.from("inspirations").select("image_path").eq("id", ctx.inspiration_id).maybeSingle()).data?.image_path);

    const history = (past ?? []).reverse().map((m: { role: string; content: string; cards: Card[] }) => ({
      role: m.role,
      content: m.content + (m.cards?.length ? `\n[looks shown: ${m.cards.map(c => `${c.label} (${c.item_ids.join(", ")})`).join("; ")}]` : ""),
    }));
    const input: unknown[] = [
      { role: "system", content: `${voice(snap.L)}\n\n${snap.text}` },
      ...history,
      { role: "user", content: [{ type: "input_text", text: `[${screen}]\n\n${message}` }, ...(image ? [image] : [])] },
    ];

    const cards: Card[] = [], actions: Action[] = [];
    const used = { text_in: 0, cached_in: 0, writes: 0, output: 0 };
    let reply = "";
    for (let round = 0; round <= MAX_ROUNDS && !reply; round++) {
      const last = round === MAX_ROUNDS;
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, input, tools: TOOLS, tool_choice: last ? "none" : "auto" }),
      });
      const res = await r.json();
      if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${res.error?.message ?? "unknown"}`);
      const u = (res.usage ?? {}) as Usage;
      const cached = u.input_tokens_details?.cached_tokens ?? 0;
      used.cached_in += cached; used.writes += u.input_tokens_details?.cache_write_tokens ?? 0;
      used.text_in += (u.input_tokens ?? 0) - cached; used.output += u.output_tokens ?? 0;
      const out = (res.output ?? []) as { type: string; name?: string; arguments?: string; call_id?: string; content?: { type: string; text?: string }[] }[];
      const calls = out.filter(o => o.type === "function_call");
      if (!calls.length) {
        reply = out.flatMap(o => o.content ?? []).filter(p => p.type === "output_text").map(p => p.text).join("").trim();
        if (!reply) reply = "…";
        break;
      }
      input.push(...out);
      for (const c of calls) {
        let result: unknown;
        try { result = await runTool(sb, c.name ?? "", JSON.parse(c.arguments || "{}"), snap.all, cards, actions); }
        catch (e) { result = { error: e instanceof Error ? e.message : String(e) }; }
        input.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(result) });
      }
    }

    const cost_usd = ((used.text_in - used.writes) * PRICE.input + used.writes * PRICE.cache_write + used.cached_in * PRICE.cached + used.output * PRICE.output) / 1e6;
    await sb.from("ai_usage").insert({ kind: "agent", model: MODEL, text_in: used.text_in, cached_in: used.cached_in, output: used.output, cost_usd, raw: used });
    const { data: saved } = await sb.from("agent_messages").insert({ thread_id, role: "assistant", content: reply, cards, actions, context: ctx, cost_usd })
      .select("id").single();
    return json({ id: saved?.id ?? null, reply, cards, actions, changed: actions.length > 0, cost_usd });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

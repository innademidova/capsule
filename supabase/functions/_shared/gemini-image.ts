// Image generation with Gemini (Nano Banana), shared by the look and garment functions.
// Uses GEMINI_API_KEY (the project has billing on, so this is paid). The callers fall back to OpenAI when this throws.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

// Best first. Prices: USD per 1M tokens, standard paid tier (ai.google.dev/gemini-api/docs/pricing, 2026-11-12).
// A 1K or 2K picture is ~1120 output image tokens on Pro (~13.4c), 1680 on Flash at 2K (~10c).
const MODELS = [
  { id: "gemini-3-pro-image", tier: "pro", name: "Nano Banana Pro", input: 2, outText: 12, outImage: 120 },
  { id: "gemini-3.1-flash-image", tier: "flash", name: "Nano Banana 2", input: 0.5, outText: 3, outImage: 60 },
];

type Detail = { modality?: string; tokenCount?: number };
type Usage = {
  promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number;
  promptTokensDetails?: Detail[]; candidatesTokensDetails?: Detail[];
};

export type Painted = {
  b64: string; mime: string; model: string; skipped: string[];
  text_in: number; image_in: number; output: number; cost_usd: number; raw: Usage;
};

const tokens = (list: Detail[] | undefined, modality: string) =>
  (list ?? []).filter(d => d.modality === modality).reduce((s, d) => s + (d.tokenCount ?? 0), 0);

// images: the reference pictures in the order the prompt numbers them (image 1, image 2, ...).
// budgetMs: all attempts together; the caller keeps the rest of the function time for the OpenAI fallback.
export async function geminiImage(prompt: string, images: Blob[], opts: { aspect?: string; size: "1K" | "2K"; budgetMs: number; flashFirst?: boolean }): Promise<Painted> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("no GEMINI_API_KEY");
  const parts: unknown[] = [{ text: prompt }];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.type || "image/png", data: encodeBase64(new Uint8Array(await img.arrayBuffer())) } });
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { ...(opts.aspect ? { aspectRatio: opts.aspect } : {}), imageSize: opts.size },
    },
  });
  const skipped: string[] = [];
  const deadline = Date.now() + opts.budgetMs;
  // flashFirst: cheaper Nano Banana 2 first (item photos), Pro only if it fails
  for (const m of opts.flashFirst ? [...MODELS].reverse() : MODELS) {
    const left = deadline - Date.now();
    if (left < 15_000) { skipped.push(`${m.id}: no time left`); continue; }
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(left),
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body,
      });
    } catch (e) {
      skipped.push(`${m.id}: ${e instanceof Error && e.name === "TimeoutError" ? "too slow" : String(e)}`);
      continue;
    }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { skipped.push(`${m.id}: ${r.status} ${out.error?.message ?? ""}`.slice(0, 300)); continue; }
    // Thinking models may return draft "thought" images first: take the last real image
    const imgs = ((out.candidates?.[0]?.content?.parts ?? []) as { thought?: boolean; inlineData?: { mimeType: string; data: string } }[])
      .filter(p => p.inlineData?.data && !p.thought);
    const img = imgs[imgs.length - 1]?.inlineData;
    if (!img) { skipped.push(`${m.id}: no image (${out.candidates?.[0]?.finishReason ?? out.promptFeedback?.blockReason ?? "unknown"})`); continue; }
    const u = (out.usageMetadata ?? {}) as Usage;
    const image_in = tokens(u.promptTokensDetails, "IMAGE");
    const text_in = Math.max(0, (u.promptTokenCount ?? 0) - image_in);
    const output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const outImage = tokens(u.candidatesTokensDetails, "IMAGE") || (u.candidatesTokenCount ?? 0);
    const cost_usd = ((text_in + image_in) * m.input + outImage * m.outImage + Math.max(0, output - outImage) * m.outText) / 1e6;
    return { b64: img.data, mime: img.mimeType, model: m.name, skipped, text_in, image_in, output, cost_usd, raw: u };
  }
  throw new Error(`Gemini could not draw it: ${skipped.join("; ")}`);
}

export const extOf = (mime: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[mime] ?? "png";

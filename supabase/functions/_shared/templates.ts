// Image templates (table image_templates): a layout picture plus the instruction text for the image model.
// The user's own row overrides the default row field by field (a null field = use the default).
// The text holds {placeholders}; fill() puts the data in. The functions then append a technical part that the
// user never edits: which attached image is which, and what each look is made of.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Purpose = "look" | "many" | "garment";

// The placeholders each purpose understands, shown under the editor in the app (keep in sync with src/lib.ts)
export const PLACEHOLDERS: Record<Purpose, string[]> = {
  many: ["title", "anchor", "looks_count", "labels", "palette", "palette_count", "appearance"],
  look: ["vibe", "scene", "palette", "palette_count", "appearance"],
  garment: ["piece"],
};

export async function loadTemplate(sb: SupabaseClient, purpose: Purpose) {
  // RLS returns the default row and this user's own row only
  const { data, error } = await sb.from("image_templates").select("user_id,image_path,prompt").eq("purpose", purpose);
  if (error) throw error;
  const own = data?.find(r => r.user_id), def = data?.find(r => !r.user_id);
  const prompt: string | null = own?.prompt ?? def?.prompt ?? null;
  if (!prompt) throw new Error(`The "${purpose}" template has no instructions yet (Profile → Settings → Default image templates).`);
  return { image_path: (own?.image_path ?? def?.image_path ?? null) as string | null, prompt };
}

// Replaces {name} with values[name]; unknown placeholders stay as they are
export const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => k in values ? values[k] : m);

export const DEFAULT_APPEARANCE = "A woman in her late twenties with a natural, elegant look.";

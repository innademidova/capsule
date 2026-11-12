-- Image templates: a layout picture plus the instruction text for the image model, one per purpose.
--   look     one outfit on her (saved outfits, the stylist's looks)
--   many     one piece, many looks (the "Style it" collage)
--   garment  item photos (Enhance with AI); no picture
-- A row with user_id null is the default (admins write it); a row with a user_id is that user's own version.
-- In an own row a null field means "use the default". The prompt holds {placeholders} that the functions fill
-- (see supabase/functions/_shared/templates.ts); the functions append the technical part (attached images, looks).
-- Replaces app_settings 'template:<id>' and style_profile.templates.

create table if not exists public.image_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade,
  purpose    text not null check (purpose in ('look', 'many', 'garment')),
  image_path text,
  prompt     text,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, purpose)
);
alter table public.image_templates enable row level security;
drop policy if exists "read defaults and own" on public.image_templates;
create policy "read defaults and own" on public.image_templates for select
  using (user_id is null or user_id = auth.uid());
drop policy if exists "write own" on public.image_templates;
create policy "write own" on public.image_templates for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "admins write defaults" on public.image_templates;
create policy "admins write defaults" on public.image_templates for all
  using (user_id is null and public.is_admin()) with check (user_id is null and public.is_admin());

-- Defaults: the pictures from app_settings and the instruction texts
insert into public.image_templates (user_id, purpose, image_path, prompt) values
  (null, 'look', (select value->>'path' from public.app_settings where key = 'template:look'), $p$Create a vertical Instagram styling post (2:3) in exactly the same format as the layout reference picture:
- Left part, about 55% of the width, full height: a photorealistic full-body street-style photo of one woman wearing the outfit.
- Right part: a plain warm off-white (#f3eee6) panel. At the top a row of {palette_count} round colour dots in these colours, left to right: {palette}. Below them, each piece of the outfit as a separate clean product photo (no person, no hanger), neatly arranged like the reference with small even gaps, all fully visible.
- The same pieces appear in both parts and look identical in both.
- Copy ONLY the layout, proportions, spacing and mood of the reference. Do not copy its clothes, person, colours or any text.
- No text at all: no titles, numbers, colour codes, lists, labels, logos, icons or watermarks.

THE WOMAN
{appearance}
Natural, relaxed and confident; a real person, not a mannequin. Light natural make-up.

THE CLOTHES (most important)
- Each piece must look exactly like its photo: the same colour and shade, fabric and texture, length, fit and every detail (buttons, collar, neckline, pleats, pockets, hardware, print).
- She wears every listed piece, styled the way a stylist would for a "{vibe}" look (tucked, belted, sleeves pushed up, coat on the shoulders and so on, only when it suits).
- Do not add other visible garments. At most small, simple jewellery.

THE PHOTO OF HER
- {scene}
- Full body from head to shoes, camera at about waist height, soft natural light, gentle background blur, true-to-life colours.$p$),
  (null, 'many', (select value->>'path' from public.app_settings where key = 'template:many'), $p$Create a vertical Pinterest-style styling collage (2:3) in the same format as the layout reference picture:
- In the centre, large: a clean product photo of the main piece ({anchor}) on its own, exactly as it is.
- Around it, {looks_count} separate full-body street-style photos of the SAME woman, one per look, arranged like the photos in the reference (torn-paper edges, small tilt, soft shadow), all fully visible and not overlapping the centre piece.
- Background: a warm, plain beige paper texture like the reference.
- Text, in the same elegant fonts and places as the reference, and nothing else: the headline "{title}" with "many looks" in script under it; next to each photo its short handwritten label with a small arrow; at the bottom a row of {palette_count} round colour dots in these colours, left to right: {palette}. Spell every word exactly as given.
- Copy ONLY the layout, proportions, fonts and mood of the reference. Do not copy its clothes, person or colours.

THE WOMAN (the same person in every photo)
{appearance}
Natural, relaxed and confident; light natural make-up; different natural poses and city backgrounds per photo.

THE CLOTHES (most important)
- Each piece must look exactly like its photo: the same colour and shade, fabric and texture, length, fit and details.
- The main piece must be identical in the centre and in every look.
- True-to-life colours, soft daylight.$p$),
  (null, 'garment', null, $p$Create ONE image of only this garment as a clean e-commerce product photo: {piece}

OUTPUT
- Transparent background. If transparency is not possible, use pure white #FFFFFF.
- Flat lay, viewed straight from above, garment centered, fully visible, nothing cropped, with small even margins.
- Garment laid out neatly in its natural shape: no body, mannequin, hanger, hands, hair or other clothes.
- Soft, even studio lighting, no harsh shadows, no props, no text, no watermark.

ACCURACY (most important)
- Reproduce the garment exactly as it appears in the photos. Do not redesign, "improve" or simplify it.
- Keep the exact colour and shade, fabric and texture (knit, linen, denim, satin and so on), pattern or print, and its scale.
- Keep every detail exactly: number, colour, shape and placement of buttons, zippers, pockets, seams, pleats, darts, collar and lapel shape, cuffs, belt, buckles, hardware, embroidery, logos.
- Keep the real proportions: length, sleeve length, fit (cropped, oversized, wide-leg and so on).
- Do not add anything that is not in the photo (labels, tags, extra buttons, linings, stitching).

SILHOUETTE AND WIDTH (flat lays tend to look too wide; avoid that)
- Judge the true width from the person in the photo: how the garment sits on her shoulders, chest and waist. A piece that fits close on her must look close-fitting, not boxy.
- Lay it out the way a stylist would for a shop: body neatly shaped, side seams gently following the natural line from bust to waist to hip, a soft hint of waist where the garment has one. Not a sharp or exaggerated wasp waist.
- Stretch pieces (bodysuits, ribbed knits, jersey tops, fitted sweaters, knit dresses) lie at their relaxed width, which is narrower than when worn. Never stretch them out sideways or show them as a wide rectangle.
- Do not fan out the hem or sleeves to fill space. Sleeves lie close to the body or slightly angled, at their real width.
- Only make it wide or boxy when the photo clearly shows an oversized or loose fit.
- If part of the garment is hidden by arms, hair, a bag or another garment, complete it in the most plausible way consistent with the visible parts.$p$)
on conflict (user_id, purpose) do nothing;

-- Own pictures
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'style_profile' and column_name = 'templates') then
    insert into public.image_templates (user_id, purpose, image_path)
    select p.user_id, t.key, t.value #>> '{}' from public.style_profile p, jsonb_each(p.templates) t
    where t.key in ('look', 'many')
    on conflict (user_id, purpose) do nothing;
    alter table public.style_profile drop column templates;
  end if;
end $$;
delete from public.app_settings where key like 'template:%';

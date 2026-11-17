-- "One piece, many looks" collage removed (2026-11-18): several looks in one picture mixed the looks up.
-- Only the 'look' (one outfit on her) and 'garment' (item photos) templates remain.
delete from public.image_templates where purpose = 'many';
alter table public.image_templates drop constraint if exists image_templates_purpose_check;
alter table public.image_templates add constraint image_templates_purpose_check check (purpose in ('look', 'garment'));
drop function if exists public.set_request_collage(uuid, text);
-- Collages already saved to outfits keep their picture there; the request no longer needs the keys
update public.ai_requests set result = result - 'collage_path' - 'collage_outfit_id'
where kind = 'looks' and result ? 'collage_outfit_id';

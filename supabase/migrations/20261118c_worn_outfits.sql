-- Her own outfit photos (what she actually wore): outfits with source 'worn' and image_path = her photo.
-- miss = it did not work; the notes then say what went wrong and how not to do it again.
alter table public.outfits add column if not exists miss boolean not null default false;
alter table public.outfits add column if not exists worn_on date;
comment on column public.outfits.source is 'manual | ai | worn (her own photo of what she wore)';

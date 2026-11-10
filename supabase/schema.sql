-- Capsule: database schema

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text,                              -- short name, e.g. "Cream cable-knit sweater"
  category    text not null,                     -- top, bottom, dress, outerwear, shoes, bag, accessory, swim
  kind        text,                              -- detail: sweater, jeans, loafers…
  colors      text[] not null default '{}',
  seasons     text[] not null default '{}',      -- winter, spring, summer, autumn
  styles      text[] not null default '{}',      -- casual, classic, minimal…
  occasions   text[] not null default '{}',      -- everyday, work, evening…
  brand       text,
  notes       text,
  photo_path  text,                              -- full photo (Storage, up to 1600px)
  thumb_path  text,                              -- gallery preview (up to 600px)
  favorite    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- Access: the owner alone sees and changes each row
alter table public.items enable row level security;
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Photos: private bucket, path <user_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "own photos" on storage.objects;
create policy "own photos" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== Stages 2-5 =====

-- Outfits: placement of items on the canvas (coordinates in percent)
create table if not exists public.outfits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text,
  layout      jsonb not null default '[]',      -- [{item_id, x, y, w, z}]
  occasions   text[] not null default '{}',
  seasons     text[] not null default '{}',
  notes       text,                             -- e.g. the stylist's explanation
  favorite    boolean not null default false,
  source      text not null default 'manual',   -- manual | ai
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- What was worn and when
create table if not exists public.wear_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  worn_on     date not null default current_date,
  outfit_id   uuid references public.outfits(id) on delete set null,
  item_ids    uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- Inspiration: look screenshots and their breakdown
create table if not exists public.inspirations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_path  text not null,
  thumb_path  text,
  note        text,
  analysis    jsonb,                            -- AI result
  created_at  timestamptz not null default now()
);

-- My style formulas (one row)
create table if not exists public.style_profile (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  summary     text,
  formulas    jsonb not null default '[]',      -- [{title, recipe}]
  palette     text[] not null default '{}',
  key_pieces  text[] not null default '{}',
  based_on    int not null default 0,
  updated_at  timestamptz not null default now()
);

-- Shopping list
create table if not exists public.shopping (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  category    text,
  why         text,
  priority    smallint not null default 2,      -- 1 must-have, 2 nice, 3 someday
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- AI requests: "now" (Edge Function) or "queue" (processed by Claude Code for free)
create table if not exists public.ai_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null,                    -- tag | outfits | inspo | formulas | gaps | buy
  input       jsonb not null default '{}',
  image_path  text,
  mode        text not null default 'queue',    -- now | queue
  status      text not null default 'queued',   -- queued | done | error
  result      jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);

drop trigger if exists outfits_touch on public.outfits;
create trigger outfits_touch before update on public.outfits
  for each row execute function public.touch_updated_at();

do $$ declare t text; begin
  foreach t in array array['outfits','wear_log','inspirations','style_profile','shopping','ai_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- When a request is done, its result is distributed to the tables automatically
create or replace function public.apply_ai_result() returns trigger
language plpgsql security invoker as $$
begin
  if new.status <> 'done' or old.status = 'done' or new.result is null then return new; end if;
  new.done_at = now();
  if new.kind = 'inspo' and new.input ? 'inspiration_id' then
    update public.inspirations set analysis = new.result where id = (new.input->>'inspiration_id')::uuid;
  elsif new.kind = 'formulas' then
    insert into public.style_profile (user_id, summary, formulas, palette, key_pieces, based_on, updated_at)
    values (new.user_id, new.result->>'summary', coalesce(new.result->'formulas', '[]'),
      array(select jsonb_array_elements_text(coalesce(new.result->'palette', '[]'))),
      array(select jsonb_array_elements_text(coalesce(new.result->'key_pieces', '[]'))),
      coalesce((new.result->>'based_on')::int, 0), now())
    on conflict (user_id) do update set summary = excluded.summary, formulas = excluded.formulas,
      palette = excluded.palette, key_pieces = excluded.key_pieces, based_on = excluded.based_on, updated_at = now();
  elsif new.kind = 'tag' and jsonb_typeof(new.result->'items') = 'array' then
    -- bulk tagging from the queue: [{id, name, kind, colors, seasons, styles, occasions}]
    update public.items i set
      name = coalesce(i.name, r->>'name'),
      kind = coalesce(i.kind, r->>'kind'),
      colors = case when cardinality(i.colors) = 0 then array(select jsonb_array_elements_text(r->'colors')) else i.colors end,
      seasons = case when cardinality(i.seasons) = 0 then array(select jsonb_array_elements_text(r->'seasons')) else i.seasons end,
      styles = case when cardinality(i.styles) = 0 then array(select jsonb_array_elements_text(r->'styles')) else i.styles end,
      occasions = case when cardinality(i.occasions) = 0 then array(select jsonb_array_elements_text(r->'occasions')) else i.occasions end
    from jsonb_array_elements(new.result->'items') r
    where i.id = (r->>'id')::uuid and i.user_id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists ai_apply on public.ai_requests;
create trigger ai_apply before update on public.ai_requests
  for each row execute function public.apply_ai_result();

-- Wishlist: pieces not owned yet; the stylist and outfits do not see them
alter table items add column if not exists wishlist boolean not null default false;

-- Brands: suggestions for the Brand field (items.brand stays free text)
create table if not exists public.brands (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, name)
);
alter table public.brands enable row level security;
drop policy if exists "own brands" on public.brands;
create policy "own brands" on public.brands for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

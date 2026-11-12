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
  foreach t in array array['outfits','inspirations','style_profile','shopping','ai_requests'] loop
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
alter table items add column if not exists link text;  -- shop link, used for wishlist pieces

-- AI usage: exact tokens and cost of every paid call, from the provider's `usage` field
create table if not exists public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  kind          text not null,                    -- garment, tag, ...
  model         text not null,
  text_in       int not null default 0,           -- text input tokens (uncached)
  image_in      int not null default 0,           -- image input tokens
  cached_in     int not null default 0,
  output        int not null default 0,
  cost_usd      numeric(10, 6) not null,
  raw           jsonb                             -- the provider's usage object as returned
);
alter table public.ai_usage enable row level security;
drop policy if exists "own usage" on public.ai_usage;
create policy "own usage" on public.ai_usage for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Composition, like the care label: [{"name": "Cotton", "pct": 95}, {"name": "Elastane", "pct": 5}]; pct may be null
alter table items add column if not exists materials jsonb not null default '[]';

-- Pieces of one set (suit, co-ord) share a set_id
alter table items add column if not exists set_id uuid;
create index if not exists items_set_id on items (set_id) where set_id is not null;

-- How she looks, in words; the AI draws a similar woman in outfit photos
alter table style_profile add column if not exists appearance text;
-- AI photo of a woman wearing the outfit (photos/<uid>/looks/...)
alter table outfits add column if not exists image_path text;


-- The look function writes each finished photo into its request; jsonb_set keeps parallel writes safe
create or replace function public.set_look_image(req uuid, n int, path text) returns void
language sql security invoker as $$
  update public.ai_requests set result = jsonb_set(result, array['looks', n::text, 'image_path'], to_jsonb(path))
  where id = req and user_id = auth.uid();
$$;

-- Wear tracking was removed (2026-11-11)
drop table if exists public.wear_log;

-- ===== Roles, profiles, shared dictionaries, global settings (supabase/migrations/20261111_roles_and_shared_dicts.sql) =====

-- ===== Profiles and roles =====

-- Public profile data the user edits themself
create table if not exists public.profiles (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Roles live in their own table: users can read their role but never change it (no write policies).
-- Only admins change roles, through admin_set_role().
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'user' check (role in ('admin', 'user')),
  updated_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;

-- security definer: reads user_roles without going through its RLS (no recursion in policies)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

drop policy if exists "read own role" on public.user_roles;
create policy "read own role" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Every new account gets a profile and the 'user' role
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing accounts
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;
insert into public.user_roles (user_id, role) select id, 'user' from auth.users on conflict do nothing;

-- Admin: list users with their role
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, display_name text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
    select u.id, u.email::text, p.display_name, coalesce(r.role, 'user'), u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.user_roles r on r.user_id = u.id
    order by u.created_at;
end $$;

-- Admin: change a role; the last admin can not be demoted
create or replace function public.admin_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_role not in ('admin', 'user') then raise exception 'Unknown role %', p_role; end if;
  if p_role = 'user' and (select count(*) from public.user_roles where role = 'admin' and user_id <> p_user) = 0 then
    raise exception 'There must be at least one admin';
  end if;
  insert into public.user_roles (user_id, role, updated_at) values (p_user, p_role, now())
  on conflict (user_id) do update set role = excluded.role, updated_at = now();
end $$;

-- ===== Dictionaries =====
-- dict_global: the defaults every user starts with; only admins write it.
-- dict_user:   one user's changes on top of the defaults:
--   * a row with the id of a global entry overrides it (label/hex/sort; null = keep the global value) or hides it;
--   * a row with a new id is the user's own entry.
-- dict_effective: what the app and the AI use = defaults + overrides - hidden + own entries, for the current user.
--
-- How items reference entries:
--   color, style, occasion: by id (items.colors[], styles[], occasions[]); the label is only for display.
--   brand, material:        by text (items.brand, items.materials[].name); id = lower(label).
--   kind:                   by text (items.kind) within the item's category; id = label = lowercase text.

create table if not exists public.dict_global (
  type       text not null check (type in ('brand', 'material', 'color', 'kind', 'style', 'occasion')),
  category   text not null default '',   -- kinds only: the item category
  id         text not null,
  label      text not null,
  hex        text,                       -- colors only
  sort       int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (type, category, id),
  check ((type = 'kind') = (category <> ''))
);
alter table public.dict_global enable row level security;
drop policy if exists "everyone reads defaults" on public.dict_global;
create policy "everyone reads defaults" on public.dict_global for select to authenticated using (true);
drop policy if exists "admins write defaults" on public.dict_global;
create policy "admins write defaults" on public.dict_global for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.dict_user (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type       text not null check (type in ('brand', 'material', 'color', 'kind', 'style', 'occasion')),
  category   text not null default '',
  id         text not null,
  label      text,
  hex        text,
  sort       int,
  hidden     boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, type, category, id),
  check ((type = 'kind') = (category <> ''))
);
alter table public.dict_user enable row level security;
drop policy if exists "own dict" on public.dict_user;
create policy "own dict" on public.dict_user for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- security_invoker: RLS of both tables applies, so a user only ever sees their own overrides
create or replace view public.dict_effective with (security_invoker = true) as
select
  coalesce(g.type, u.type)         as type,
  coalesce(g.category, u.category) as category,
  coalesce(g.id, u.id)             as id,
  coalesce(u.label, g.label, u.id) as label,
  coalesce(u.hex, g.hex)           as hex,
  coalesce(u.sort, g.sort, 1000)   as sort,
  g.id is not null                 as is_default,
  u.id is not null and g.id is null as is_own
from public.dict_global g
full join (select * from public.dict_user where user_id = auth.uid()) u
  on u.type = g.type and u.category = g.category and u.id = g.id
where not coalesce(u.hidden, false);

-- Does this item use the entry? (one place for the rules above)
create or replace function public.item_uses(i public.items, p_type text, p_category text, p_id text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_type
    when 'color'    then p_id = any(i.colors)
    when 'style'    then p_id = any(i.styles)
    when 'occasion' then p_id = any(i.occasions)
    when 'brand'    then lower(trim(i.brand)) = p_id
    when 'kind'     then i.kind = p_id and i.category = p_category
    when 'material' then exists (select 1 from jsonb_array_elements(i.materials) m where lower(trim(m->>'name')) = p_id)
    else false end;
$$;

-- Admin: rename a default. Colors, styles and occasions keep their id (only label/hex change).
-- Brands, materials and kinds are stored as text, so the new spelling reaches every user's items and overrides.
create or replace function public.admin_rename_dict(p_type text, p_category text, p_id text, p_label text, p_hex text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_label text := trim(p_label);
  v_id    text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if v_label = '' then raise exception 'Empty name'; end if;
  if p_type in ('color', 'style', 'occasion') then
    update public.dict_global set label = v_label, hex = coalesce(p_hex, hex), updated_at = now()
    where type = p_type and category = p_category and id = p_id;
    return;
  end if;

  if p_type = 'kind' then v_label := lower(v_label); end if;
  v_id := lower(v_label);
  if v_id <> p_id and exists (select 1 from public.dict_global where type = p_type and category = p_category and id = v_id) then
    raise exception 'Already in the list';
  end if;
  update public.dict_global set id = v_id, label = v_label, updated_at = now()
  where type = p_type and category = p_category and id = p_id;

  if v_id <> p_id then
    -- a user who already has an entry with the new id keeps theirs
    delete from public.dict_user u where u.type = p_type and u.category = p_category and u.id = p_id
      and exists (select 1 from public.dict_user v where v.user_id = u.user_id and v.type = p_type and v.category = p_category and v.id = v_id);
    update public.dict_user set id = v_id, updated_at = now() where type = p_type and category = p_category and id = p_id;
  end if;

  if p_type = 'brand' then
    update public.items set brand = v_label where lower(trim(brand)) = p_id;
  elsif p_type = 'kind' then
    update public.items set kind = v_label where kind = p_id and category = p_category;
  elsif p_type = 'material' then
    update public.items i set materials = (
      select jsonb_agg(case when lower(trim(m->>'name')) = p_id then jsonb_set(m, '{name}', to_jsonb(v_label)) else m end)
      from jsonb_array_elements(i.materials) m)
    where public.item_uses(i, 'material', '', p_id);
  end if;
end $$;

-- Admin: delete a default. Nobody loses data: users whose items still use it get it as their own entry.
create or replace function public.admin_delete_dict(p_type text, p_category text, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.dict_global;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into g from public.dict_global where type = p_type and category = p_category and id = p_id;
  if not found then return; end if;
  -- overrides become complete own entries
  update public.dict_user set label = coalesce(label, g.label), hex = coalesce(hex, g.hex), sort = coalesce(sort, g.sort), updated_at = now()
  where type = p_type and category = p_category and id = p_id and not hidden;
  -- users who use it and have no row for it get one (users who hid it already have a row and are skipped)
  insert into public.dict_user (user_id, type, category, id, label, hex, sort)
  select distinct i.user_id, p_type, p_category, p_id, g.label, g.hex, g.sort
  from public.items i where public.item_uses(i, p_type, p_category, p_id)
  on conflict do nothing;
  -- hiding something that no longer exists means nothing
  delete from public.dict_user where type = p_type and category = p_category and id = p_id and hidden;
  delete from public.dict_global where type = p_type and category = p_category and id = p_id;
end $$;

revoke all on function public.admin_list_users(), public.admin_set_role(uuid, text),
  public.admin_rename_dict(text, text, text, text, text), public.admin_delete_dict(text, text, text) from public, anon;
grant execute on function public.admin_list_users(), public.admin_set_role(uuid, text),
  public.admin_rename_dict(text, text, text, text, text), public.admin_delete_dict(text, text, text) to authenticated;

-- ===== Global settings =====
-- key/value, readable by everyone signed in, written by admins. Keys:
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "everyone reads settings" on public.app_settings;
create policy "everyone reads settings" on public.app_settings for select to authenticated using (true);
drop policy if exists "admins write settings" on public.app_settings;
create policy "admins write settings" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Shared files (photos/global/...): everyone signed in reads, admins write
drop policy if exists "read global photos" on storage.objects;
create policy "read global photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = 'global');
drop policy if exists "admins write global photos" on storage.objects;
create policy "admins write global photos" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = 'global' and public.is_admin())
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = 'global' and public.is_admin());


-- Which model answered an AI request (e.g. "Gemini 3.8 Flash", "OpenAI")
alter table public.ai_requests add column if not exists model text;

create or replace function public.set_request_collage(req uuid, path text) returns void
language sql security invoker as $$
  update public.ai_requests set result = jsonb_set(result, '{collage_path}', to_jsonb(path))
  where id = req and user_id = auth.uid();
$$;

-- Image templates: layout picture + instructions per purpose (supabase/migrations/20261112_image_templates_with_prompts.sql
-- also seeds the default rows with their instruction texts)
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


-- Roles (admin | user), profiles, shared dictionaries with per-user overrides, global app settings.
-- Idempotent: safe to run more than once. The data move at the bottom runs only while the old tables exist.

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
--   look_reference: {"path": "global/reference/<file>"}  default layout reference for AI look images
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

-- style_profile.look_reference is now the user's own override; null = use the global default

-- ===== One-time data move from the old per-user tables (dict, brands, materials) =====
do $$ begin
  if to_regclass('public.dict') is not null then
    insert into public.dict_global (type, category, id, label, hex, sort)
    select distinct on (type, category, id) type, category, id, label, hex, sort from public.dict
    order by type, category, id
    on conflict do nothing;
    drop table public.dict;
  end if;
  if to_regclass('public.brands') is not null then
    insert into public.dict_global (type, id, label)
    select distinct on (lower(trim(name))) 'brand', lower(trim(name)), trim(name) from public.brands where trim(name) <> ''
    order by lower(trim(name)), name
    on conflict do nothing;
    drop table public.brands;
  end if;
  if to_regclass('public.materials') is not null then
    insert into public.dict_global (type, id, label)
    select distinct on (lower(trim(name))) 'material', lower(trim(name)), trim(name) from public.materials where trim(name) <> ''
    order by lower(trim(name)), name
    on conflict do nothing;
    drop table public.materials;
  end if;
end $$;

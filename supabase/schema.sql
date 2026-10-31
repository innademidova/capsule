-- Capsule: схема бази даних

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text,                              -- коротка назва, напр. "Cream cable-knit sweater"
  category    text not null,                     -- top, bottom, dress, outerwear, shoes, bag, accessory
  kind        text,                              -- уточнення: sweater, jeans, loafers…
  colors      text[] not null default '{}',
  seasons     text[] not null default '{}',      -- winter, spring, summer, autumn
  styles      text[] not null default '{}',      -- casual, classic, minimal…
  occasions   text[] not null default '{}',      -- everyday, work, evening…
  brand       text,
  notes       text,
  photo_path  text,                              -- повне фото (Storage, до 1600px)
  thumb_path  text,                              -- прев'ю для галереї (до 600px)
  favorite    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- Доступ: кожен запис бачить і змінює лише власниця
alter table public.items enable row level security;
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Фото: приватний бакет, шлях <user_id>/<файл>
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "own photos" on storage.objects;
create policy "own photos" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

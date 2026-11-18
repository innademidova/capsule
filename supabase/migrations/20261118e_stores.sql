-- Notes tab "Stores": shops she buys from or looks in. tags = what they sell (category ids plus all, basics, underwear, sport),
-- ukrainian = a Ukrainian brand, regular = she buys there regularly. url = website, instagram = profile link.
create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  url         text,
  instagram   text,
  note        text not null default '',
  tags        text[] not null default '{}',
  ukrainian   boolean not null default false,
  regular     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists stores_touch on public.stores;
create trigger stores_touch before update on public.stores
  for each row execute function public.touch_updated_at();
alter table public.stores enable row level security;
drop policy if exists "own rows" on public.stores;
create policy "own rows" on public.stores for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

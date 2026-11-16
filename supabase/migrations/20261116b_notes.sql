-- 2026-11-16: notes in the Shop tab.
-- The shopping list becomes "Looking for": free-text details (why), links to check and wishlist candidates.
alter table public.shopping add column if not exists links text[] not null default '{}';
alter table public.shopping add column if not exists item_ids uuid[] not null default '{}';
alter table public.shopping add column if not exists occasions text[] not null default '{}';

-- Rules ("never buy satin pajamas") and insights: a title and a free text, own rows only
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('rule', 'insight')),
  title       text not null default '',
  body        text not null default '',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();
alter table public.notes enable row level security;
drop policy if exists "own rows" on public.notes;
create policy "own rows" on public.notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

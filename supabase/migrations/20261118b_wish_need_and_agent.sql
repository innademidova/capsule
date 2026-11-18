-- 1. How much she needs a wishlist piece: 1 = must have, 2 = good to have, 3 = someday (null = not rated yet),
--    set by hand on the item page or by the AI task 'wish_rank' (the trigger below copies its result).
alter table public.items add column if not exists need smallint check (need between 1 and 3);
alter table public.items add column if not exists need_why text;

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
  elsif new.kind = 'wish_rank' and jsonb_typeof(new.result->'items') = 'array' then
    -- wishlist rating: [{id, need, why}]
    update public.items i set need = (r->>'need')::smallint, need_why = r->>'why'
    from jsonb_array_elements(new.result->'items') r
    where i.id = (r->>'id')::uuid and i.user_id = new.user_id and i.wishlist and (r->>'need')::int between 1 and 3;
  end if;
  return new;
end $$;

-- 2. The assistant chat (Edge Function 'agent'): her messages and its answers, grouped by thread.
--    cards = looks it proposed [{label, item_ids, why, scene, image_path?, outfit_id?}]; actions = what it changed.
create table if not exists public.agent_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  thread_id   uuid not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null default '',
  cards       jsonb not null default '[]',
  actions     jsonb not null default '[]',
  context     jsonb,
  cost_usd    numeric(10, 6),
  created_at  timestamptz not null default now()
);
create index if not exists agent_messages_thread on public.agent_messages (user_id, thread_id, created_at);
alter table public.agent_messages enable row level security;
drop policy if exists "own rows" on public.agent_messages;
create policy "own rows" on public.agent_messages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

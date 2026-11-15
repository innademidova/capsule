-- Links between inspiration looks and items (mostly wishlist pieces): the look lists what to buy,
-- the item shows which saved looks it is needed for.
alter table public.inspirations add column if not exists item_ids uuid[] not null default '{}';

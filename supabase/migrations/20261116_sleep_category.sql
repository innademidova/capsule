-- New item category "sleep" (pajamas and loungewear) with its default kinds.
insert into public.dict_global (type, category, id, label, sort) values
  ('kind', 'sleep', 'pajamas', 'pajamas', 0),
  ('kind', 'sleep', 'nightgown', 'nightgown', 1),
  ('kind', 'sleep', 'robe', 'robe', 2),
  ('kind', 'sleep', 'lounge set', 'lounge set', 3)
on conflict do nothing;

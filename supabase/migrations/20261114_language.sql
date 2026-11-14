-- Interface language per account (the AI writes in it too); null = decided by the device
alter table public.profiles add column if not exists language text check (language in ('en', 'uk'));

-- renamed: the user gave a default entry her own label, so the app shows that label instead of a translation
create or replace view public.dict_effective with (security_invoker = true) as
select
  coalesce(g.type, u.type)         as type,
  coalesce(g.category, u.category) as category,
  coalesce(g.id, u.id)             as id,
  coalesce(u.label, g.label, u.id) as label,
  coalesce(u.hex, g.hex)           as hex,
  coalesce(u.sort, g.sort, 1000)   as sort,
  g.id is not null                 as is_default,
  u.id is not null and g.id is null as is_own,
  u.label is not null              as renamed
from public.dict_global g
full join (select * from public.dict_user where user_id = auth.uid()) u
  on u.type = g.type and u.category = g.category and u.id = g.id
where not coalesce(u.hidden, false);

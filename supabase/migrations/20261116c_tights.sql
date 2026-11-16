-- Tights as a default accessory kind
insert into public.dict_global (type, category, id, label, sort)
select 'kind', 'accessory', 'tights', 'tights', coalesce(max(sort) + 1, 0) from public.dict_global where type = 'kind' and category = 'accessory'
on conflict do nothing;

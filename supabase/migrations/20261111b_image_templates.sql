-- Layout templates for AI images, one per purpose (ids are defined in src/lib.ts TEMPLATES):
--   look  one outfit on her (saved outfits, the stylist's looks)
--   many  one piece, many looks (one collage for "Style it")
-- Global defaults: app_settings key 'template:<id>' = {"path": "global/reference/..."} (admins write).
-- Own overrides: style_profile.templates = {"<id>": "<uid>/reference/..."}; a missing key = the default.

alter table public.style_profile add column if not exists templates jsonb not null default '{}';

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'style_profile' and column_name = 'look_reference') then
    update public.style_profile set templates = templates || jsonb_build_object('look', look_reference) where look_reference is not null;
    alter table public.style_profile drop column look_reference;
  end if;
end $$;

insert into public.app_settings (key, value, updated_at)
select 'template:look', value, now() from public.app_settings where key = 'look_reference'
on conflict (key) do nothing;
delete from public.app_settings where key = 'look_reference';

-- The look function stores the "many looks" collage in its request; a merge keeps parallel writes to looks[] safe
create or replace function public.set_request_collage(req uuid, path text) returns void
language sql security invoker as $$
  update public.ai_requests set result = jsonb_set(result, '{collage_path}', to_jsonb(path))
  where id = req and user_id = auth.uid();
$$;

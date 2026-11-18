-- Notes tab "Bloggers": her favourite fashion accounts (kind 'blogger', title = @name, body = what she likes, url = profile)
alter table public.notes drop constraint if exists notes_kind_check;
alter table public.notes add constraint notes_kind_check check (kind in ('rule', 'insight', 'blogger'));
alter table public.notes add column if not exists url text;

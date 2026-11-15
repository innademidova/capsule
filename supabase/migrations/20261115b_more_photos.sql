-- More photos of one item (back, side, details); the first photo stays in photo_path / thumb_path
alter table public.items add column if not exists more_photos text[] not null default '{}';

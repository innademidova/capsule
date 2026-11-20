-- Several photos per saved look (an Instagram carousel): the first stays in image_path, the rest are here
alter table inspirations add column if not exists more_photos text[] not null default '{}';

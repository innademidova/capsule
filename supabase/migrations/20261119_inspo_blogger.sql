-- An inspiration can come from one of her favourite bloggers (notes of kind 'blogger'); optional
alter table inspirations add column if not exists blogger_id uuid references notes(id) on delete set null;
create index if not exists inspirations_blogger_idx on inspirations(blogger_id);

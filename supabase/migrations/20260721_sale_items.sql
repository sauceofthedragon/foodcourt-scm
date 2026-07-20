-- 2026-07-21 実行済み（SQL Editorで直接実行、記録用）
-- 再実行は冪等（create table if not exists / create or replace）

begin;

alter table sales
  add column if not exists discount numeric not null default 0;

create table if not exists sale_items (
  id            uuid        primary key default gen_random_uuid(),
  sale_id       uuid        not null references sales(id)      on delete cascade,
  menu_item_id  uuid                 references menu_items(id) on delete set null,
  item_name     text        not null,
  qty           numeric     not null default 1,
  unit_price    numeric     not null,
  unit_cost     numeric,
  subtotal      numeric     not null,
  created_at    timestamptz not null default now(),
  constraint sale_items_qty_check check (qty > 0)
);

create index if not exists idx_sale_items_sale on sale_items (sale_id);
create index if not exists idx_sale_items_menu on sale_items (menu_item_id);

alter table sale_items enable row level security;

drop policy if exists sale_items_select on sale_items;
drop policy if exists sale_items_insert on sale_items;
drop policy if exists sale_items_update on sale_items;
drop policy if exists sale_items_delete on sale_items;

create policy sale_items_select on sale_items
  for select to authenticated using (true);
create policy sale_items_insert on sale_items
  for insert to authenticated with check (true);
create policy sale_items_update on sale_items
  for update to authenticated using (true) with check (true);
create policy sale_items_delete on sale_items
  for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'sale_items'
  ) then
    execute 'alter publication supabase_realtime add table sale_items';
  end if;
end $$;

commit;
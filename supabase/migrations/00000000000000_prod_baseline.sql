-- フードコート統合管理システム スキーマ（本番プロジェクトから再構成）
--
-- 生成方法についての注記：
-- Docker Desktop未導入のため `supabase db dump --linked` は使用できず、
-- 本番プロジェクトのSQL Editorで以下6種の読み取り専用クエリを実行した結果から
-- 手動で再構成した（2026-07-13時点）。
--   1) information_schema.columns（テーブル・カラム定義）
--   2) information_schema.table_constraints + key_column_usage（制約・FK）
--   3) pg_constraint（CHECK制約の定義）
--   4) pg_tables.rowsecurity（RLS有効化状況）
--   5) pg_policies（RLSポリシー本文）
--   6) pg_proc + pg_get_functiondef（関数定義）
--
-- 以下は「推定」であり、独立したクエリでは未検証：
--   - sales.user_id の参照先（auth.users(id)）: FKの参照先スキーマが auth のため
--     constraint_column_usage ビューでは解決できなかった。auth.uid()をデフォルト値に
--     している挙動と、Supabaseの標準的な運用パターンから auth.users(id) 参照と判断。
--   - インデックス定義: 個別に確認しておらず、既存の supabase/schema.sql の内容を
--     そのまま引き継いでいる（挙動に影響しないため、デモ環境の動作には支障なし）。
--   - Realtime publication設定: 同上、独立確認はしていない。

-- 顧客台帳
create table if not exists customers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone text,
  email text,
  notes text,
  visit_count integer not null default 0,
  created_at timestamptz default now()
);

alter table customers enable row level security;

create policy auth_only on customers
  for all
  to authenticated
  using (true)
  with check (true);

-- 予約管理
create table if not exists reservations (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references customers(id) on delete set null,
  customer_name text not null,
  date date not null,
  time time not null,
  party integer not null default 1,
  table_no text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  notes text,
  created_at timestamptz default now()
);

alter table reservations enable row level security;

create policy auth_only on reservations
  for all
  to authenticated
  using (true)
  with check (true);

-- 在庫管理
create table if not exists inventory (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  category text,
  unit text not null default '個',
  stock numeric not null default 0,
  min_stock numeric not null default 0,
  supplier text,
  unit_cost integer,
  created_at timestamptz default now()
);

alter table inventory enable row level security;

create policy auth_only on inventory
  for all
  to authenticated
  using (true)
  with check (true);

-- 仕入れ記録
create table if not exists purchases (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  item_id uuid references inventory(id) on delete set null,
  item_name text not null,
  qty numeric not null,
  unit_cost integer not null,
  total integer not null,
  supplier text,
  notes text,
  created_at timestamptz default now()
);

alter table purchases enable row level security;

create policy auth_only on purchases
  for all
  to authenticated
  using (true)
  with check (true);

-- 売上記録
create table if not exists sales (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  time time not null,
  amount integer not null,
  pay_method text not null default 'cash' check (pay_method in ('cash', 'card', 'qr', 'other')),
  category text,
  table_no text,
  notes text,
  created_at timestamptz default now(),
  lunch_count integer not null default 0,
  dinner_count integer not null default 0,
  user_id uuid not null default auth.uid() references auth.users(id),
  customer_id uuid references customers(id)
);

alter table sales enable row level security;

create policy "users can manage own records" on sales
  for all
  to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ログインID→メールのマッピング（ログイン画面がIDからメールを引くために使用）
create table if not exists user_profiles (
  user_id text primary key,
  email text not null unique
);

alter table user_profiles enable row level security;

-- anonのSELECTのみ許可。INSERT/UPDATE/DELETEのポリシーは存在しない
-- （クライアントからは作成不可。service_roleキー経由でのみレコードを作成する運用）
create policy "allow anon select" on user_profiles
  for select
  to anon
  using (true);

-- 来店回数の加算（フロント側での二重加算防止のためSECURITY DEFINER RPC経由のみ）
create or replace function public.increment_visit_count(cust_id uuid)
returns void
language sql
security definer
as $function$
  update customers set visit_count = visit_count + 1 where id = cust_id;
$function$;

-- Realtime有効化（推定・未独立検証、既存schema.sqlの記載を引き継ぎ）
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table reservations;
alter publication supabase_realtime add table sales;
alter publication supabase_realtime add table inventory;
alter publication supabase_realtime add table purchases;

-- インデックス（推定・未独立検証、既存schema.sqlの記載を引き継ぎ）
create index if not exists idx_reservations_date on reservations(date);
create index if not exists idx_sales_date on sales(date);
create index if not exists idx_purchases_date on purchases(date);
create index if not exists idx_purchases_item_id on purchases(item_id);

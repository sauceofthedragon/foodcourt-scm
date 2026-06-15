-- フードコート統合管理システム スキーマ

-- 顧客台帳
create table if not exists customers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone text,
  email text,
  notes text,
  visit_count integer default 0,
  created_at timestamptz default now()
);

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
  created_at timestamptz default now()
);

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

-- Realtime有効化
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table reservations;
alter publication supabase_realtime add table sales;
alter publication supabase_realtime add table inventory;
alter publication supabase_realtime add table purchases;

-- インデックス
create index if not exists idx_reservations_date on reservations(date);
create index if not exists idx_sales_date on sales(date);
create index if not exists idx_purchases_date on purchases(date);
create index if not exists idx_purchases_item_id on purchases(item_id);

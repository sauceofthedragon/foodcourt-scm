-- ============================================================
-- 品目マスタ menu_items
-- 2026-07-21 作成 / 35品目
-- 実行先: Supabase SQL Editor
--
-- このスクリプトは何度実行しても同じ結果になる（冪等）。
-- 実行前に、最終行が「commit;」で終わっているか目視確認すること。
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. テーブル定義
-- ------------------------------------------------------------
create table if not exists menu_items (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  category    text        not null,   -- 大カテゴリ: sales.category と同じ語彙を使う
  menu_group  text,                   -- 中カテゴリ: メニュー表の区分。UIのグリッド見出しになる
  price       numeric     not null,   -- 標準売価。入力時に上書き可（明細側にスナップショット保存）
  cost        numeric,                -- 標準原価。未算出の品目は null 可
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,  -- 廃止時は削除せず false にする（過去データ保全）
  created_at  timestamptz not null default now(),
  constraint menu_items_category_check
    check (category in ('フード','ドリンク','アルコール','デザート','セット','テイクアウト','その他'))
);

create index if not exists idx_menu_items_active on menu_items (is_active, sort_order);
create index if not exists idx_menu_items_group  on menu_items (menu_group);

-- ------------------------------------------------------------
-- 2. RLS
--    RLSは「沈黙する門番」。有効化だけしてポリシーを書き忘れると
--    エラーを出さずに空配列が返る。必ずセットで書く。
-- ------------------------------------------------------------
alter table menu_items enable row level security;

drop policy if exists menu_items_select on menu_items;
drop policy if exists menu_items_insert on menu_items;
drop policy if exists menu_items_update on menu_items;
drop policy if exists menu_items_delete on menu_items;

create policy menu_items_select on menu_items
  for select to authenticated using (true);

create policy menu_items_insert on menu_items
  for insert to authenticated with check (true);

create policy menu_items_update on menu_items
  for update to authenticated using (true) with check (true);

create policy menu_items_delete on menu_items
  for delete to authenticated using (true);

-- ------------------------------------------------------------
-- 3. Realtime
--    すでに追加済みの場合はエラーになるため、存在確認してから追加する。
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'menu_items'
  ) then
    execute 'alter publication supabase_realtime add table menu_items';
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. マスタ投入（35品目）
--
--    再実行を安全にするため、投入前に全削除する。
--    ※ sale_items から参照され始めたら、この delete は使えなくなる。
--       以降のマスタ変更は個別の update / insert で行うこと。
--
--    sort_order は10刻み。後から間に挿し込めるようにするため。
-- ------------------------------------------------------------
-- ※2026-07-21、sale_items からの参照が発生済み。この delete は使用不可。
-- ※有効化すると sale_items.menu_item_id が全て null になり、品目別分析が壊れる。
-- delete from menu_items;

insert into menu_items (name, category, menu_group, price, cost, sort_order) values
  -- ランチセット
  ('柚子胡椒香る鶏と九条ネギのパスタ',   'フード',     'ランチセット',        1100,  400,  20),
  ('ベーコンときのこのトマトパスタ',     'フード',     'ランチセット',        1100,  400,  10),
  ('和山椒香るちりめんトマトのパスタ',   'フード',     'ランチセット',        1100,  400,  30),
  ('週替わりパスタ',                     'フード',     'ランチセット',        1200,  500,  40),
  ('牛すじトマト煮とバゲット',           'フード',     'ランチセット',        1200,  400,  50),
  ('牛すじトマト煮カレー',               'フード',     'ランチセット',        1200,  400,  60),

  -- 看板料理
  ('牛すじトマト煮',                     'フード',     '看板料理',            1100,  300,  70),
  ('牛すじトマト煮ハーフ',               'フード',     '看板料理',             800,  150,  80),

  -- タパス
  ('ポテトフライ柚子胡椒ディップ',       'フード',     'タパス',               600,  200,  90),
  ('トマトとアボカドのちりめんカクテル', 'フード',     'タパス',               600,  200, 100),
  ('トマトとレタスの彩サラダ',           'フード',     'タパス',               600,  200, 110),
  ('生ハム',                             'フード',     'タパス',               600,  200, 120),

  -- バゲット
  ('プレーン',                           'フード',     'バゲット',             400,  120, 130),
  ('ガーリック',                         'フード',     'バゲット',             500,  150, 140),
  ('塩昆布',                             'フード',     'バゲット',             500,  200, 150),
  ('アンチョビ',                         'フード',     'バゲット',             500,  200, 160),
  ('トマトとチーズ',                     'フード',     'バゲット',             700,  300, 170),

  -- メイン / スープ / パスタ / デザート
  ('鶏もも肉の熟成昆布締めステーキ',     'フード',     'メイン',              1300,  500, 180),
  ('ビスク',                             'フード',     'スープ',               500,  200, 190),
  ('本日のパスタ',                       'フード',     'パスタ',              1100,  300, 200),
  ('パンナコッタ',                       'フード',     'デザート',             200,   50, 210),

  -- ソフトドリンク
  ('ぶどうジュース',                     'ドリンク',   'ソフトドリンク',       700,  200, 220),
  ('リンゴジュース',                     'ドリンク',   'ソフトドリンク',       700,  200, 230),
  ('トマトジュース',                     'ドリンク',   'ソフトドリンク',       700,  200, 240),

  -- サワー
  ('奇跡のレモンサワー',                 'アルコール', 'サワー',               600,  200, 250),
  ('流石ウーロンハイ',                   'アルコール', 'サワー',               600,  200, 260),

  -- ハイボール
  ('ジンビームハイボール',               'アルコール', 'ハイボール',           600,  200, 270),
  ('V.O.ソーダ割',                       'アルコール', 'ハイボール',           600,  200, 280),

  -- ビール
  ('サッポロラガー',                     'アルコール', 'ビール',               700,  340, 290),
  ('スーパードライ',                     'アルコール', 'ビール',               700,  340, 300),
  ('コロナビール',                       'アルコール', 'ビール',               700,  280, 310),

  -- ワイン
  ('赤ワイン',                           'アルコール', 'ワイン',               700,  150, 320),
  ('白ワイン',                           'アルコール', 'ワイン',               700,  150, 330),

  -- スパークリングワイン
  ('SWボトル',                           'アルコール', 'スパークリングワイン', 3500, 1100, 340),
  ('SWハーフ',                           'アルコール', 'スパークリングワイン', 2000,  800, 350);

commit;

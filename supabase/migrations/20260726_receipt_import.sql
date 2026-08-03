-- ============================================================================
-- 領収証取り込み・原価率分析の基盤（2026-07-26 / rev.2）
-- ============================================================================
--
-- rev.1 からの変更点:
--   目的が「仕入データの取り込み」から「売上に対する原価の把握」に確定したため、
--   (a) purchases.cost_category（原価区分）を追加
--   (b) inventory_counts（月末簡易棚卸）テーブルを追加
--   を含めた。rev.1 を未実行の場合は、このファイルだけを実行すればよい。
--
-- 目的:
--   領収証画像1枚を purchase_receipts の1行（＝会計上の1取引）として保持し、
--   明細行を purchases に子として持たせる。
--   さらに月末棚卸を持たせることで、仕入額ではなく「売上原価」を算出できるようにする。
--
-- 設計上の確定事項（変更する場合はこのコメントも同時に更新すること）:
--
--   1. source_file_id の UNIQUE 制約が「二重取り込み防止の本体」である。
--      Drive側のファイル名リネーム（済_ 接頭辞）や 90_取込済 への移動は
--      人間向けの目印であって、防止機構ではない。
--      リネームや移動が失敗しても、DBが二重投入を弾く。
--
--   2. OCR経由で作られる purchases 行は item_id = NULL 固定。
--      inventory への在庫加算は「人が品目を選んだとき」だけ発生する
--      （既存 app/inventory/page.tsx の在庫連動ロジックがそのまま働く）。
--      品目の自動マッチングは、誤爆時に別品目の在庫を静かに壊し、
--      かつ誰も気づけない（SPEC 8章「沈黙する失敗」と同じ様式）。
--
--   3. ただし cost_category（原価区分）は OCR に推定させてよい。
--      item_id と違い、誤っても壊れるのは「ラベル1つ」であり、
--      一覧を見れば気づけて、選び直すだけで直る。可逆かつ可視。
--      item_id は「状態」を壊すが、cost_category は「分類」しか変えない。
--
--   4. 明細合計と請求合計の差額（消費税・値引き）は親テーブルで吸収する。
--      purchases に「消費税」という名前のノイズ行を作らない。
--
--   5. OCRに失敗した画像は purchase_receipts に行を作らない。
--      00_未取込 に残したまま画面へエラー報告し、人が判断する。
--      よって ocr_status に 'failed' は存在しない。
--
--   6. 売上原価 = 前月末棚卸 + 当月仕入 − 当月末棚卸。
--      棚卸が入っていない月は仕入額での近似にフォールバックする。
--      この2つは意味が違うので、画面上でどちらを見ているか必ず明示すること。
--
-- 実行方法: Supabase SQL Editor に全文貼り付けて実行。
--           貼り付け後、最終行が「commit;」で終わっていることを目視確認すること。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. 親テーブル: 領収証1枚 = 1行
-- ----------------------------------------------------------------------------
create table if not exists purchase_receipts (
  id uuid primary key default gen_random_uuid(),

  -- レシート本体
  date       date not null,                 -- 領収日（レシート記載の日付）
  supplier   text,                          -- 仕入先名
  subtotal   integer,                       -- 明細の合計（レシート記載どおり）
  tax        integer,                       -- 消費税額
  discount   integer,                       -- 値引き額（正の数で保持する）
  total      integer not null,              -- 実際の支払額（レシート上の合計）
  pay_method text,
  notes      text,

  -- 原本（Google Drive）への参照
  source_file_id   text not null,           -- Drive の fileId。二重取り込み防止のキー
  source_file_name text,                    -- 取り込み時点のファイル名
  source_url       text,                    -- Drive の閲覧URL（画面から原本を開く）

  -- OCRの監査証跡（後から精度検証・再処理するために生出力を保持）
  ocr_raw    jsonb,
  ocr_model  text,
  ocr_status text not null default 'ok',

  imported_at timestamptz not null default now(),
  user_id     uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),

  constraint purchase_receipts_pay_method_check
    check (pay_method is null or pay_method in ('cash', 'card', 'qr', 'other')),
  constraint purchase_receipts_ocr_status_check
    check (ocr_status in ('ok', 'partial'))
);

-- ★二重取り込み防止の本体。この制約を外さないこと。
create unique index if not exists uq_purchase_receipts_source_file_id
  on purchase_receipts (source_file_id);

create index if not exists idx_purchase_receipts_date
  on purchase_receipts (date);

-- RLS（CLAUDE.md「全テーブルにRLS有効化が必須」に従う）
-- 既存 purchases の auth_only ポリシーと同一方針に揃える。
alter table purchase_receipts enable row level security;

drop policy if exists auth_only on purchase_receipts;
create policy auth_only on purchase_receipts
  for all
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- 2. 子: purchases を明細行として親に紐付け、原価区分を持たせる
-- ----------------------------------------------------------------------------
alter table purchases add column if not exists receipt_id    uuid;
alter table purchases add column if not exists line_no       integer;
alter table purchases add column if not exists tax_rate      numeric;
alter table purchases add column if not exists cost_category text;

-- 原価区分。NULL は「未分類」であり、集計時に必ず別枠で可視化すること。
-- 黙って原価に含めても、黙って除外しても、どちらも判断を誤らせる。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchases_cost_category_check'
  ) then
    alter table purchases
      add constraint purchases_cost_category_check
      check (cost_category is null or cost_category in ('food', 'supply', 'equipment', 'other'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchases_receipt_id_fkey'
  ) then
    alter table purchases
      add constraint purchases_receipt_id_fkey
      foreign key (receipt_id) references purchase_receipts(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_purchases_receipt_id
  on purchases (receipt_id);
create index if not exists idx_purchases_cost_category
  on purchases (cost_category);

comment on column purchases.receipt_id is
  '領収証取り込み由来の明細行が参照する親レシート。手入力の仕入れはNULL。';
comment on column purchases.line_no is
  'レシート内の明細順序（1始まり）。手入力の仕入れはNULL。';
comment on column purchases.tax_rate is
  '税率区分（8 または 10）。弥生青色申告CSV連携で使用予定。不明時はNULL。';
comment on column purchases.cost_category is
  'food=食材/飲料/調味料, supply=包材/消耗品, equipment=備品, other=その他。'
  'NULL=未分類（集計時は別枠表示すること）。原価率の分子は food のみ、'
  'または food+supply の2モードで切り替える。';

-- 既存データのバックフィル: item_id が付いている行は inventory.category から引ける
update purchases p
set cost_category = case i.category
    when '食材'   then 'food'
    when '飲料'   then 'food'
    when '調味料' then 'food'
    when '消耗品' then 'supply'
    when '備品'   then 'equipment'
    else 'other'
  end
from inventory i
where p.item_id = i.id
  and p.cost_category is null;

-- item_id が無い過去行は分類できないため NULL のまま残す。
-- 画面に「未分類」として出し、けーたが後から潰す。推測で埋めない。

-- ----------------------------------------------------------------------------
-- 3. 月末簡易棚卸
-- ----------------------------------------------------------------------------
-- 月ごと・原価区分ごとに在庫金額の総額を1行だけ持つ。
-- 通常運用では food の1行を月末に入れれば足りる。
-- supply を入れない月は、その区分は仕入額での近似にフォールバックする。
create table if not exists inventory_counts (
  id uuid primary key default gen_random_uuid(),

  month         date    not null,   -- 対象月。必ず「その月の1日」に正規化して保存する
  cost_category text    not null,   -- 'food' | 'supply' | 'equipment' | 'other'
  amount        integer not null,   -- 月末時点の在庫金額（税込・円）
  counted_on    date,               -- 実際に数えた日（月末とずれた場合の記録用）
  notes         text,

  user_id    uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_counts_cost_category_check
    check (cost_category in ('food', 'supply', 'equipment', 'other')),
  constraint inventory_counts_month_is_first_day
    check (date_trunc('month', month)::date = month),
  constraint inventory_counts_amount_non_negative
    check (amount >= 0)
);

create unique index if not exists uq_inventory_counts_month_category
  on inventory_counts (month, cost_category);

alter table inventory_counts enable row level security;

drop policy if exists auth_only on inventory_counts;
create policy auth_only on inventory_counts
  for all
  to authenticated
  using (true)
  with check (true);

comment on table inventory_counts is
  '月末簡易棚卸。売上原価 = 前月末棚卸 + 当月仕入 − 当月末棚卸 の算出に使う。'
  '棚卸が無い月は仕入額での近似にフォールバックするため、画面で必ず区別して表示すること。';

-- ----------------------------------------------------------------------------
-- 4. Realtime（既存の purchases / inventory と揃える）
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table purchase_receipts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table inventory_counts;
exception when duplicate_object then null;
end $$;

commit;


-- ============================================================================
-- 実行後の確認手段（CLAUDE.md 絶対ルール1に従い、必ず実行して結果を確認すること）
-- ============================================================================

-- 確認1: purchase_receipts の列構成
--   期待: 18列前後。source_file_id が not null で存在する
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'purchase_receipts' ORDER BY ordinal_position;

-- 確認2: purchases に4列が足されたか
--   期待: receipt_id / line_no / tax_rate / cost_category の4行が返る
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'purchases'
--   AND column_name IN ('receipt_id', 'line_no', 'tax_rate', 'cost_category');

-- 確認3: RLSが3テーブルとも有効か
--   期待: purchase_receipts と inventory_counts の rowsecurity が true
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' ORDER BY tablename;

-- 確認4: ★二重取り込み防止のUNIQUE制約が実際に効くか
--   期待: 1本目は成功、2本目が duplicate key エラーで落ちる
--   ※ ここが落ちなければ、この機能の安全性の土台が無い。先に進まないこと
--   ※ 確認後は必ず DELETE まで実行すること
-- INSERT INTO purchase_receipts (date, total, source_file_id)
--   VALUES ('2026-07-26', 1000, '__dup_test__');
-- INSERT INTO purchase_receipts (date, total, source_file_id)
--   VALUES ('2026-07-26', 2000, '__dup_test__');   -- ← ここで落ちれば正常
-- DELETE FROM purchase_receipts WHERE source_file_id = '__dup_test__';

-- 確認5: 既存の仕入れデータが壊れていないか、バックフィルがどこまで効いたか
--   期待: total_rows は移行前と同じ。unclassified が「item_idが無かった行数」と一致する
-- SELECT count(*)                                   AS total_rows,
--        count(*) FILTER (WHERE cost_category IS NOT NULL) AS classified,
--        count(*) FILTER (WHERE cost_category IS NULL)     AS unclassified,
--        count(receipt_id)                          AS from_receipt
-- FROM purchases;

-- 確認6: バックフィルの区分内訳が実感と合うか
-- SELECT cost_category, count(*), sum(total)
-- FROM purchases GROUP BY cost_category ORDER BY cost_category;

-- 確認7: 棚卸テーブルが「月初日」しか受け付けないか
--   期待: 1本目は成功、2本目が check 制約違反で落ちる
--   ※ 確認後は必ず DELETE まで実行すること
-- INSERT INTO inventory_counts (month, cost_category, amount)
--   VALUES ('2026-07-01', 'food', 120000);
-- INSERT INTO inventory_counts (month, cost_category, amount)
--   VALUES ('2026-07-31', 'food', 120000);   -- ← ここで落ちれば正常
-- DELETE FROM inventory_counts WHERE month = '2026-07-01' AND cost_category = 'food';

# フードコート統合管理システム 仕様書

現行コードベース（2026-07-21時点）を解析して起こした仕様書。ソースコードが正であり、本書はその写像。仕様変更時はコードとあわせて本書も更新すること。

**改訂履歴**
| 日付 | 内容 |
|---|---|
| 2026-07-11 | 初版（コードベース解析） |
| 2026-07-21 | リピート分析機能を反映（6章にVIEW/RPC追加、7.3・7.6を改訂、8章を再構成） |
| 2026-07-23 | 分析ページ改修を反映（7.6: 売上セクションの折れ線グラフ「売上推移」を削除、来客数トレンドを折れ線→積み上げ棒グラフに変更しゼロ埋め仕様を明記。8章: 1000行制限の実測値と来客数トレンド月別表示の閾値を追記） |

## 1. 概要

飲食店（フードコート系）向けの店舗運営管理Webアプリ。予約・顧客・売上・在庫・分析の5機能を1つのダッシュボードに統合し、店舗スタッフがタブレット/スマホ/PCから日々の業務を記録・閲覧する。

- アプリ名（画面表示）: 「ソースオブザドラゴン管理システム」（ログイン画面表記は「Source of the Dragon」）
- ページタイトル（メタデータ）: 「フードコート管理システム」

## 2. 技術スタック

| 分類 | 技術 | バージョン |
|---|---|---|
| フレームワーク | Next.js (App Router) | ^16.2.9 |
| UI | React | ^18 |
| DB/BaaS | Supabase (PostgreSQL + Auth + Realtime) | @supabase/supabase-js ^2.44.4, @supabase/ssr ^0.4.0 |
| スタイリング | Tailwind CSS | ^3.4.1 |
| グラフ | Recharts | ^3.8.1 |
| 日付処理 | date-fns（日本語ロケール対応） | ^3.6.0 |
| アイコン | lucide-react | ^0.400.0 |
| クラス結合 | clsx | ^2.1.1 |
| 言語 | TypeScript | ^5 |

全ページに `'use client'` および `export const dynamic = 'force-dynamic'` を付与し、クライアントサイドでSupabaseから直接データ取得する構成（サーバーコンポーネントは実質未使用）。

## 3. ディレクトリ構成

```
app/
  layout.tsx              - ルートレイアウト（Navigation + InactivityGuard を全ページに適用）
  page.tsx                - ダッシュボード（/）
  login/page.tsx           - ログイン画面（/login）
  reservations/page.tsx    - 予約管理（/reservations）
  customers/page.tsx       - 顧客台帳（/customers）
  sales/page.tsx           - 売上記録（/sales）
  inventory/page.tsx       - 在庫管理（/inventory、仕入れ記録タブ内包）
  analytics/page.tsx       - 売上分析（/analytics）
  api/auth/login/route.ts  - 廃止済み（410 Gone を返すのみ）
  api/auth/logout/route.ts - ログアウトAPI（サーバー側でsignOut）
components/
  Navigation.tsx           - サイドバー（PC）/ボトムナビ（モバイル）
  InactivityGuard.tsx      - 30分無操作で自動ログアウト
lib/
  supabase.ts               - 後方互換用Proxyベース遅延初期化クライアント（既存ページが使用）
  supabase/client.ts         - ブラウザ用クライアント生成関数（新規コード向け）
  supabase/server.ts         - サーバー用クライアント生成関数（セッションCookie化処理あり）
  database.types.ts          - テーブル型定義
proxy.ts                    - Next.js Middleware相当（認証ガード、旧middleware.tsから移行）
supabase/schema.sql          - DBスキーマ定義（※実データベースと差分あり、6章参照）
```

## 4. 認証・セキュリティ仕様

- 認証基盤: Supabase Auth（メール+パスワード方式）
- ログインUI: ユーザーは「ID」でログインするが、内部的には `user_profiles` テーブル（`user_id` → `email` のマッピング）を引いてから `supabase.auth.signInWithPassword({ email, password })` を呼ぶ2段階方式（`app/login/page.tsx`）
  - **注意**: `user_profiles` テーブルは `supabase/schema.sql` に定義がなく、Supabase側で別途作成されている（スキーマファイル未反映）
- ルート保護: `proxy.ts`（Next.js Middleware）が全リクエストを横取りし、`supabase.auth.getUser()` でJWT検証
  - 未ログイン かつ `/login` 以外 → `/login` にリダイレクト
  - ログイン済み かつ `/login` → `/` にリダイレクト
  - 除外パス: `_next/static`, `_next/image`, `favicon.ico`, `api/auth`
  - `getSession()` ではなく `getUser()` を使用（ネットワーク検証を伴うため安全、とコード内コメントあり）
- 自動ログアウト: `InactivityGuard`（`components/InactivityGuard.tsx`）が `mousemove/keydown/click/scroll/touchstart` を監視し、30分無操作で `signOut()` → `/login` に遷移
- ログアウトAPI: `app/api/auth/logout/route.ts` がサーバー側で `signOut()` を実行
- 旧ログインAPI（`app/api/auth/login/route.ts`）は廃止済みで `410 Gone` を返すのみ。実際の認証はクライアントから直接Supabase Authを呼ぶ方式に統一されている

## 5. 共通コンポーネント

### Navigation（components/Navigation.tsx）
- PC（`md`以上）: 左固定サイドバー、幅56（Tailwind `w-56`）
- モバイル: 画面下部固定ナビ
- メニュー項目: ダッシュボード / 予約 / 顧客台帳 / 売上 / 在庫 / 分析（6項目、対応ルートは3章参照）
- 現在ページを `usePathname()` で判定しオレンジ色でハイライト

### InactivityGuard
- 4章参照。ログイン画面ではセッションが無いため何もしない

## 6. データベーススキーマ

### schema.sqlに定義されたテーブル

| テーブル | 主な列 | 説明 |
|---|---|---|
| `customers` | id, name, phone, email, notes, visit_count, created_at | 顧客台帳 |
| `reservations` | id, customer_id(FK→customers, on delete set null), customer_name, date, time, party, table_no, status, notes, created_at | 予約。`status` は `confirmed/cancelled/completed/no_show` のCHECK制約 |
| `sales` | id, date, time, amount, pay_method, category, table_no, notes, created_at | 売上。`pay_method` は `cash/card/qr/other` のCHECK制約 |
| `inventory` | id, name, category, unit, stock, min_stock, supplier, unit_cost, created_at | 在庫品目。`stock`/`min_stock` は numeric（小数可） |
| `purchases` | id, date, item_id(FK→inventory, on delete set null), item_name, qty, unit_cost, total, supplier, notes, created_at | 仕入れ記録 |

- 全テーブルで Realtime（`supabase_realtime` publication）が有効
- インデックス: `reservations(date)`, `sales(date)`, `purchases(date)`, `purchases(item_id)`

### ⚠️ schema.sqlと実装(コード)の不整合

以下はアプリコードが参照しているが `schema.sql` に定義がない列・テーブル・RPC。Supabase上で直接追加された可能性が高く、**このファイルだけを見て別環境を再構築すると機能しない**。

| 種別 | 名前 | 参照箇所 | 内容 |
|---|---|---|---|
| テーブル | `user_profiles` | `app/login/page.tsx` | `user_id` → `email` のログインID解決に使用 |
| RPC関数 | `increment_visit_count(cust_id)` | `app/sales/page.tsx` | 売上登録時に顧客の来店回数を加算（コミット「顧客来店数の自動加算機能」に対応） |
| sales列 | `customer_id` | `app/sales/page.tsx` | 売上と顧客の紐付け（`database.types.ts`のSale型にも未定義、`(s as any).customer_id`でキャストして参照） |
| sales列 | `user_id` | `app/sales/page.tsx` | 登録操作を行ったユーザーのID |
| sales列 | `lunch_count`, `dinner_count` | `app/sales/page.tsx`, `app/analytics/page.tsx` | ランチ/ディナー来客数（`database.types.ts`には型定義あり、`schema.sql`には列定義なし） |

### VIEW / RPC（2026-07-21 追加分）

すべて `security invoker`（＝アプリユーザーの権限で動作し、RLSを迂回しない）で定義。**いずれも読み取り専用で、書き込みは行わない**。

| 種別 | 名前 | 参照画面 | 返却/内容 |
|---|---|---|---|
| VIEW | `customer_stats` | `/customers` | `customer_id, first_visit_date, last_visit_date, actual_visit_count, total_amount`。`customers` に `sales` を `left join` して顧客ごとに集約 |
| RPC | `visit_composition(p_start date, p_end date)` | `/analytics` | `new_sales, repeat_sales, total_sales`。`sales.customer_id is null` を新規、`not null` をリピートとして会計件数を数える |
| RPC | `repeat_metrics(p_start date, p_end date)` | `/analytics` | `visitors, repeaters, returning_customers, linked_sales, total_sales, new_visitors, new_repeaters`。うち `returning_customers` / `linked_sales` は**現在どの画面からも参照されていない**（定義変更で不要化したが、再検討時に備え関数側は残置） |

`customer_stats` VIEW 定義：

```sql
create or replace view customer_stats
with (security_invoker = on)
as
select
  c.id                       as customer_id,
  min(s.date)                as first_visit_date,
  max(s.date)                as last_visit_date,
  count(s.id)                as actual_visit_count,
  coalesce(sum(s.amount), 0) as total_amount
from customers c
left join sales s on s.customer_id = c.id
group by c.id;
```

**注意**: これらも `supabase/schema.sql` に未反映。8章参照。

### database.types.ts 上の型定義

`Sale` 型など `lib/database.types.ts` の型は上記の一部不整合を先取りして反映済み（`lunch_count`/`dinner_count`はoptionalで定義済みだが`customer_id`/`user_id`は未定義）。型定義・schema.sql・実DBの3者で世代がずれている状態。

## 7. 画面仕様

### 7.1 ダッシュボード（`/`, `app/page.tsx`）

本日の状況を一覧できるホーム画面。

- 上部: 今日の日付（例: 7月11日(金)）
- サマリーカード（2×2グリッド、各カードはリンクで該当ページへ遷移）
  - 本日の予約件数（`reservations`を`date=今日` かつ `status≠cancelled`で件数取得）
  - 本日の売上合計（`sales`を`date=今日`で取得しamount合計）
  - 登録顧客数（`customers`の全件数）
  - 在庫不足品目数（`inventory`全件のうち `stock <= min_stock`）
- 本日の予約リスト（直近5件、時間順）: 顧客名・人数・卓番・時刻
- 本日の売上明細（直近5件、時刻降順）: カテゴリ・時刻・支払方法・金額
- 在庫不足アラート（該当がある場合のみ表示、最大5件）: 品目名・現在庫/最低在庫
- Realtime購読: `reservations`, `sales`, `inventory` の変更を監視し自動再取得

### 7.2 予約管理（`/reservations`）

- 一覧: 日付フィルタ（デフォルト今日）+ 顧客名の部分一致検索（クライアント側フィルタ）
- 予約カードクリックで編集モーダルを開く
- 新規/編集フォーム項目: 顧客名*, 日付*, 時間*, 人数, テーブルNo., ステータス（確定/キャンセル/完了/ノーショー）, メモ
- 削除: 一覧上の×ボタン → `confirm()` ダイアログ後に削除
- Realtime購読: `reservations` テーブル全体
- 備考: 保存時 `customer_id` は常に `null` で送信（顧客台帳との紐付けは行われない = 売上側の顧客連携とは非対称な実装）

### 7.3 顧客台帳（`/customers`）

- 一覧: 名前・電話・メールの部分一致検索、件数表示
- 来店5回以上で★アイコン表示
- **最終来店日**: `customer_stats` VIEW の `last_visit_date` を表示（＝顧客に紐付いた `sales` の最新日付）
- **来店頻度**（回/月）: `visit_count ÷ 経過月数` を表示
  - 経過月数は `customers.created_at` を起点とし、30.44日 = 1ヶ月で換算
  - 分母は最低1ヶ月に切り上げ（登録直後の値が発散しないため）
  - `visit_count <= 1` または登録から1ヶ月未満の場合は `—` を表示
- カードクリックで詳細モーダル（電話は`tel:`リンク、メールは`mailto:`リンク、来店回数、登録日）
- 詳細モーダルから編集・削除が可能
- 新規/編集フォーム項目: 名前*, 電話番号, メールアドレス, 来店回数, メモ
- Realtime購読: `customers` テーブル全体

### 7.4 売上記録（`/sales`）

- 一覧: 日付フィルタ（デフォルト今日）+ カテゴリフィルタ（フード/ドリンク/アルコール/デザート/セット/テイクアウト/その他）
- サマリーカード: 選択日の売上合計、支払方法別内訳、件数
- 新規登録フォーム項目: 金額*, 日付, 時間, 支払方法（現金/カード/QR決済/その他、ボタン選択式）, カテゴリ, ランチ人数, ディナー人数, テーブルNo., 顧客（プルダウン、任意）, メモ
- **新規登録時のみ**、顧客を選択していれば `increment_visit_count` RPCを呼び、その顧客の`visit_count`をインクリメント（編集時は加算しない = 二重加算防止のロジック）
- 編集: 一覧上の鉛筆アイコンから同じフォームを再利用、保存時は`update`
- 削除: ×ボタン → `confirm()` 後削除
- Realtime購読: `sales` テーブル全体
- ログインユーザーIDを`supabase.auth.getUser()`で取得し、保存時に`user_id`として付与

### 7.5 在庫管理（`/inventory`）

タブ切り替え式で「在庫一覧」と「仕入れ記録」を1画面に統合。

**在庫一覧タブ**
- カテゴリフィルタ（食材/飲料/調味料/消耗品/備品/その他）
- 在庫不足（`stock <= min_stock`）の品目がある場合、赤いアラートボタンで絞り込み表示を切替可能
- 品目カードクリックで編集モーダル、×ボタンで削除
- フォーム項目: 品目名*, カテゴリ, 単位, 現在在庫数, 最低在庫数, 仕入先, 単価

**仕入れ記録タブ**
- 直近100件を日付降順で表示
- 「仕入」ボタンから新規登録、各行の鉛筆アイコンから編集
- フォーム項目: 日付, 在庫品目選択（プルダウン、選ぶと品目名・単価・仕入先を自動補完）, 品目名*（直接入力も可）, 数量*, 単価*, 仕入先, メモ
- 数量×単価の合計を登録前にリアルタイム表示
- **在庫連動ロジック**（在庫管理の中核）:
  - 新規登録時: 選択した品目の`stock`に数量を加算
  - 編集時（品目が同じ場合）: 数量の差分（新qty − 旧qty）だけ`stock`を増減
  - 編集時（品目を変更した場合）: 旧品目の`stock`から旧数量を減算 → 新品目の`stock`に新数量を加算
  - 品目未選択（自由入力のみ）の仕入れは在庫数に反映されない
- Realtime購読: `inventory`, `purchases`（`purchases`変更時は両方を再取得）

### 7.6 売上分析（`/analytics`）

グラフによる可視化専用画面。3つの独立したセクションを持つ（上から「売上」→「リピート分析」→「来客数トレンド」）。

**売上セクション**
- 表示切替: 日別（月選択）/ 月別（直近12ヶ月固定）
- サマリー4カード: 期間合計売上、平均売上（売上のあった日/月のみで平均）、取引件数、最高売上日/月
- 棒グラフ（日別/月別売上）
- カテゴリ別円グラフ（日別表示時のみ、割合%と金額を凡例に併記）

**リピート分析セクション**（売上セクションと来客数トレンドの間に配置）
- 月選択UI（デフォルト今月）。データは `visit_composition` / `repeat_metrics` RPCから取得
- 表示順: 月選択 → 会計構成バー → カード3枚 → 注記

| 表示要素 | 定義 | 出所 |
|---|---|---|
| 会計構成バー（主役） | 新規件数 / リピート件数を横バーで構成比表示 | `visit_composition` |
| 会計リピート率 | `repeat_sales ÷ total_sales`（会計＝組ベース） | `visit_composition` |
| 期間内リピート率 | `repeaters ÷ visitors`（顧客の実人数ベース） | `repeat_metrics` |
| 新規リピーター転換率 | `new_repeaters ÷ new_visitors` | `repeat_metrics` |

- 画面注記: 「※ 顧客未紐付けの会計を新規として集計しています」

**「未紐付け = 新規」とする定義について（意思決定の記録）**

`sales.customer_id` が `null` の会計を「新規」として集計している。根拠は「顧客レコードが存在する時点で、その人は過去に一度は来店し登録されている」という運用実態。

この定義から必然的に導かれること：
- 「リピート率」と「顧客紐付け率」は**定義上つねに同一の数値になる**。そのため紐付け率カード・既存顧客比率カードは意図的に設置していない（同じ数字を2箇所に出すと後から誤解を生むため）
- 登録済み常連の会計で顧客を選び忘れると「新規」に計上されるため、**新規が実態より多めに出る癖**を持つ。裏返しとして新規リピーター転換率は**低めに出る癖**を持つ
- 現在ワンオペのため入力の癖が一人分に閉じ、月次比較の一貫性は保たれる。**複数スタッフ体制になると人による紐付け率の差でこの前提が崩れる**
- 紐付け運用を改善すると、顧客行動が変化していなくてもリピート率が上昇する。指標の変動要因を切り分けるには紐付け率を別途（画面外で）追跡する必要がある

**来客数トレンドセクション**（売上セクションとは独立したstate/データ取得）
- 表示切替: 日別（月選択）/ 月別（年選択、直近5年分をプルダウン提供）
- `sales.lunch_count` / `dinner_count` を集計
- サマリー3カード: **延べ来店数**、ランチ計、ディナー計
- 積み上げ棒グラフ（ランチ=下段/青、ディナー=上段/オレンジ）。積み上げの合計はサマリーカードの「延べ来店数」と一致する
  - 2026-07-23、折れ線グラフから変更。理由：ディナーが平日ほぼ0件（営業実態であり入力漏れではない）のため、横並び棒だと大半が高さ0で空隙が並び読みにくい。積み上げなら1日1本で読める
- ゼロ埋め仕様: 日別表示は月初〜月末の全日、月別表示は1〜12月の全月を配列生成し、データが無い日/月は `lunch=0` / `dinner=0` で埋める（棒グラフは折れ線と異なり欠測日が非表示になるため必須）。定休日（火曜）は積み上げが0の空白バーとして表示される想定通りの挙動
- **「来店総数」から「延べ来店数」に表記変更済み**。リピート分析の会計件数（組）と単位が異なることを明示するため
- セクション名「来客数トレンド」は内部カードの「延べ来店数」と語が割れているが、意図的に据え置き（2026-07-23時点でのオーナー判断）。将来ラベルを統一する場合は「延べ来店数」への統一を推奨

**単位の非互換について（既知の限界）**

「今月の来店◯人のうち何人が新規か」は**現在の設計では算出できない**。

| | 延べ来店数 | リピート分析の数値 |
|---|---|---|
| 出所 | `lunch_count + dinner_count` | `sales.customer_id` / 会計行 |
| 単位 | 延べ来店人数 | 識別された実人数 / 会計組数 |

紐付いた会計でも `customer_id` は代表者1名分のみ。4名組で来店した場合、同伴3名は延べ来店数には入るが顧客識別には入らない。**延べ来店数から人数ベースの内訳を導く経路が存在しない。** 会計（組）単位の分析に統一する方針を採り、人数ベースの内訳は現時点で断念している（既存データで完結し過去分も遡及できるため）。

## 8. 既知の課題・要検証事項

### 優先度: 高

- **Supabaseのデフォルト1000行制限による「沈黙する失敗」**: Supabaseのクエリはデフォルトで最大1000行しか返さない。売上を全件取得してJS側で集計する実装は、対象行数が1000を超えた瞬間に**エラーも警告も出ないまま集計値が壊れる**（RLS未設定時と同じ失敗様式）。
  - リピート分析セクションはVIEW/RPCでDB側集計しているため構造的に発生しない
  - **7.6の売上セクション・来客数トレンドは未対策**。月間の`sales`行数が1000件を超えた時点で顕在化する。同じ手法（RPC化）で移行可能
  - **2026-07-23実測によるRPC化の緊急度判定**: 現状は月間42〜51行（2026-06:51行、2026-07:42行）で1000行の桁からは遠く、日別表示（月単位取得）は今回RPC化不要と判断。ただし**来客数トレンドの月別表示は年選択で1年分（12ヶ月合算）を取得するため、月平均83件／年で1000行に到達する**。現在の月51件基準では約1.6倍の増加で閾値に到達するため、この経路のみ優先度が高い。日別表示は月1000会計が必要で当面無関係
- **schema.sqlの陳腐化**: 6章記載の通り、`user_profiles`テーブル・`increment_visit_count`関数・`sales`の`customer_id`/`user_id`/`lunch_count`/`dinner_count`列、および今回追加した`customer_stats` VIEW・`visit_composition`/`repeat_metrics` RPCがスキーマファイルに存在しない。別環境構築や障害復旧時に`schema.sql`だけでは不十分。**Supabase上の実スキーマをダンプしてファイルを同期することを推奨**

### 優先度: 中

- **`/sales` の顧客紐付けが任意プルダウン**: 現在の紐付け率は約46%。7.6の定義上、紐付け率の低さが即座に指標を壊すわけではないが、入力設計の問題であり精神論では改善しない
- **`repeat_metrics` の未使用列**: `returning_customers` / `linked_sales` が画面から参照されていない。将来的に削除するか用途を確定するか要判断

### 優先度: 低 / 積み残し
- **予約と顧客の非連携**: 予約作成時`customer_id`は常に`null`固定。売上では顧客と紐付けて来店回数を自動加算する仕組みがあるが、予約側には同等の仕組みがない
- **在庫連動は仕入れ記録のみ**: 販売による在庫減少ロジックは存在しない（`sales`登録時に`inventory.stock`を減算する処理が無い）。在庫は「仕入れ」でのみ増加し、実消費と連動していない
- **型定義とschema.sqlの世代差**: `database.types.ts`は一部（`lunch_count`/`dinner_count`）を先取りしているが`customer_id`/`user_id`/`customer_stats`は未反映。`lib/supabase.ts` のクライアントが型なしのため実害は出ていないが、負債として残存

## 9. 開発上の注意点（実測で確立したもの）

- **Vercelは GitHub からビルドする**: ローカル修正は `git add → commit → push` しない限り本番に反映されない
- **環境変数は二重管理**: `.env.local`（ローカル）と Vercelダッシュボード（本番）は完全に別系統
- **SQL Editorで動いてもアプリで動くとは限らない**: SQL Editorは管理者権限で実行される。RLSの実効確認は必ずアプリからの実機テストで行う
- **`create or replace function` は戻り値の列構成を変更できない**: `drop function if exists 関数名(引数型);` してから作り直す
- **Tailwindの動的クラス名は効かない**: ビルド時にパージされるため、幅などの可変指定は `style={{ width: '53.8%' }}` のようにインラインstyleで書く
- **長いSQLのコピー漏れ**: 途中で切れて貼ると `as $$` 付近で構文エラーになる。コピーボタンを使い、実行前に最終行が `$$;` で終わっているか目視確認する
- **`.update()` には `.eq()` が必須**: 省略すると全行更新の危険がある
- **Windowsのファイル書き込み**: CMDの `echo` はBOM/Shift-JISで文字化けを起こす。ファイル作成・編集はすべてClaude Code経由で行う

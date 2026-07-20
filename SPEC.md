# フードコート統合管理システム 仕様書

現行コードベース（2026-07-11時点）を解析して起こした仕様書。ソースコードが正であり、本書はその写像。仕様変更時はコードとあわせて本書も更新すること。

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
| `sales` | id, date, time, amount, pay_method, category, table_no, notes, created_at, lunch_count, dinner_count, user_id(FK→auth.users, not null, default auth.uid()), customer_id(FK→customers) | 売上。`pay_method` は `cash/card/qr/other` のCHECK制約 |
| `inventory` | id, name, category, unit, stock, min_stock, supplier, unit_cost, created_at | 在庫品目。`stock`/`min_stock` は numeric（小数可） |
| `purchases` | id, date, item_id(FK→inventory, on delete set null), item_name, qty, unit_cost, total, supplier, notes, created_at | 仕入れ記録 |
| `user_profiles` | user_id(text, PK), email(text, unique) | ログインID→メールのマッピング（`app/login/page.tsx`が使用） |

- 全テーブルで Realtime（`supabase_realtime` publication）が有効
- インデックス: `reservations(date)`, `sales(date)`, `purchases(date)`, `purchases(item_id)`
- 全6テーブルでRLS有効化済み。`customers`/`reservations`/`inventory`/`purchases`は`authenticated`ロールなら全操作可（`auth_only`ポリシー）、`sales`は`auth.uid() = user_id`の行のみ操作可、`user_profiles`は`anon`ロールへの`SELECT`のみ許可（INSERT/UPDATE/DELETEポリシーは無く、service_role経由でのみレコード作成可能）
- RPC関数 `increment_visit_count(cust_id uuid)`（`SECURITY DEFINER`）: 売上登録時の来店回数加算に使用。フロント側では計算せずRPC経由のみで加算する設計（二重加算防止）

### schema.sqlと実装(コード)の整合性（2026-07-13時点で確認・同期済み）

2026-07-13、本番Supabaseプロジェクトのスキーマを読み取り専用クエリ（`information_schema`/`pg_catalog`）で照合し、`supabase/schema.sql`を実態に同期した（旧版で未反映だった`user_profiles`テーブル、`increment_visit_count`RPC、`sales`の`customer_id`/`user_id`/`lunch_count`/`dinner_count`列、RLSポリシー全般を反映済み）。詳細な照合過程・推定に留まる項目（`sales.user_id`の参照先テーブル、インデックス定義、Realtime publication設定は独立検証できず既存記載を引き継ぎ）は`supabase/migrations/00000000000000_prod_baseline.sql`の注記を参照。

### database.types.ts 上の型定義

`Sale` 型など `lib/database.types.ts` の型は、`customer_id`/`user_id`が依然として未定義（`app/sales/page.tsx`では`(s as any).customer_id`でキャストして参照）。schema.sqlとの同期は完了したが、TypeScript型定義側の追従はまだ行っていない。

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

グラフによる可視化専用画面。2つの独立したセクションを持つ。

**売上セクション**
- 表示切替: 日別（月選択）/ 月別（直近12ヶ月固定）
- サマリー4カード: 期間合計売上、平均売上（売上のあった日/月のみで平均）、取引件数、最高売上日/月
- 棒グラフ（日別/月別売上）、折れ線グラフ（売上推移）
- カテゴリ別円グラフ（日別表示時のみ、割合%と金額を凡例に併記）

**来客数トレンドセクション**（売上セクションとは独立したstate/データ取得）
- 表示切替: 日別（月選択）/ 月別（年選択、直近5年分をプルダウン提供）
- `sales.lunch_count` / `dinner_count` を集計
- サマリー3カード: 来店総数、ランチ計、ディナー計
- 折れ線グラフ（ランチ=青、ディナー=オレンジの2系列）

## 8. 既知の課題・要検証事項

- ~~schema.sqlの陳腐化~~：2026-07-13に本番スキーマと照合し解消済み（6章参照）
- **予約と顧客の非連携**: 予約作成時`customer_id`は常に`null`固定。売上では顧客と紐付けて来店回数を自動加算する仕組みがあるが、予約側には同等の仕組みがない
- **在庫連動は仕入れ記録のみ**: 販売による在庫減少ロジックは存在しない（`sales`登録時に`inventory.stock`を減算する処理が無い）。在庫は「仕入れ」でのみ増加し、実消費と連動していない
- **型定義の追従遅れ**: `database.types.ts`の`Sale`型は`lunch_count`/`dinner_count`は定義済みだが`customer_id`/`user_id`は未反映（schema.sqlとの同期は完了済みだが、この型定義ファイルはまだ追従していない）。型安全性が部分的に効いていない

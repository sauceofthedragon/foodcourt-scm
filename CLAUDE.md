# foodcourt-scm — プロジェクト規約

## プロジェクト概要
飲食店（Sauce of the Dragon）の店舗管理システム。売上・来客数・顧客台帳・分析グラフを管理する。
オーナー1名（けーた）のみが利用するシングルテナント運用。

- 技術スタック: Next.js 16 (App Router) + Supabase (PostgreSQL) + Vercel
- デプロイ: Vercel CLI（本番: foodcourt-scm-2.vercel.app）
- ローカルパス: C:\Users\sasakikeitarou\Desktop\SCM

## 絶対ルール（違反禁止）

1. **すべての指示・変更提案には、確認手段（コマンド・SQL・操作手順）を必ずセットで提示すること。** 「実行して」で終わらせず、「実行後に○○で結果を確認」まで書く。
2. **本番Supabaseへの破壊的操作（DROP / DELETE / TRUNCATE / RLS無効化）は、実行前に必ず影響範囲を提示し、けーたの明示的承認を得ること。**
3. ファイルはClaude Codeが直接編集する。編集完了後は「変更したファイル一覧 → 各変更の要約 → 動作確認手段」を必ず報告する。依頼されたファイル以外を編集する必要がある場合は、実行前に理由を提示して承認を得ること。
4. 推測で答えない。コードを確認できない場合は「確認できません」と明言し、確認用コマンドを提示する。
5. 作業セッションの終了時は、引き継ぎドキュメント（完了事項・未完了事項・次のアクション）を生成する。

## アーキテクチャの確定事項

### 認証・ミドルウェア
- ミドルウェアは `src/proxy.ts`（Next.js 16の正式ファイル名）。`middleware.ts` は廃止済み。復活させないこと。
- セッション検証は `getUser()` を使用する。`getSession()` はJWT検証をしないため使用禁止。
- `sales` テーブルへの書き込みは全てセッション経由。service role / cron からの書き込み経路は存在しない（この前提が崩れる変更をする場合は必ず警告すること）。

### データベース（Supabase）
- 全テーブルにRLS有効化が必須。新規テーブル作成時はRLS有効化＋ポリシー作成をセットで行う。
- `sales.user_id`: `NOT NULL DEFAULT auth.uid()`、RLSポリシーは `auth.uid() = user_id`。
- `sales` には `lunch_count` / `dinner_count`（来客数）、`customer_id UUID REFERENCES customers(id)`（NULL許容＝飛び込み客）がある。
- `customers.visit_count` の加算はRPC `increment_visit_count(cust_id UUID)`（SECURITY DEFINER）経由のみ。フロント側でカウント計算をしない（二重加算防止）。
- 型定義は `lib/database.types.ts`。スキーマ変更時は必ずここも同期させる。

### 既知の診断パターン
- 「Supabaseダッシュボードでは見えるがアプリで表示されない」→ RLSによるフィルタが第一容疑。ダッシュボードはservice roleでRLSを迂回するため。
- 過去事象: RLSポリシー変更前の既存行に `user_id = NULL` が残っていた（NULL比較は常にfalse）。同種の変更時はNULL行のバックフィルを確認すること。

## 進行中・未確定事項

- **弥生青色申告オンライン向けCSV自動生成パイプライン**（設計中）
  - 出力スキーマ: 3列固定（日付・出金・摘要）
  - **消費税計算方式（本則 / 簡易 / 特例）が未確定。** この確認が完了するまで税額計算ロジックを実装しないこと。
- 領収書OCR自動化パイプライン（進行中）

## 検証コマンド集

```sql
-- RLS有効状態の全件確認
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- テーブルのカラム構成確認（table_nameを差し替え）
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'sales' ORDER BY ordinal_position;

-- user_idのNULL行チェック
SELECT COUNT(*) FROM sales WHERE user_id IS NULL;
```

```bash
# ローカル開発
npm run dev

# 型チェック・ビルド検証（デプロイ前に必ず実行）
npm run build

# 本番デプロイ
vercel --prod
```

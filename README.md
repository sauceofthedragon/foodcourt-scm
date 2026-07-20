# foodcourt-scm

フードコート向け統合管理システム（Next.js + Supabase）。

## セットアップ

```powershell
npm install
npm run dev
```

`.env.local` に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定すること。

---

## デモ環境への切替（note掲載用スクリーンショット用）

本番データとは完全に分離したデモ用Supabaseプロジェクトに接続を切り替えて、
実データを映さずにスクリーンショットを撮るための手順。コード変更は不要で、
`.env.local` の中身を差し替えるだけで切り替わる。

### 初回のみ

1. 現在の本番設定を保存しておく（未実施の場合）
   ```powershell
   copy .env.local .env.production
   ```
2. `.env.demo.example` をコピーして `.env.demo` を作成し、デモプロジェクトの
   URL・anon key・管理者ログイン情報を記入する
   ```powershell
   copy .env.demo.example .env.demo
   ```

### 切替方法

```powershell
# デモへ切替
copy .env.demo .env.local
npm run dev

# 本番へ戻す
copy .env.production .env.local
npm run dev
```

Next.jsは起動時にしか`.env.local`を読み込まないため、切替後は必ず開発サーバーを
再起動すること。起動後、ブラウザの開発者コンソールに
`[supabase] 接続先: xxxxxxxxxxxx.supabase.co` というログが出るので、
スクショを撮る前に意図した環境（デモ／本番）に接続しているか必ず確認する。

---

## デモデータのseed

デモプロジェクトへダミーデータを投入するスクリプト。**本番データには一切触れない
安全設計**になっている。

### 仕組み

- `.env.local`とは完全に独立した`.env.seed`（gitignore対象）だけを読み込む。
  アプリ用の設定を誤って本番に向けていても、seedスクリプトの挙動には影響しない
- 接続先URLのホスト名を`scripts/seed/production-project.json`（拒否リスト）と
  `scripts/seed/demo-project.json`（許可リスト）の両方でチェックし、
  デモプロジェクト以外では即エラー終了する

### 初期設定（初回のみ）

1. `scripts/seed/demo-project.json` の `hostname` を、デモプロジェクトの
   実際のホスト名（`xxxxxxxxxxxx.supabase.co`）に書き換える
2. リポジトリ直下に `.env.seed` を新規作成し、以下を記入する
   ```
   SEED_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   SEED_SUPABASE_SERVICE_ROLE_KEY=デモプロジェクトのservice_roleキー
   SEED_ADMIN_EMAIL=demo-owner@example.com
   SEED_ADMIN_PASSWORD=任意のパスワード
   ```
   `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`は省略可（省略時はデフォルト値と
   ランダムパスワードが使われ、実行時にコンソールへ表示される）。

### 実行

```powershell
npm run seed:demo                      # 追加投入
npm run seed:demo -- --reset           # 既存データを全削除してから再投入
npm run seed:demo -- --seed 42         # 波形を固定して再実行（デバッグ用）
```

生成されるデータ：実行日から過去90日分（当月は月初〜実行日）。火曜定休、
週末高め・突出日ありの波形、ランチ/ディナー比率つき。詳細は
`scripts/seed/generators.js` を参照。

### 安全確認

`.env.seed`のURLを本番のものに書き換えて実行すると、投入前に
「安全ガード: 接続先は本番プロジェクトです。処理を中止しました。」と表示されて
即終了することを確認できる（そのまま実行しても安全）。

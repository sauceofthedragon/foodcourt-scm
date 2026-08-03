# Apps Script デプロイ手順（GCP不要・カード登録不要）

所要 10〜15分。Googleアカウントだけで完結します。

---

## 1. スクリプトを作る

1. https://script.google.com/ を開く
2. 左上「新しいプロジェクト」
3. 左上のプロジェクト名（「無題のプロジェクト」）をクリックして **`SCM_Drive中継`** に変更
4. エディタの `Code.gs`（または `コード.gs`）の中身を**全部消して**、配布した `Code.gs` の全文を貼り付け
5. 保存（Ctrl+S）

フォルダIDは既にコードに書き込んであります。書き換え不要です。

---

## 2. 共有シークレットを設定する

コードには書きません。スクリプトプロパティに入れます。

1. 左サイドバーの歯車アイコン「**プロジェクトの設定**」
2. 下の方の「**スクリプト プロパティ**」→「スクリプト プロパティを追加」
3. プロパティ: `SHARED_SECRET`
4. 値: 下記をそのまま貼り付け（自分で作り直しても構いません）

```
WyRJK3_i29nAfXJyI4xGkHMz5dRwR6eaIinHOAABVWY
```

5. 「スクリプト プロパティを保存」

> この値は後で `.env.local` と Vercel にも同じものを入れます。**リポジトリには絶対に書かないでください。**

---

## 3. 権限を承認する

デプロイ前に、一度エディタから実行して承認を通します。

1. エディタ上部の関数プルダウンで **`test_folders`** を選ぶ
2. 「実行」
3. 「承認が必要です」→「権限を確認」→ 自分のアカウントを選択
4. 「このアプリは Google で確認されていません」と出たら →「**詳細**」→「**SCM_Drive中継（安全ではないページ）に移動**」
5. 「許可」

**確認手段**: 実行ログに次の2行が出れば成功です。

```
INBOX: 00_未取込
DONE : 90_取込済
```

> 手順4の警告は、自分で書いたスクリプトを自分のアカウントで動かす場合に必ず出るものです。Googleの審査を受けていない、という意味であって、危険という意味ではありません。

続けて **`test_list`** も実行してください。`00_未取込` に入れた画像の一覧がログに出れば、Drive読み取りまで通っています（フォルダが空なら「件数: 0」でOK）。

---

## 4. ウェブアプリとしてデプロイする

1. 右上「**デプロイ**」→「**新しいデプロイ**」
2. 歯車アイコン →「**ウェブアプリ**」を選択
3. 設定:
   - 説明: `v1`
   - **次のユーザーとして実行: 自分**
   - **アクセスできるユーザー: 全員**
4. 「デプロイ」
5. 表示される **ウェブアプリのURL**（`https://script.google.com/macros/s/........./exec`）をコピー

> 「アクセスできるユーザー: 全員」に不安を感じるのは正しい感覚です。ただしこの設定は「URLを知っていれば**リクエストを送れる**」という意味で、送った先で `SHARED_SECRET` の照合に落ちれば何も返しません。加えて `get` と `done` は `00_未取込` の直下にあるファイルしか対象にせず、削除系のAPIは実装していません。仮にURLとシークレットの両方が漏れても、被害はそのフォルダの中に閉じます。

---

## 5. 環境変数を設定する

サービスアカウント方式はやめたので、**設定する変数が3つに減りました。**

### 5-1. ローカル: `.env.local` に追記

```
# --- 領収証取り込み ---
ANTHROPIC_API_KEY=sk-ant-...
GAS_WEBAPP_URL=https://script.google.com/macros/s/........./exec
GAS_SHARED_SECRET=WyRJK3_i29nAfXJyI4xGkHMz5dRwR6eaIinHOAABVWY
```

`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GDRIVE_INBOX_FOLDER_ID` / `GDRIVE_DONE_FOLDER_ID` は**不要になりました**。フォルダIDはApps Script側が持っています。

### 5-2. 本番: Vercel

Project → Settings → Environment Variables に同じ3つ（Production / Preview / Development すべて）。

追加後、**再デプロイしないと反映されません**（`vercel --prod`）。

---

## 6. 依存パッケージ

`googleapis` は不要になりました。

```bash
cd C:\Users\sasakikeitarou\Desktop\SCM
npm install @anthropic-ai/sdk
```

**確認手段**: `package.json` の dependencies に `@anthropic-ai/sdk` が載り、`npm run build` が通ること。

---

## 7. 疎通確認

デプロイURLが正しいかを、コマンド1本で確認できます。PowerShellから:

```powershell
curl.exe -L -X POST "https://script.google.com/macros/s/........./exec" `
  -H "Content-Type: application/json" `
  -d '{\"action\":\"ping\",\"secret\":\"WyRJK3_i29nAfXJyI4xGkHMz5dRwR6eaIinHOAABVWY\"}'
```

**期待する結果**:

```json
{"ok":true,"pong":true,"inbox":"1U2BFw...","done":"1hwcSb..."}
```

| 返ってきたもの | 意味 | 対処 |
|---|---|---|
| `{"ok":true,"pong":true,...}` | 正常 | 次へ |
| `{"ok":false,"error":"unauthorized"}` | シークレット不一致 | スクリプトプロパティの値を確認 |
| `{"ok":false,"error":"SHARED_SECRET_not_configured"}` | 手順2が未完了 | スクリプトプロパティを追加 |
| HTMLのログインページが返る | アクセス権が「全員」になっていない | 手順4-3をやり直して再デプロイ |
| 404 | URLが違う。`/exec` で終わっているか確認 | デプロイ画面からURLを取り直す |

> `-L` は必須です。Apps Script はリダイレクトを挟むため、付けないとHTMLが返ります。

---

## 8. コードを更新したとき

**エディタで保存しただけでは本番に反映されません。** Vercelと同じ考え方です。

「デプロイ」→「デプロイを管理」→ 鉛筆アイコン →「バージョン: 新バージョン」→「デプロイ」

この手順を踏むと**URLは変わりません**。「新しいデプロイ」を選ぶとURLが変わり、環境変数の入れ直しが必要になるので注意してください。

---

## 9. けーたさんの残作業

| # | 内容 | 状態 |
|---|---|---|
| 1 | マイグレーションSQL実行＋確認クエリ7本 | |
| 2 | Apps Script 作成・シークレット設定・承認（手順1〜3） | |
| 3 | ウェブアプリとしてデプロイ（手順4） | |
| 4 | Anthropic APIキー取得（残高も確認） | |
| 5 | 環境変数3つ（ローカル＋Vercel） | |
| 6 | `npm install @anthropic-ai/sdk` | |
| 7 | 疎通確認（手順7）で `pong` が返る | |
| 8 | **7/31に食材の在庫金額を数えてメモに残す** | |

7まで終わったら声をかけてください。API Route と画面を書きます。

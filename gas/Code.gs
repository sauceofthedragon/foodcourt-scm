/**
 * SCM 領収証取り込み — Google Drive 操作の中継
 *
 * 役割はこの4つだけ。OCRもDB書き込みもここではやらない。
 *   list : 00_未取込 の画像・PDFを一覧する
 *   get  : 指定ファイルの中身を base64 で返す
 *   done : ファイル名を変え、90_取込済 へ移す（削除は一切しない）
 *   ping : 疎通確認
 *
 * 呼び出し元は Next.js の app/api/receipts/import/route.ts。
 * サーバー間通信のみで、ブラウザから直接叩かせない。
 *
 * 【安全側に倒している点】
 *   - 共有シークレットはコードに書かず、スクリプトプロパティから読む
 *   - get / done は「00_未取込 の直下にあるファイル」しか対象にしない。
 *     シークレットが漏れても、Drive全体を読まれたり動かされたりはしない
 *   - 削除系のAPIは一切実装しない。実装しなければ、事故は起こせない
 */

// ---- 設定（フォルダIDは秘密情報ではないのでコードに置く）----
const INBOX_FOLDER_ID = '1U2BFw_dGVpn61T3tOOZAGDgidjKeJKa6'; // SCM_領収証 / 00_未取込
const DONE_FOLDER_ID  = '1hwcSb14hCEkgmNRPDlN84LWoblbvEgsT'; // SCM_領収証 / 90_取込済

const MAX_LIST_FILES  = 50;                // 1回のlistで返す最大件数
const MAX_FILE_BYTES  = 8 * 1024 * 1024;   // これを超えるファイルはgetを拒否する

// Anthropic API が受け付ける形式だけを「対応」とする。
// HEIC / HEIF / DNG(RAW) は API 側が非対応なので、ここに入れてはいけない。
const SUPPORTED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf'
];

// ---- エントリポイント ----

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'empty_body' });
    }
    const body = JSON.parse(e.postData.contents);

    if (!verifySecret_(body.secret)) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    switch (body.action) {
      case 'ping':
        return json_({ ok: true, pong: true, inbox: INBOX_FOLDER_ID, done: DONE_FOLDER_ID });
      case 'list':
        return json_({ ok: true, files: listInbox_() });
      case 'get':
        return json_({ ok: true, file: getInboxFile_(body.fileId) });
      case 'done':
        return json_({ ok: true, file: markDone_(body.fileId, body.newName) });
      default:
        return json_({ ok: false, error: 'unknown_action: ' + String(body.action) });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// GETは受け付けない。URLを踏まれてもフォルダの中身は漏れない。
function doGet() {
  return json_({ ok: false, error: 'method_not_allowed' });
}

// ---- 実処理 ----

/**
 * 00_未取込 の中身を返す。
 *
 * 対応外の形式やサイズ超過のファイルも「除外せずに」返し、supported:false を立てる。
 * 黙って除外すると、呼び出し側には「フォルダは空」としか見えず、
 * けーたは何が起きているのか永遠に分からない。見えない失敗を作らないための設計。
 */
function listInbox_() {
  const folder = DriveApp.getFolderById(INBOX_FOLDER_ID);
  const it = folder.getFiles();
  const out = [];

  while (it.hasNext() && out.length < MAX_LIST_FILES) {
    const f = it.next();
    const mime = f.getMimeType();
    const size = f.getSize();

    let reason = null;
    if (SUPPORTED_MIME.indexOf(mime) === -1) {
      reason = 'mime:' + mime;
    } else if (size > MAX_FILE_BYTES) {
      reason = 'size:' + size;
    }

    out.push({
      id:        f.getId(),
      name:      f.getName(),
      mimeType:  mime,
      size:      size,
      url:       f.getUrl(),
      createdAt: f.getDateCreated().toISOString(),
      supported: reason === null,
      unsupportedReason: reason
    });
  }

  // 古いものから処理する（レシートは撮った順に片付ける方が人間の感覚に合う）
  out.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
  return out;
}

function getInboxFile_(fileId) {
  const f = requireInboxFile_(fileId);

  const size = f.getSize();
  if (size > MAX_FILE_BYTES) {
    throw new Error('file_too_large: ' + size + ' bytes (limit ' + MAX_FILE_BYTES + ')');
  }

  const blob = f.getBlob();
  return {
    id:       f.getId(),
    name:     f.getName(),
    mimeType: f.getMimeType(),
    size:     size,
    url:      f.getUrl(),
    base64:   Utilities.base64Encode(blob.getBytes())
  };
}

function markDone_(fileId, newName) {
  const f = requireInboxFile_(fileId);

  if (newName) {
    f.setName(newName);
  }

  const done = DriveApp.getFolderById(DONE_FOLDER_ID);
  try {
    f.moveTo(done);
  } catch (err) {
    // 古い環境向けのフォールバック。削除ではなく、親フォルダの付け替え
    done.addFile(f);
    DriveApp.getFolderById(INBOX_FOLDER_ID).removeFile(f);
  }

  return { id: f.getId(), name: f.getName(), url: f.getUrl() };
}

// ---- 補助 ----

/**
 * 「00_未取込 の直下にある」ことを確認してからFileを返す。
 * これが無いと、シークレットを持つ者がDrive上の任意のファイルを
 * リネーム・移動できてしまう。被害範囲をフォルダ内に閉じ込めるための関門。
 */
function requireInboxFile_(fileId) {
  if (!fileId) throw new Error('fileId_required');

  const f = DriveApp.getFileById(fileId);
  const parents = f.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === INBOX_FOLDER_ID) return f;
  }
  throw new Error('file_not_in_inbox');
}

function verifySecret_(given) {
  const expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expected) throw new Error('SHARED_SECRET_not_configured');
  if (typeof given !== 'string') return false;
  if (given.length !== expected.length) return false;

  // 長さを揃えた上で全文字を走査する（早期returnしない）
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- 手動テスト用（エディタから実行して動作確認する）----

function test_list() {
  const files = listInbox_();
  Logger.log('件数: ' + files.length);
  files.forEach(function (f) {
    Logger.log(
      (f.supported ? '[OK] ' : '[NG] ') + f.name +
      ' / ' + f.mimeType + ' / ' + Math.round(f.size / 1024) + 'KB' +
      (f.unsupportedReason ? ' / ' + f.unsupportedReason : '')
    );
  });
}

function test_folders() {
  Logger.log('INBOX: ' + DriveApp.getFolderById(INBOX_FOLDER_ID).getName());
  Logger.log('DONE : ' + DriveApp.getFolderById(DONE_FOLDER_ID).getName());
}
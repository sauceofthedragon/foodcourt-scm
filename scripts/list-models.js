/**
 * 利用可能な Anthropic モデルの一覧を出す。
 *
 * 使い方:  node scripts/list-models.js
 *
 * モデルIDは時期によって増減するため、コードにハードコードしない方針にしている。
 * ここで確認したIDを .env.local と Vercel の ANTHROPIC_MODEL に設定すること。
 *
 * 注意: process.exit() は使わない。fetch の通信ハンドルが残った状態で呼ぶと、
 *       Windows の Node が libuv のアサーション（src\win\async.c）で異常終了し、
 *       肝心のエラーメッセージが読めなくなる。exitCode を立てて自然終了させる。
 */

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return null;
  const found = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m) {
      const v = m[2].replace(/^["']|["']$/g, '').trim();
      found[m[1]] = v;
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
  return found;
}

function describeKey(key) {
  if (!key) return '（なし）';
  const head = key.slice(0, 14);
  return `${head}… / 全${key.length}文字`;
}

async function main() {
  loadEnvLocal();

  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    console.error('✗ ANTHROPIC_API_KEY が見つかりません（.env.local を確認してください）');
    process.exitCode = 1;
    return;
  }

  console.log('使用するキー: ' + describeKey(key));
  if (!key.startsWith('sk-ant-')) {
    console.log('  ⚠ sk-ant- で始まっていません');
  }
  if (key.length < 90) {
    console.log('  ⚠ 正規のキーは100文字強あります。途中で切れている可能性が高いです');
  }
  if (key.includes('…') || key.includes('...')) {
    console.log('  ⚠ 省略記号が含まれています。Console の一覧画面からコピーすると起きます');
  }
  console.log('');

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    });
  } catch (e) {
    console.error('✗ 通信に失敗しました: ' + e.message);
    process.exitCode = 1;
    return;
  }

  const text = await res.text();

  if (!res.ok) {
    console.error('✗ HTTP ' + res.status);
    console.error(text);
    if (res.status === 401) {
      console.error('');
      console.error('APIキーが拒否されました。よくある原因:');
      console.error('  1. Console の一覧画面からコピーした（全文は作成直後にしか表示されません）');
      console.error('  2. コピー時に途中で切れた');
      console.error('  3. キーを削除・失効させた');
      console.error('→ https://console.anthropic.com/settings/keys で新しく作り直し、');
      console.error('  表示された直後にコピーしてください。');
    }
    process.exitCode = 1;
    return;
  }

  const json = JSON.parse(text);
  const models = json.data || [];

  if (models.length === 0) {
    console.log('モデルが1件も返りませんでした。アカウントの状態を確認してください。');
    process.exitCode = 1;
    return;
  }

  console.log('利用可能なモデル（新しい順）:\n');
  for (const m of models) {
    console.log('  ' + m.id + '   ' + (m.display_name || ''));
  }

  const recommended = models.find((m) => m.id === 'claude-sonnet-5') || models[0];
  console.log('\n画像を読ませるので、Sonnet 以上を選んでください。');
  console.log('推奨:  ANTHROPIC_MODEL=' + recommended.id);
  console.log('この値を .env.local と Vercel の両方に設定します。');
}

main().catch((e) => {
  console.error('✗ ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});

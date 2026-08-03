/**
 * .env.local の設定ミスを検出する。
 *
 * 使い方:  node scripts/check-env.js
 *
 * 環境変数の事故は「値が入っていない」より「見た目は入っているのに違う」方が厄介で、
 * 末尾スペース・全角文字・クォートの付け忘れ/付けすぎ・/dev と /exec の取り違え・
 * 同じ変数の二重定義・変数名と値の取り違えは、どれもエラーメッセージが出ないまま
 * 認証だけ失敗する。ここで先に潰す。
 *
 * 値そのものは表示しない（画面共有やスクショで漏れないため）。
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(process.cwd(), '.env.local');

const CHECKS = [
  {
    key: 'ANTHROPIC_API_KEY',
    rules: [
      { ok: (v) => v.startsWith('sk-ant-api'), msg: 'sk-ant-api で始まっていません（Admin Keyではモデルを呼べません）' },
      { ok: (v) => v.length >= 90, msg: '短すぎます。コピー時に切れている可能性が高いです（正規のキーは100文字強）' },
      { ok: (v) => !/[…]|\.\.\./.test(v), msg: '省略記号が含まれています。Console の一覧画面からコピーすると起きます' },
    ],
  },
  {
    key: 'ANTHROPIC_MODEL',
    rules: [
      {
        ok: (v) => !v.startsWith('sk-ant-'),
        msg: '★APIキーが入っています。ここはモデルID（例: claude-sonnet-5）を入れる場所です',
      },
      { ok: (v) => /^claude-/.test(v), msg: 'claude- で始まるモデルIDではありません' },
    ],
  },
  {
    key: 'GAS_WEBAPP_URL',
    rules: [
      { ok: (v) => v.startsWith('https://script.google.com/macros/s/'), msg: 'Apps ScriptのウェブアプリURLではありません' },
      { ok: (v) => v.endsWith('/exec'), msg: '/exec で終わっていません（/dev はテスト用URLで、サーバーからは使えません）' },
    ],
  },
  {
    key: 'GAS_SHARED_SECRET',
    rules: [
      { ok: (v) => v.length === 43, msg: '長さが43ではありません（配布した値をそのまま使う場合）' },
      { ok: (v) => /^[A-Za-z0-9_-]+$/.test(v), msg: '想定外の文字が混じっています（全角やスペースの混入を疑う）' },
    ],
  },
];

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('✗ .env.local が見つかりません: ' + ENV_PATH);
    console.error('  リポジトリのルート（package.json と同じ階層）で実行してください。');
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const lines = raw.split(/\r?\n/);
  let failed = 0;

  // --- 0. ファイル先頭のBOM ---
  // BOMがあると1行目の変数名の頭に不可視文字が付き、その変数だけ読めなくなる。
  if (raw.charCodeAt(0) === 0xfeff) {
    console.error('✗ ファイル先頭にBOMがあります。1行目の変数が読み込まれません。');
    console.error('  PowerShellの Set-Content -Encoding utf8 で保存すると発生します。');
    failed++;
  }

  // --- 1. NEXT_PUBLIC_ の混入（最優先）---
  const leaked = raw.match(/^\s*NEXT_PUBLIC_(ANTHROPIC_API_KEY|ANTHROPIC_MODEL|GAS_WEBAPP_URL|GAS_SHARED_SECRET)=/gm);
  if (leaked) {
    console.error('');
    console.error('■■■ 危険 ■■■');
    leaked.forEach((l) => console.error('  ' + l.trim().replace('=', '')));
    console.error('  NEXT_PUBLIC_ が付いた変数はブラウザに配信されます。');
    console.error('  APIキーが公開される状態です。今すぐ接頭辞を外してください。');
    console.error('');
    failed++;
  }

  // --- 2. 同じ変数の二重定義 ---
  // 先に書かれた方が読まれるため、後から追記した正しい値が無視される。
  // 「値は合っているのに認証が通らない」の典型的な原因。
  const seen = {};
  lines.forEach((line, i) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (!m) return;
    (seen[m[1]] = seen[m[1]] || []).push(i + 1);
  });
  for (const [name, at] of Object.entries(seen)) {
    if (at.length > 1) {
      console.error('✗ ' + name + ' が ' + at.length + ' 回定義されています（' + at.join('行目, ') + '行目）');
      console.error('    先に書かれた方が使われます。1つだけ残してください');
      failed++;
    }
  }

  // --- 3. 各変数の中身 ---
  for (const check of CHECKS) {
    const m = raw.match(new RegExp('^\\s*' + check.key + '\\s*=(.*)$', 'm'));

    if (!m) {
      console.error('✗ ' + check.key + ' : 未設定');
      failed++;
      continue;
    }

    const rawValue = m[1];
    const problems = [];

    if (/[ \t]$/.test(rawValue)) {
      problems.push('末尾に空白があります（この空白も値の一部として扱われます）');
    }
    if (/^["']|["']$/.test(rawValue)) {
      problems.push('クォートで囲まれています。この4つの変数にクォートは不要です');
    }
    if (/[^\x20-\x7E]/.test(rawValue)) {
      problems.push('全角文字か制御文字が混じっています');
    }

    const value = rawValue.replace(/^["']|["']$/g, '').trim();

    if (value === '') {
      problems.push('値が空です');
    } else {
      for (const rule of check.rules) {
        if (!rule.ok(value)) problems.push(rule.msg);
      }
    }

    if (problems.length === 0) {
      console.log('✓ ' + check.key + ' : OK（長さ ' + value.length + '）');
    } else {
      console.error('✗ ' + check.key + ' : 長さ ' + rawValue.length);
      problems.forEach((p) => console.error('    - ' + p));
      failed++;
    }
  }

  console.log('');
  if (failed === 0) {
    console.log('すべて問題ありません。開発サーバーを再起動してください（npm run dev）。');
  } else {
    console.error(failed + ' 件の問題があります。修正後、もう一度実行してください。');
    process.exitCode = 1;
  }
}

main();

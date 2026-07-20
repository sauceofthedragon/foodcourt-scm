// seedスクリプト専用の安全ガード。
// .env.seed（アプリの.env.localとは完全に独立したファイル）から接続先を読み取り、
// 許可リスト（デモ）・拒否リスト（本番）の二重チェックを行う。
// どちらのチェックにも通らない限り、呼び出し元へ接続情報を渡さない。

const fs = require('fs')
const path = require('path')

const SEED_ENV_PATH = path.join(__dirname, '..', '..', '.env.seed')
const DEMO_PROJECT_PATH = path.join(__dirname, 'demo-project.json')
const PRODUCTION_PROJECT_PATH = path.join(__dirname, 'production-project.json')

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${filePath} が見つかりません。.env.seed を作成し、SEED_SUPABASE_URL と SEED_SUPABASE_SERVICE_ROLE_KEY を設定してください。`
    )
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  const env = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function hostnameOf(urlString) {
  try {
    return new URL(urlString).hostname
  } catch {
    throw new Error(`URLの形式が不正です: ${urlString}`)
  }
}

function assertSafeToSeed() {
  const seedEnv = parseEnvFile(SEED_ENV_PATH)
  const url = seedEnv.SEED_SUPABASE_URL
  const serviceRoleKey = seedEnv.SEED_SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('.env.seed に SEED_SUPABASE_URL が設定されていません。')
  }
  if (!serviceRoleKey) {
    throw new Error('.env.seed に SEED_SUPABASE_SERVICE_ROLE_KEY が設定されていません。')
  }

  const hostname = hostnameOf(url)

  const production = JSON.parse(fs.readFileSync(PRODUCTION_PROJECT_PATH, 'utf-8'))
  if (hostname === production.hostname) {
    throw new Error(
      `安全ガード: 接続先(${hostname})は本番プロジェクトです。処理を中止しました。`
    )
  }

  const demo = JSON.parse(fs.readFileSync(DEMO_PROJECT_PATH, 'utf-8'))
  if (demo.hostname.startsWith('REPLACE_WITH_')) {
    throw new Error(
      'scripts/seed/demo-project.json の hostname がプレースホルダーのままです。デモプロジェクトの実際のホスト名を設定してから再実行してください。'
    )
  }
  if (hostname !== demo.hostname) {
    throw new Error(
      `安全ガード: 接続先(${hostname})は許可されたデモプロジェクト(${demo.hostname})と一致しません。処理を中止しました。`
    )
  }

  return { url, serviceRoleKey, hostname, env: seedEnv }
}

module.exports = { assertSafeToSeed, parseEnvFile, hostnameOf }

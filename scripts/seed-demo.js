#!/usr/bin/env node
// デモSupabaseプロジェクトへダミーデータを投入するスクリプト。
// 安全ガード（scripts/seed/guard.js）を必ず経由し、許可されたデモプロジェクト以外では
// 一切の書き込みを行わない。設定・実行方法はREADME.mdを参照。

const { createClient } = require('@supabase/supabase-js')
const { assertSafeToSeed } = require('./seed/guard')
const { generateDemoData } = require('./seed/generators')

function parseArgs(argv) {
  const args = { reset: false, seed: null }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--reset') {
      args.reset = true
    } else if (argv[i] === '--seed') {
      args.seed = Number(argv[i + 1])
      i += 1
    }
  }
  return args
}

function randomPassword() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

async function ensureDemoUser(supabase, email, password) {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) throw new Error(`ユーザー一覧取得失敗: ${listErr.message}`)

  const existing = list.users.find((u) => u.email === email)
  if (existing) return existing.id

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) throw new Error(`デモユーザー作成失敗: ${createErr.message}`)
  return created.user.id
}

async function ensureUserProfile(supabase, loginId, email) {
  try {
    const { error } = await supabase.from('user_profiles').upsert({ user_id: loginId, email })
    if (error) throw error
    console.log(`  user_profiles: ログインID「${loginId}」→ ${email} を設定しました。`)
  } catch (e) {
    console.warn(
      `  user_profiles の設定をスキップしました（未作成の可能性があります）: ${e.message}`
    )
  }
}

async function resetTables(supabase) {
  console.log('--reset: 既存データを削除します...')
  const tables = ['sales', 'reservations', 'purchases', 'inventory', 'customers']
  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) console.warn(`  ${table} 削除時に警告: ${error.message}`)
    else console.log(`  ${table}: 削除しました`)
  }
}

async function main() {
  const args = parseArgs(process.argv)

  // 安全ガード：許可されたデモプロジェクト以外では即エラー終了する
  const { url, serviceRoleKey, hostname, env } = assertSafeToSeed()
  console.log(`安全ガード通過: ${hostname} へ投入します。`)

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const seedValue = args.seed != null && !Number.isNaN(args.seed) ? args.seed : Date.now() % 2147483647
  console.log(`使用シード: ${seedValue}${args.seed != null ? '（固定指定）' : '（実行ごとに変化）'}`)

  if (args.reset) {
    await resetTables(supabase)
  }

  const demoEmail = env.SEED_ADMIN_EMAIL || 'demo-owner@example.com'
  const demoPassword = env.SEED_ADMIN_PASSWORD || randomPassword()
  const demoUserId = await ensureDemoUser(supabase, demoEmail, demoPassword)
  if (!env.SEED_ADMIN_PASSWORD) {
    console.log(`  デモユーザーを新規作成しました: ${demoEmail} / ${demoPassword}（.env.seedにSEED_ADMIN_PASSWORDを設定すると固定できます）`)
  }
  await ensureUserProfile(supabase, 'demo', demoEmail)

  const data = generateDemoData(seedValue)

  const { data: insertedCustomers, error: custErr } = await supabase
    .from('customers')
    .insert(data.customers)
    .select('id, name')
  if (custErr) throw new Error(`customers投入失敗: ${custErr.message}`)

  const { error: resErr } = await supabase
    .from('reservations')
    .insert(data.reservations.map((r) => ({ ...r, customer_id: null })))
  if (resErr) throw new Error(`reservations投入失敗: ${resErr.message}`)

  const { data: insertedInventory, error: invErr } = await supabase
    .from('inventory')
    .insert(data.inventory)
    .select('id, name')
  if (invErr) throw new Error(`inventory投入失敗: ${invErr.message}`)
  const inventoryIdByName = Object.fromEntries(insertedInventory.map((i) => [i.name, i.id]))

  const purchasesWithIds = data.purchases.map((p) => ({
    ...p,
    item_id: inventoryIdByName[p.item_name] ?? null,
  }))
  const { error: purErr } = await supabase.from('purchases').insert(purchasesWithIds)
  if (purErr) throw new Error(`purchases投入失敗: ${purErr.message}`)

  const customerIds = insertedCustomers.map((c) => c.id)
  const salesWithLinks = data.sales.map((s) => ({
    ...s,
    customer_id: customerIds.length > 0 && Math.random() < 0.2
      ? customerIds[Math.floor(Math.random() * customerIds.length)]
      : null,
    user_id: demoUserId,
  }))
  const { error: salesErr } = await supabase.from('sales').insert(salesWithLinks)
  if (salesErr) throw new Error(`sales投入失敗: ${salesErr.message}`)

  console.log('投入完了。')
  console.log(`  customers: ${insertedCustomers.length}件`)
  console.log(`  inventory: ${insertedInventory.length}件`)
  console.log(`  reservations: ${data.reservations.length}件`)
  console.log(`  purchases: ${purchasesWithIds.length}件`)
  console.log(`  sales: ${salesWithLinks.length}件`)
}

main().catch((err) => {
  console.error('エラー:', err.message)
  process.exit(1)
})

// 既存ページ向け後方互換ラッパー — 新規コードは lib/supabase/client.ts を使用
import { createBrowserClient } from '@supabase/ssr'

type BrowserClient = ReturnType<typeof createBrowserClient>

let _client: BrowserClient | null = null

function getClient(): BrowserClient {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key ||
      url === 'your_supabase_project_url' ||
      key === 'your_supabase_anon_key') {
    throw new Error(
      '.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。'
    )
  }

  _client = createBrowserClient(url, key)
  return _client
}

export const supabase = new Proxy({} as BrowserClient, {
  get(_target, prop) {
    return getClient()[prop as keyof BrowserClient]
  },
})

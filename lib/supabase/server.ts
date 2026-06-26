import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              // maxAge と expires を除去 → Session Cookie化
              // ブラウザを閉じると自動で消える
              const { maxAge, expires, ...sessionOptions } = options as any
              cookieStore.set(name, value, sessionOptions)
            })
          } catch {
            // Server Component からの呼び出し時は無視
          }
        },
      },
    }
  )
}
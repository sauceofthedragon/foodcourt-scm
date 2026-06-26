'use client'
import { useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const TIMEOUT_MS = 30 * 60 * 1000 // 30分

export function InactivityGuard() {
  const router = useRouter()
  const timer = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const setup = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return // ログインページでは何もしない

      const reset = () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(async () => {
          await supabase.auth.signOut()
          router.push('/login')
        }, TIMEOUT_MS)
      }

      const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
      events.forEach(e => window.addEventListener(e, reset))
      reset()

      return () => {
        events.forEach(e => window.removeEventListener(e, reset))
        if (timer.current) clearTimeout(timer.current)
      }
    }

    setup()
  }, [router])

  return null
}
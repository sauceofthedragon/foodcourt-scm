import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { password } = await request.json()
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.ADMIN_EMAIL!,
    password,
  })

  if (error) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}

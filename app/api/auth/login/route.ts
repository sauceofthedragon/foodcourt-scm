// app/api/auth/login/route.ts
// このAPIルートは廃止。認証はクライアントから直接Supabase Authを呼ぶ方式に移行済み。
export async function POST() {
  return new Response("Gone", { status: 410 })
}
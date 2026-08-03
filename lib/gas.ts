/**
 * Apps Script（SCM_Drive中継）を叩くためのクライアント。
 *
 * Drive操作はすべてApps Script側にあり、こちらはHTTPで依頼するだけ。
 * サーバー側でのみ使用すること（GAS_SHARED_SECRET はブラウザに渡らない）。
 */

export type GasFile = {
  id: string
  name: string
  mimeType: string
  size: number
  url: string
  createdAt: string
  /** Anthropic API が受け付ける形式かつサイズ内か */
  supported: boolean
  /** 'mime:image/x-adobe-dng' や 'size:18923456' の形。supported=true のときは null */
  unsupportedReason: string | null
}

export type GasFileContent = GasFile & { base64: string }

type GasResponse<T> = { ok: true } & T

async function callGas<T>(action: string, params: Record<string, unknown> = {}): Promise<GasResponse<T>> {
  const url = process.env.GAS_WEBAPP_URL
  const secret = process.env.GAS_SHARED_SECRET

  if (!url || !secret) {
    throw new Error(
      'GAS_WEBAPP_URL または GAS_SHARED_SECRET が未設定です。' +
        'ローカルは .env.local、本番は Vercel の環境変数を確認してください。'
    )
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, secret, ...params }),
      // Apps Script は POST を受けたあと別ドメインへ 302 する。
      // fetch の既定どおりリダイレクトを追い、そこで GET に変わるのが正しい挙動。
      redirect: 'follow',
      cache: 'no-store',
    })
  } catch (e) {
    throw new Error('Apps Script に接続できません: ' + String(e))
  }

  const text = await res.text()

  if (!res.ok) {
    throw new Error(`Apps Script が HTTP ${res.status} を返しました`)
  }

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    // ここに来る典型例は、ウェブアプリのアクセス権が「全員」でなく
    // Googleのログインページ（HTML）が返っているケース。
    throw new Error(
      'Apps Script が JSON を返しませんでした。デプロイ設定の' +
        '「アクセスできるユーザー」が「全員」になっているか確認してください。'
    )
  }

  if (!json.ok) {
    throw new Error('Apps Script: ' + String(json.error))
  }

  return json
}

/** 00_未取込 の画像・PDFを古い順に一覧する */
export async function gasListInbox(): Promise<GasFile[]> {
  const r = await callGas<{ files: GasFile[] }>('list')
  return r.files
}

/** 指定ファイルの中身を base64 で取得する */
export async function gasGetFile(fileId: string): Promise<GasFileContent> {
  const r = await callGas<{ file: GasFileContent }>('get', { fileId })
  return r.file
}

/** リネームして 90_取込済 へ移す。削除はしない */
export async function gasMarkDone(fileId: string, newName?: string) {
  const r = await callGas<{ file: { id: string; name: string; url: string } }>('done', {
    fileId,
    newName,
  })
  return r.file
}

/** 疎通確認 */
export async function gasPing() {
  return callGas<{ pong: boolean; inbox: string; done: string }>('ping')
}

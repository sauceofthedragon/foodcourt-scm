/**
 * 領収証の取り込み（Anthropic API 経由で画像を読む経路）。
 *
 * POST /api/receipts/import   { limit?: number }
 *
 * 処理順序（この順序を変えないこと）:
 *   1. セッション検証。ログインしていなければ何もしない
 *   2. Apps Script から 00_未取込 の一覧を取る
 *   3. 既に取り込み済み（source_file_id が一致）を除外する
 *   4. 1枚ずつ: 画像取得 → OCR → DB記録 → Driveへ「済」反映
 *
 * DB記録とDrive反映の順序・巻き戻し・item_id の扱いは lib/receipt-import.ts に
 * 集約してある（貼り付け経路 app/api/receipts/paste と共有）。
 * ここで書き写さないこと。片方だけ古くなる。
 *
 * ※ この経路は Anthropic API のクレジット残高を必要とする。
 *   残高が無い場合は credit_balance_too_low が返る。貼り付け経路を使うこと。
 *
 * service role キーは使わない。ログイン中のセッションで書き込む。
 * （CLAUDE.md「sales への書き込みは全てセッション経由。service role / cron からの
 *   書き込み経路は存在しない」と同じ方針を purchases 側でも守る）
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { gasListInbox, gasGetFile } from '@/lib/gas'
import { readReceipt } from '@/lib/receipt-ocr'
import { importOneReceipt } from '@/lib/receipt-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel Hobby の上限（fluid compute 既定）

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20

type Imported = { fileId: string; fileName: string; date: string; total: number; lines: number; receiptId: string }
type Skipped = { fileId: string; fileName: string; reason: string; detail?: string }

export async function POST(req: Request) {
  // ---- 1. セッション検証 ----
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false, error: 'ログインが必要です' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const limit = clamp(Number((body as { limit?: unknown })?.limit) || DEFAULT_LIMIT, 1, MAX_LIMIT)

  const imported: Imported[] = []
  const skipped: Skipped[] = []

  try {
    // ---- 2. 未取込フォルダの一覧 ----
    const files = await gasListInbox()

    if (files.length === 0) {
      return NextResponse.json({ ok: true, imported, skipped, remaining: 0, inboxTotal: 0 })
    }

    // ---- 3. 取り込み済みを除外 ----
    const { data: already, error: selErr } = await supabase
      .from('purchase_receipts')
      .select('source_file_id')
      .in(
        'source_file_id',
        files.map((f) => f.id)
      )

    if (selErr) throw new Error('取り込み済みの照会に失敗しました: ' + selErr.message)

    const done = new Set((already ?? []).map((r: { source_file_id: string }) => r.source_file_id))
    const pending = files.filter((f) => !done.has(f.id))

    // 対応外の形式・サイズ超過は、件数制限に関係なく「全部」報告する。
    // 黙って除外すると「フォルダは空です」としか見えず、原因に到達できない。
    const unsupported = pending.filter((f) => !f.supported)
    for (const f of unsupported) {
      const isSize = (f.unsupportedReason ?? '').startsWith('size:')
      skipped.push({
        fileId: f.id,
        fileName: f.name,
        reason: isSize ? 'file_too_large' : 'unsupported_type',
        detail: describeUnsupported(f.mimeType, f.size, isSize),
      })
    }

    const usable = pending.filter((f) => f.supported)
    const targets = usable.slice(0, limit)

    // ---- 4. 1枚ずつ処理 ----
    for (const f of targets) {
      try {
        const content = await gasGetFile(f.id)
        const { parsed, model, raw } = await readReceipt({
          base64: content.base64,
          mimeType: content.mimeType,
        })

        const result = await importOneReceipt({
          supabase,
          file: { id: f.id, name: f.name, url: f.url },
          parsed,
          readBy: model,
          raw,
        })

        if (!result.ok) {
          skipped.push({ fileId: f.id, fileName: f.name, reason: result.reason, detail: result.detail })
          continue
        }

        if (result.driveError) {
          skipped.push({
            fileId: f.id,
            fileName: f.name,
            reason: 'drive_update_failed',
            detail: result.driveError,
          })
        }

        imported.push(result.imported)
      } catch (e) {
        skipped.push({
          fileId: f.id,
          fileName: f.name,
          reason: 'error',
          detail: describeError(e),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      imported,
      skipped,
      remaining: Math.max(0, usable.length - targets.length),
      inboxTotal: files.length,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: describeError(e), imported, skipped },
      { status: 500 }
    )
  }
}

/**
 * 何をすれば直るかまで書く。「エラーです」だけでは次の行動が決まらない。
 * 残高不足は必ずまた起きる（使い切れば再発する）ので、生のJSONのまま出さない。
 */
function describeError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)

  if (/credit balance is too low|credit_balance_too_low/i.test(msg)) {
    return (
      'Anthropic APIのクレジット残高が不足しています。' +
      'console.anthropic.com の Plans & Billing で購入するか、' +
      '「読み取り結果を貼り付けて取り込む」を使ってください（こちらは課金されません）。'
    )
  }
  if (/invalid x-api-key|authentication_error/i.test(msg)) {
    return (
      'APIキーが拒否されました。`node scripts/check-env.js` と `node scripts/list-models.js` の両方を実行してください。' +
      '.env.local が正しくても、OS側の環境変数 ANTHROPIC_API_KEY が優先されて上書きしている場合があります。'
    )
  }
  if (/rate_limit|429/i.test(msg)) {
    return 'Anthropic APIのレート制限に当たりました。少し待ってからもう一度押してください。'
  }
  return msg
}

/** 何をすれば直るかまで書く。「非対応です」だけでは次の行動が決まらない */
function describeUnsupported(mimeType: string, size: number, isSize: boolean) {
  if (isSize) {
    return `${Math.round(size / 1024 / 1024)}MB あります（上限8MB）。スマホの「高画質」設定で撮り直すか、圧縮してください。`
  }
  if (/dng|raw|tiff/i.test(mimeType)) {
    return 'RAW形式は読み取れません。カメラのRAW保存をオフにするか、同時に保存されたJPEGの方をアップロードしてください。'
  }
  if (/heic|heif/i.test(mimeType)) {
    return 'HEIC形式は読み取れません。カメラの保存形式を「互換性優先（JPEG）」に変更してください。'
  }
  return `${mimeType} は読み取れません。JPEG / PNG / PDF のいずれかにしてください。`
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

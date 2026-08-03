/**
 * 領収証の取り込み（貼り付け経路）。
 *
 * POST /api/receipts/paste   { receipts: [...], readBy?: string }
 *
 * 画像をこのサーバーで読まない。別の場所（Cowork 等）で読み取った結果を
 * JSONで受け取り、DBとDriveへの反映だけを行う。Anthropic API の課金は発生しない。
 *
 * 処理順序:
 *   1. セッション検証。ログインしていなければ何もしない
 *   2. Apps Script から 00_未取込 の一覧を取る（source_file_id の正当性の根拠）
 *   3. 貼り付けられた1件ずつ: 正規化 → 親INSERT → 明細INSERT → Driveへ「済」反映
 *
 * source_file_id は「今まさに 00_未取込 にあるファイル」でなければ受け付けない。
 * 一覧に無いIDを弾くことで、
 *   - 取り込み済み（既に 90_取込済 へ移動済み）の再送
 *   - Drive上に存在しないIDの混入（貼り付けミス・幻の値）
 * の両方が、DBに触れる前に止まる。
 * ファイル名とURLも一覧側の値を使う。貼り付け側の申告は信用しない。
 *
 * 形式（JPEG/PNG/PDF等）の制限は無い。画像をAnthropic APIに渡さないため、
 * DNG や HEIC でも取り込める。Drive操作は形式を問わない。
 *
 * service role キーは使わない。ログイン中のセッションで書き込む。
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { gasListInbox } from '@/lib/gas'
import { importOneReceipt, normalizeReceipt, type ReceiptRead } from '@/lib/receipt-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 1回の貼り付けで受け付ける最大枚数。DriveのlistもMAX_LIST_FILES=50で頭打ち */
const MAX_RECEIPTS = 50

type PastedReceipt = Partial<ReceiptRead> & { source_file_id?: unknown }

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

  const body = await req.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { ok: false, error: '貼り付けた内容がJSONとして読めません。全体をコピーできているか確認してください。' },
      { status: 400 }
    )
  }

  const list: unknown = (body as { receipts?: unknown }).receipts
  if (!Array.isArray(list) || list.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'receipts が配列として見つかりません。{ "receipts": [ ... ] } の形になっているか確認してください。',
      },
      { status: 400 }
    )
  }
  if (list.length > MAX_RECEIPTS) {
    return NextResponse.json(
      { ok: false, error: `一度に取り込めるのは${MAX_RECEIPTS}件までです（${list.length}件ありました）` },
      { status: 400 }
    )
  }

  const readBy = typeof (body as { readBy?: unknown }).readBy === 'string'
    ? String((body as { readBy: string }).readBy).slice(0, 100)
    : 'paste'

  const imported: Imported[] = []
  const skipped: Skipped[] = []

  try {
    // ---- 2. 未取込フォルダの一覧（source_file_id の正当性の根拠）----
    const files = await gasListInbox()
    const inbox = new Map(files.map((f) => [f.id, f]))

    // ---- 3. 1件ずつ処理 ----
    for (const entry of list as PastedReceipt[]) {
      const fileId = typeof entry?.source_file_id === 'string' ? entry.source_file_id.trim() : ''

      if (!fileId) {
        skipped.push({
          fileId: '',
          fileName: '（source_file_id なし）',
          reason: 'invalid_payload',
          detail: 'source_file_id が入っていません。Driveのファイルと結びつけられないため取り込めません。',
        })
        continue
      }

      const file = inbox.get(fileId)
      if (!file) {
        skipped.push({
          fileId,
          fileName: fileId,
          reason: 'not_in_inbox',
          detail:
            'このIDのファイルが 00_未取込 にありません。すでに取り込み済み（90_取込済 へ移動済み）か、IDが違います。',
        })
        continue
      }

      try {
        const result = await importOneReceipt({
          supabase,
          file: { id: file.id, name: file.name, url: file.url },
          parsed: normalizeReceipt(entry),
          readBy,
          raw: entry,
        })

        if (!result.ok) {
          skipped.push({ fileId: file.id, fileName: file.name, reason: result.reason, detail: result.detail })
          continue
        }

        if (result.driveError) {
          skipped.push({
            fileId: file.id,
            fileName: file.name,
            reason: 'drive_update_failed',
            detail: result.driveError,
          })
        }

        imported.push(result.imported)
      } catch (e) {
        skipped.push({
          fileId: file.id,
          fileName: file.name,
          reason: 'error',
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      imported,
      skipped,
      remaining: 0,
      inboxTotal: files.length,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), imported, skipped },
      { status: 500 }
    )
  }
}

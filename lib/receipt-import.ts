/**
 * 領収証をDBへ記録し、Drive上の原本を 90_取込済 へ移す。
 *
 * 「どうやって読み取ったか」に依存しない部分を、ここに1箇所だけ置く。
 * 読み取り経路は現在2つある:
 *   1. app/api/receipts/import  … Anthropic API に画像を渡して読む（要APIクレジット）
 *   2. app/api/receipts/paste   … 別の場所で読んだ結果をJSONで貼り付ける（課金なし）
 *
 * ここに集約している安全装置は4つ。経路が増えるたびに書き写すと、
 * いつか片方だけ古くなる。分岐させないこと。
 *
 *   A. purchases.item_id は必ず null にする。
 *      品目の自動マッチは、誤爆すると別品目の stock を静かに壊し、誰も気づけない。
 *      在庫に効かせたい行は、人が既存の仕入フォームで品目を選ぶ。
 *   B. 日付・合計が読めていない領収証は記録しない。
 *      撮影日や今日の日付での代用は、月次の集計を静かに狂わせる。
 *   C. 親INSERT → 明細INSERT → Drive移動 の順序を守る。
 *      逆順だと「画像は移動済み・記録なし」という復旧困難な状態が起きる。
 *   D. 明細INSERTに失敗したら親をDELETEして巻き戻す。
 *      親だけ残ると「金額はあるが中身が無いレシート」になる。
 *
 * 二重取り込み防止の本体は purchase_receipts.source_file_id の UNIQUE 制約であって、
 * Driveのリネームや移動ではない。Drive操作が失敗してもDBは残す（次回はUNIQUEが弾く）。
 */

import type { createClient } from '@/lib/supabase/server'
import { gasMarkDone } from '@/lib/gas'

/** ルートハンドラが await createClient() で得るクライアントと同じ型 */
type ServerSupabase = Awaited<ReturnType<typeof createClient>>

export type CostCategory = 'food' | 'supply' | 'equipment' | 'other'
export type PayMethod = 'cash' | 'card' | 'qr' | 'other'

const COST_CATEGORIES: readonly CostCategory[] = ['food', 'supply', 'equipment', 'other']
const PAY_METHODS: readonly PayMethod[] = ['cash', 'card', 'qr', 'other']

export type ReceiptLine = {
  name: string
  qty: number
  unit_cost: number
  total: number
  tax_rate: number | null
  cost_category: CostCategory
}

export type ReceiptRead = {
  date: string | null
  supplier: string | null
  subtotal: number | null
  tax: number | null
  discount: number | null
  total: number | null
  pay_method: PayMethod | null
  lines: ReceiptLine[]
  unreadable_reason: string | null
}

/** Drive 上の原本。取り込み後にリネーム＋移動する対象 */
export type ReceiptSource = {
  id: string
  name: string
  url: string
}

export type ImportedInfo = {
  fileId: string
  fileName: string
  date: string
  total: number
  lines: number
  receiptId: string
}

/** 取り込めなかった理由。画面のラベル（SKIP_REASON_LABEL）と対応させること */
export type SkipReason = 'date_unreadable' | 'total_unreadable' | 'already_imported'

export type ImportOneResult =
  | { ok: true; imported: ImportedInfo; driveError?: string }
  | { ok: false; reason: SkipReason; detail?: string }

/**
 * 領収証1枚をDBに記録し、Driveの原本を「済」にする。
 *
 * 想定外の失敗（DB接続断など）は throw する。呼び出し側で1枚分だけ握りつぶし、
 * 残りの処理を続けること。1枚の失敗で全体を止めない。
 */
export async function importOneReceipt(params: {
  supabase: ServerSupabase
  file: ReceiptSource
  parsed: ReceiptRead
  /** 何で読んだかの記録。ocr_model 列と ocr_raw 列に入る */
  readBy: string
  raw: unknown
}): Promise<ImportOneResult> {
  const { supabase, file, parsed, readBy, raw } = params

  // --- B. 読めていないものは記録しない ---
  if (!parsed.date) {
    return {
      ok: false,
      reason: 'date_unreadable',
      detail: parsed.unreadable_reason ?? '日付を読み取れませんでした',
    }
  }
  if (parsed.total === null) {
    return {
      ok: false,
      reason: 'total_unreadable',
      detail: parsed.unreadable_reason ?? '合計金額を読み取れませんでした',
    }
  }

  // ローカル変数に取り出す。以降のコールバック内でも string / number として扱えるようにするため
  // （parsed.date のままだと、クロージャの中で null 許容に戻る）
  const date: string = parsed.date
  const total: number = parsed.total

  // 明細が無いレシートは、合計1行として記録する（0行だと原価集計から消えてしまうため）
  const hasLines = parsed.lines.length > 0
  const lines: ReceiptLine[] = hasLines
    ? parsed.lines
    : [
        {
          name: parsed.supplier ?? '（明細なし）',
          qty: 1,
          unit_cost: total,
          total: total,
          tax_rate: null,
          cost_category: 'other',
        },
      ]

  // --- C-1. 親INSERT ---
  const { data: receipt, error: insErr } = await supabase
    .from('purchase_receipts')
    .insert({
      date,
      supplier: parsed.supplier,
      subtotal: parsed.subtotal,
      tax: parsed.tax,
      discount: parsed.discount,
      total,
      pay_method: parsed.pay_method,
      notes: parsed.unreadable_reason,
      source_file_id: file.id,
      source_file_name: file.name,
      source_url: file.url,
      ocr_raw: raw,
      ocr_model: readBy,
      ocr_status: hasLines && !parsed.unreadable_reason ? 'ok' : 'partial',
    })
    .select('id')
    .single()

  if (insErr) {
    // UNIQUE違反 = 別プロセスが先に取り込んだ。競合であって異常ではない
    if (insErr.code === '23505') {
      return { ok: false, reason: 'already_imported' }
    }
    throw new Error('レシートの登録に失敗: ' + insErr.message)
  }

  // --- C-2. 明細INSERT（A. item_id は必ず null）---
  const { error: lineErr } = await supabase.from('purchases').insert(
    lines.map((l, i) => ({
      date,
      item_id: null,
      item_name: l.name,
      qty: l.qty,
      unit_cost: l.unit_cost,
      total: l.total,
      supplier: parsed.supplier,
      notes: null,
      receipt_id: receipt.id,
      line_no: i + 1,
      tax_rate: l.tax_rate,
      cost_category: l.cost_category,
    }))
  )

  if (lineErr) {
    // --- D. 巻き戻し ---
    await supabase.from('purchase_receipts').delete().eq('id', receipt.id)
    throw new Error('明細の登録に失敗: ' + lineErr.message)
  }

  // --- C-3. Driveへ「済」を反映（ここで失敗してもDBはそのまま）---
  let driveError: string | undefined
  try {
    await gasMarkDone(file.id, buildDoneName(date, file.name))
  } catch (e) {
    driveError =
      'DBには取り込み済みです。Drive上のファイルが 00_未取込 に残っていますが、二重取り込みは起きません。' +
      String(e)
  }

  return {
    ok: true,
    imported: {
      fileId: file.id,
      fileName: file.name,
      date,
      total,
      lines: lines.length,
      receiptId: receipt.id,
    },
    driveError,
  }
}

/** 済_20260728_元のファイル名.jpg （二重に「済_」が付かないようにする） */
export function buildDoneName(isoDate: string, original: string) {
  const ymd = isoDate.replace(/-/g, '')
  const base = original.replace(/^済_\d{8}_/, '')
  return `済_${ymd}_${base}`
}

/**
 * DBのNOT NULL制約・整数制約に合わせて整える。
 *
 * ここで丸めておかないと insert 時に落ちてレシート単位で丸ごと失敗する。
 * Anthropic API の出力にも、人が貼り付けたJSONにも、同じ関門を通す。
 * 「APIの出力は信用できるが手入力は信用できない」ではなく、どちらも同じだけ信用しない。
 */
export function normalizeReceipt(input: Partial<ReceiptRead> | null | undefined): ReceiptRead {
  const src = input ?? {}

  const lines = (Array.isArray(src.lines) ? src.lines : [])
    .map((l): ReceiptLine | null => {
      if (!l || typeof l !== 'object') return null

      const qty = toNumber(l.qty) ?? 1
      const total = toInt(l.total)
      const unit_cost = toInt(l.unit_cost) ?? (total !== null && qty > 0 ? Math.round(total / qty) : null)
      if (total === null || unit_cost === null) return null

      return {
        name: String(l.name ?? '').trim() || '（品目名なし）',
        qty: qty > 0 ? qty : 1,
        unit_cost,
        total,
        tax_rate: toNumber(l.tax_rate),
        // 想定外の値は other に寄せる。food に寄せると原価率が静かに膨らむ
        cost_category: COST_CATEGORIES.includes(l.cost_category as CostCategory)
          ? (l.cost_category as CostCategory)
          : 'other',
      }
    })
    .filter((l): l is ReceiptLine => l !== null)

  return {
    date: isIsoDate(src.date) ? src.date : null,
    supplier: src.supplier ? String(src.supplier).trim() : null,
    subtotal: toInt(src.subtotal),
    tax: toInt(src.tax),
    discount: toInt(src.discount),
    total: toInt(src.total),
    pay_method: PAY_METHODS.includes(src.pay_method as PayMethod) ? (src.pay_method as PayMethod) : null,
    lines,
    unreadable_reason: src.unreadable_reason ? String(src.unreadable_reason) : null,
  }
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : null
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

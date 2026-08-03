/**
 * 領収証画像 → 構造化データ（Anthropic API 経由）。
 *
 * Anthropic API に画像を渡し、tool定義でスキーマを固定して受け取る。
 * 「JSONで返して」と文章で頼む方式は、稀に前置きや ```json 囲みが混ざって
 * パースに失敗する。tool_choice で強制すれば構造は保証される。
 *
 * ※ この経路は APIクレジット残高を必要とする。残高が無い場合は
 *   app/api/receipts/paste（貼り付け経路）を使う。
 *   型と正規化は lib/receipt-import.ts に集約してあり、両経路で共有する。
 *
 * サーバー側でのみ使用すること。
 */

import Anthropic from '@anthropic-ai/sdk'
import { normalizeReceipt, type ReceiptRead } from '@/lib/receipt-import'

// 既存の import 文を壊さないよう、型はここからも参照できるようにしておく
export type { ReceiptLine, ReceiptRead } from '@/lib/receipt-import'

const RECEIPT_TOOL: Anthropic.Tool = {
  name: 'record_receipt',
  description: '領収証・レシートから読み取った内容を記録する',
  input_schema: {
    type: 'object',
    properties: {
      date: {
        type: ['string', 'null'],
        description:
          'レシートに記載された日付。YYYY-MM-DD 形式。読み取れない場合は必ず null。撮影日や今日の日付で代用してはいけない。',
      },
      supplier: { type: ['string', 'null'], description: '店名・仕入先名' },
      subtotal: { type: ['integer', 'null'], description: '小計（税抜または記載どおり）。円。記載が無ければ null' },
      tax: { type: ['integer', 'null'], description: '消費税額。円。記載が無ければ null' },
      discount: { type: ['integer', 'null'], description: '値引き額。正の数で。無ければ null' },
      total: { type: ['integer', 'null'], description: '実際の支払額（合計）。円。読み取れない場合は null' },
      pay_method: {
        type: ['string', 'null'],
        enum: ['cash', 'card', 'qr', 'other', null],
        description: '支払方法。判別できなければ null',
      },
      lines: {
        type: 'array',
        description: '明細行。明細が印字されていないレシートの場合は空配列',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '品目名。記載どおり' },
            qty: { type: 'number', description: '数量。記載が無ければ 1' },
            unit_cost: { type: 'integer', description: '単価（円）。記載が無ければ 金額÷数量 を四捨五入' },
            total: { type: 'integer', description: 'その行の金額（円）' },
            tax_rate: { type: ['number', 'null'], description: '税率。8 か 10。判別できなければ null' },
            cost_category: {
              type: 'string',
              enum: ['food', 'supply', 'equipment', 'other'],
              description:
                'food=食材/飲料/調味料、supply=包材/消耗品（割り箸・おしぼり・容器・洗剤など）、equipment=備品（鍋・食器・什器）、other=それ以外',
            },
          },
          required: ['name', 'qty', 'unit_cost', 'total', 'tax_rate', 'cost_category'],
        },
      },
      unreadable_reason: {
        type: ['string', 'null'],
        description: '読み取れなかった項目がある場合、その理由を日本語で短く。問題なければ null',
      },
    },
    required: ['date', 'supplier', 'subtotal', 'tax', 'discount', 'total', 'pay_method', 'lines', 'unreadable_reason'],
  },
}

const SYSTEM_PROMPT = `あなたは飲食店の経理担当です。渡された領収証・レシートの画像を読み取り、record_receipt ツールで記録してください。

守ること:
- 画像に書かれていることだけを記録する。推測で埋めない。
- 日付が退色などで読み取れない場合は date を null にする。撮影日や今日の日付で代用してはいけない。誤った日付は月次の集計を静かに狂わせる。
- 金額はすべて円単位の整数。小数点やカンマは含めない。
- 明細に「小計」「消費税」「合計」「お預り」「お釣り」「値引」「ポイント」などの集計行が含まれていても、lines には入れない。それらは subtotal / tax / discount / total 側に入れる。
- 軽減税率（8%）の対象品目には tax_rate に 8 を入れる。レシート上の ※ や軽 のマークが手がかりになる。
- cost_category は品目名から判断する。迷ったら食材寄りに寄せず、other にする。`

export async function readReceipt(params: {
  base64: string
  mimeType: string
  model?: string
}): Promise<{ parsed: ReceiptRead; model: string; raw: unknown }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY が未設定です。.env.local と Vercel の環境変数を確認してください。')
  }

  const model = params.model || process.env.ANTHROPIC_MODEL
  if (!model) {
    throw new Error(
      'ANTHROPIC_MODEL が未設定です。`node scripts/list-models.js` で利用可能なモデルIDを確認し、環境変数に設定してください。'
    )
  }

  const client = new Anthropic({ apiKey })

  const isPdf = params.mimeType === 'application/pdf'

  const content: Anthropic.ContentBlockParam[] = [
    isPdf
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: params.base64 },
        }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: params.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
            data: params.base64,
          },
        },
    { type: 'text', text: 'この領収証を読み取って record_receipt で記録してください。' },
  ]

  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [RECEIPT_TOOL],
    tool_choice: { type: 'tool', name: 'record_receipt' },
    messages: [{ role: 'user', content }],
  })

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) {
    throw new Error('OCRの結果を構造化できませんでした（tool_use が返りませんでした）')
  }

  const parsed = normalizeReceipt(toolUse.input as Partial<ReceiptRead>)
  return { parsed, model, raw: toolUse.input }
}

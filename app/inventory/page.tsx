'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { InventoryItem, Purchase, CostCategory } from '@/lib/database.types'
import { Plus, X, ChevronDown, AlertTriangle, ShoppingBag, Package, Pencil, Download, ExternalLink, Loader2, ClipboardPaste } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'

const INV_CATEGORIES = ['食材', '飲料', '調味料', '消耗品', '備品', 'その他']

/** 1回の取り込みで処理する枚数。Vercelの実行時間上限(300秒)に対して十分余裕がある */
const IMPORT_BATCH = 5

/** purchases に埋め込んだ親レシート（原本リンク用） */
type PurchaseRow = Purchase & {
  purchase_receipts?: { source_url: string | null; source_file_name: string | null } | null
}

type ImportResult = {
  ok: boolean
  error?: string
  imported?: { fileName: string; date: string; total: number; lines: number }[]
  skipped?: { fileName: string; reason: string; detail?: string }[]
  remaining?: number
  inboxTotal?: number
}

const SKIP_REASON_LABEL: Record<string, string> = {
  date_unreadable: '日付が読めません',
  total_unreadable: '合計金額が読めません',
  already_imported: '取り込み済み',
  drive_update_failed: '取り込み済み（Drive上の移動のみ失敗）',
  unsupported_type: '対応していないファイル形式',
  file_too_large: 'ファイルが大きすぎます',
  not_in_inbox: '00_未取込 にありません',
  invalid_payload: '貼り付けた内容に不足があります',
  error: 'エラー',
}

/** 貼り付け欄に最初から表示しておく見本。書式を説明文で書くより、形を見せる方が早い */
const PASTE_PLACEHOLDER = `{
  "receipts": [
    {
      "source_file_id": "Driveのファイル ID",
      "date": "2026-07-28",
      "supplier": "酒＆業務スーパー みたけ店",
      "subtotal": 1396,
      "tax": 111,
      "discount": null,
      "total": 1507,
      "pay_method": "cash",
      "lines": [
        {
          "name": "ホールトマト1号缶",
          "qty": 2,
          "unit_cost": 698,
          "total": 1396,
          "tax_rate": 8,
          "cost_category": "food"
        }
      ],
      "unreadable_reason": null
    }
  ]
}`

const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  food: '食材',
  supply: '消耗品',
  equipment: '備品',
  other: 'その他',
}

type ItemForm = {
  name: string
  category: string
  unit: string
  stock: string
  min_stock: string
  supplier: string
  unit_cost: string
}

type PurchaseForm = {
  date: string
  item_id: string
  item_name: string
  qty: string
  unit_cost: string
  supplier: string
  notes: string
}

const emptyItemForm: ItemForm = {
  name: '',
  category: '食材',
  unit: '個',
  stock: '0',
  min_stock: '0',
  supplier: '',
  unit_cost: '',
}

const emptyPurchaseForm = (): PurchaseForm => ({
  date: format(new Date(), 'yyyy-MM-dd'),
  item_id: '',
  item_name: '',
  qty: '1',
  unit_cost: '',
  supplier: '',
  notes: '',
})

type Tab = 'inventory' | 'purchases'

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('inventory')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showItemForm, setShowItemForm] = useState(false)
  const [showPurchaseForm, setShowPurchaseForm] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm)
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(emptyPurchaseForm())
  const [saving, setSaving] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null)
  const [filterCategory, setFilterCategory] = useState('')
  const [showLowStock, setShowLowStock] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from('inventory')
      .select('*')
      .order('category')
      .order('name')
    setItems(data ?? [])
    setLoading(false)
  }, [])

  const fetchPurchases = useCallback(async () => {
    // 親レシートを埋め込んで取得し、明細から原本画像を開けるようにする
    const { data, error } = await supabase
      .from('purchases')
      .select('*, purchase_receipts(source_url, source_file_name)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)

    if (!error) {
      setPurchases(data ?? [])
      return
    }

    // purchase_receipts が未作成の環境（マイグレーション未適用）では埋め込みが失敗する。
    // 仕入れ記録そのものは表示できるべきなので、素の取得にフォールバックする。
    const { data: plain } = await supabase
      .from('purchases')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    setPurchases(plain ?? [])
  }, [])

  /** 取り込みAPIを叩いて結果を表示する。読み取り経路が違うだけで、後段は共通 */
  const runImport = useCallback(
    async (path: string, payload: unknown) => {
      setImporting(true)
      setImportResult(null)
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json: ImportResult = await res.json()
        setImportResult(json)
        if (json.ok) {
          fetchPurchases()
          fetchItems()
        }
        return json.ok
      } catch (e) {
        setImportResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
        return false
      } finally {
        setImporting(false)
      }
    },
    [fetchItems, fetchPurchases]
  )

  const handleImport = useCallback(() => {
    runImport('/api/receipts/import', { limit: IMPORT_BATCH })
  }, [runImport])

  const handlePaste = useCallback(async () => {
    // JSONとして壊れている場合は、サーバーに送る前にここで止める。
    // 往復してから「読めません」と言われるより、貼った直後に分かる方が直しやすい
    let payload: unknown
    try {
      payload = JSON.parse(pasteText)
    } catch (e) {
      setImportResult({
        ok: false,
        error: 'JSONとして読めませんでした。全体をコピーできているか確認してください。／ ' + String(e),
      })
      return
    }

    const ok = await runImport('/api/receipts/paste', payload)
    // 成功した内容を残しておくと、次に貼るとき二重送信しやすい。空にする
    if (ok) setPasteText('')
  }, [pasteText, runImport])

  useEffect(() => {
    fetchItems()
    fetchPurchases()

    const channel = supabase
      .channel('inventory-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchItems)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' }, () => {
        fetchItems()
        fetchPurchases()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchItems, fetchPurchases])

  const openNewItem = () => {
    setEditItem(null)
    setItemForm(emptyItemForm)
    setShowItemForm(true)
  }

  const openEditItem = (item: InventoryItem) => {
    setEditItem(item)
    setItemForm({
      name: item.name,
      category: item.category ?? '食材',
      unit: item.unit,
      stock: String(item.stock),
      min_stock: String(item.min_stock),
      supplier: item.supplier ?? '',
      unit_cost: item.unit_cost ? String(item.unit_cost) : '',
    })
    setShowItemForm(true)
  }

  const handleSaveItem = async () => {
    if (!itemForm.name) return
    setSaving(true)

    const payload = {
      name: itemForm.name,
      category: itemForm.category || null,
      unit: itemForm.unit || '個',
      stock: parseFloat(itemForm.stock) || 0,
      min_stock: parseFloat(itemForm.min_stock) || 0,
      supplier: itemForm.supplier || null,
      unit_cost: itemForm.unit_cost ? parseInt(itemForm.unit_cost) : null,
    }

    if (editItem) {
      await supabase.from('inventory').update(payload).eq('id', editItem.id)
    } else {
      await supabase.from('inventory').insert(payload)
    }

    setSaving(false)
    setShowItemForm(false)
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm('この在庫品目を削除しますか？')) return
    await supabase.from('inventory').delete().eq('id', id)
  }

  const startEditPurchase = (p: Purchase) => {
    setEditingPurchase(p)
    setPurchaseForm({
      date: p.date,
      item_id: p.item_id ?? '',
      item_name: p.item_name,
      qty: String(p.qty),
      unit_cost: String(p.unit_cost),
      supplier: p.supplier ?? '',
      notes: p.notes ?? '',
    })
    setShowPurchaseForm(true)
  }

  const handleSavePurchase = async () => {
    if (!purchaseForm.item_name || !purchaseForm.qty || !purchaseForm.unit_cost) return
    setSaving(true)

    const qty = parseFloat(purchaseForm.qty)
    const unit_cost = parseInt(purchaseForm.unit_cost)
    const total = Math.round(qty * unit_cost)
    const newItemId = purchaseForm.item_id || null

    const payload = {
      date: purchaseForm.date,
      item_id: newItemId,
      item_name: purchaseForm.item_name,
      qty,
      unit_cost,
      total,
      supplier: purchaseForm.supplier || null,
      notes: purchaseForm.notes || null,
    }

    if (editingPurchase) {
      await supabase.from('purchases').update(payload).eq('id', editingPurchase.id).select()

      // Adjust stock: reverse old qty, apply new qty
      const oldItemId = editingPurchase.item_id ?? null
      if (oldItemId === newItemId && newItemId) {
        const delta = qty - editingPurchase.qty
        if (delta !== 0) {
          const item = items.find((i) => i.id === newItemId)
          if (item) {
            await supabase.from('inventory').update({ stock: item.stock + delta }).eq('id', newItemId)
          }
        }
      } else {
        if (oldItemId) {
          const oldItem = items.find((i) => i.id === oldItemId)
          if (oldItem) {
            await supabase.from('inventory').update({ stock: oldItem.stock - editingPurchase.qty }).eq('id', oldItemId)
          }
        }
        if (newItemId) {
          const newItem = items.find((i) => i.id === newItemId)
          if (newItem) {
            await supabase.from('inventory').update({ stock: newItem.stock + qty }).eq('id', newItemId)
          }
        }
      }
    } else {
      await supabase.from('purchases').insert(payload)

      if (newItemId) {
        const item = items.find((i) => i.id === newItemId)
        if (item) {
          await supabase.from('inventory').update({ stock: item.stock + qty }).eq('id', newItemId)
        }
      }
    }

    setSaving(false)
    setShowPurchaseForm(false)
    setEditingPurchase(null)
    setPurchaseForm(emptyPurchaseForm())
  }

  const filteredItems = items.filter((item) => {
    if (filterCategory && item.category !== filterCategory) return false
    if (showLowStock && item.stock > item.min_stock) return false
    return true
  })

  const lowStockCount = items.filter((i) => i.stock <= i.min_stock).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">在庫管理</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditingPurchase(null); setPurchaseForm(emptyPurchaseForm()); setShowPurchaseForm(true) }}
            className="btn-secondary flex items-center gap-1 text-sm py-1.5 px-3"
          >
            <ShoppingBag size={14} />
            仕入
          </button>
          <button
            onClick={openNewItem}
            className="btn-primary flex items-center gap-1 text-sm py-1.5"
          >
            <Plus size={16} />
            品目追加
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        {(['inventory', 'purchases'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            )}
          >
            {t === 'inventory' ? '在庫一覧' : '仕入れ記録'}
          </button>
        ))}
      </div>

      {tab === 'inventory' && (
        <>
          {lowStockCount > 0 && (
            <button
              onClick={() => setShowLowStock(!showLowStock)}
              className={clsx(
                'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border transition-colors',
                showLowStock
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-white text-red-600 border-red-200 hover:bg-red-50'
              )}
            >
              <AlertTriangle size={14} />
              在庫不足: {lowStockCount}品目
              {showLowStock ? ' (全て表示)' : ' (絞り込む)'}
            </button>
          )}

          <div className="relative">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="input-field appearance-none pr-7"
            >
              <option value="">全カテゴリ</option>
              {INV_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="card text-center py-10">
              <Package size={32} className="text-gray-200 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">品目が見つかりません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => {
                const isLow = item.stock <= item.min_stock
                return (
                  <div
                    key={item.id}
                    className={clsx(
                      'card cursor-pointer hover:shadow-md transition-shadow',
                      isLow && 'border-red-100 bg-red-50/30'
                    )}
                    onClick={() => openEditItem(item)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {isLow && <AlertTriangle size={12} className="text-red-500" />}
                          <p className="font-semibold text-gray-900 truncate">{item.name}</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="bg-gray-100 px-1.5 py-0.5 rounded">{item.category}</span>
                          {item.supplier && <span>{item.supplier}</span>}
                          {item.unit_cost && <span>¥{item.unit_cost}/{item.unit}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={clsx('font-bold text-lg', isLow ? 'text-red-600' : 'text-gray-900')}>
                          {item.stock}
                          <span className="text-sm font-normal text-gray-500 ml-0.5">{item.unit}</span>
                        </p>
                        <p className="text-xs text-gray-400">最低{item.min_stock}{item.unit}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id) }}
                        className="text-gray-300 hover:text-red-400 transition-colors p-1 ml-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'purchases' && (
        <div className="space-y-2">
          {/* Driveからの取り込み */}
          <button
            onClick={handleImport}
            disabled={importing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-orange-200 bg-white text-orange-600 hover:bg-orange-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {importing ? '読み取り中…（1枚あたり数秒かかります）' : `Driveから取り込み（最大${IMPORT_BATCH}枚）`}
          </button>

          {/* 貼り付け取り込み。
              画像をサーバーで読まず、別の場所で読み取った結果を受け取る経路。
              Anthropic APIの残高が無くても使え、DNG/HEICなど形式の制限も無い */}
          <div className="rounded-lg border border-gray-200 bg-white">
            <button
              onClick={() => setPasteOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              <span className="flex items-center gap-2">
                <ClipboardPaste size={15} />
                読み取り結果を貼り付けて取り込む
              </span>
              <ChevronDown
                size={15}
                className={clsx('transition-transform text-gray-400', pasteOpen && 'rotate-180')}
              />
            </button>

            {pasteOpen && (
              <div className="px-3 pb-3 space-y-2">
                <p className="text-xs text-gray-500 leading-relaxed">
                  API課金は発生しません。<code className="text-gray-700">source_file_id</code> が
                  <span className="text-gray-700"> 00_未取込 </span>
                  にあるファイルと一致した行だけ取り込みます。在庫は動きません。
                </p>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={PASTE_PLACEHOLDER}
                  spellCheck={false}
                  rows={10}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                <button
                  onClick={handlePaste}
                  disabled={importing || pasteText.trim() === ''}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border border-orange-200 bg-white text-orange-600 hover:bg-orange-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {importing ? <Loader2 size={15} className="animate-spin" /> : <ClipboardPaste size={15} />}
                  {importing ? '取り込み中…' : '貼り付けた内容を取り込む'}
                </button>
              </div>
            )}
          </div>

          {importResult && (
            <div
              className={clsx(
                'card text-sm space-y-2',
                importResult.ok ? 'border-gray-100' : 'border-red-200 bg-red-50/40'
              )}
            >
              {!importResult.ok && (
                <p className="text-red-700 font-medium">取り込みに失敗しました: {importResult.error}</p>
              )}

              {importResult.ok && (
                <div className="space-y-1">
                  <p className="font-medium text-gray-900">
                    {importResult.imported?.length ?? 0}件を取り込みました
                    {typeof importResult.remaining === 'number' && importResult.remaining > 0 && (
                      <span className="text-gray-500 font-normal">
                        {' '}／ 未取込があと{importResult.remaining}枚あります。もう一度押してください
                      </span>
                    )}
                  </p>
                  {/* Driveから何件見えているかを必ず出す。
                      「0件」だけだと、フォルダが空なのか、Apps Scriptが古いのか区別がつかない */}
                  <p className="text-xs text-gray-500">
                    Driveの 00_未取込 から {importResult.inboxTotal ?? 0} 件を認識しました
                    {(importResult.inboxTotal ?? 0) === 0 && (
                      <span className="text-amber-700">
                        {' '}
                        — フォルダにファイルがあるのにここが0の場合、Apps Scriptの再デプロイが未完了です
                      </span>
                    )}
                  </p>
                </div>
              )}

              {(importResult.imported?.length ?? 0) > 0 && (
                <ul className="space-y-0.5 text-xs text-gray-600">
                  {importResult.imported!.map((r, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-gray-400">{r.date}</span>
                      <span className="truncate flex-1">{r.fileName}</span>
                      <span className="text-gray-400">{r.lines}行</span>
                      <span className="font-medium text-gray-800">¥{r.total.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}

              {(importResult.skipped?.length ?? 0) > 0 && (
                <div className="pt-1 border-t border-gray-100">
                  <p className="text-xs font-medium text-amber-700 mb-1">
                    取り込めなかったもの（Driveの 00_未取込 に残っています）
                  </p>
                  <ul className="space-y-0.5 text-xs text-gray-600">
                    {importResult.skipped!.map((s, i) => (
                      <li key={i}>
                        <span className="truncate">{s.fileName}</span>
                        <span className="text-amber-700"> — {SKIP_REASON_LABEL[s.reason] ?? s.reason}</span>
                        {s.detail && <span className="text-gray-400"> / {s.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {purchases.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-gray-400 text-sm">仕入れ記録がありません</p>
            </div>
          ) : (
            purchases.map((p) => {
              const receiptUrl = p.purchase_receipts?.source_url ?? null
              const cat = p.cost_category ?? null
              return (
                <div key={p.id} className="card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{p.item_name}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
                        <span>{p.date}</span>
                        <span>{p.qty}個</span>
                        <span>¥{p.unit_cost}/個</span>
                        {p.supplier && <span>{p.supplier}</span>}
                        <span
                          className={clsx(
                            'px-1.5 py-0.5 rounded',
                            cat ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'
                          )}
                        >
                          {cat ? COST_CATEGORY_LABEL[cat] : '未分類'}
                        </span>
                        {receiptUrl && (
                          <a
                            href={receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-0.5 text-orange-600 hover:underline"
                          >
                            <ExternalLink size={11} />
                            原本
                          </a>
                        )}
                      </div>
                      {p.notes && <p className="text-xs text-gray-400 mt-0.5">{p.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-gray-900">¥{p.total.toLocaleString()}</span>
                      <button
                        onClick={() => startEditPurchase(p)}
                        className="text-gray-300 hover:text-orange-400 transition-colors p-1"
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Item form modal */}
      {showItemForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{editItem ? '品目編集' : '品目追加'}</h2>
              <button onClick={() => setShowItemForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">品目名 *</label>
                <input
                  className="input-field"
                  placeholder="例: 鶏もも肉"
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">カテゴリ</label>
                  <div className="relative">
                    <select
                      className="input-field appearance-none pr-7"
                      value={itemForm.category}
                      onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                    >
                      {INV_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">単位</label>
                  <input
                    className="input-field"
                    placeholder="個、kg、L など"
                    value={itemForm.unit}
                    onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">現在在庫数</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input-field"
                    value={itemForm.stock}
                    onChange={(e) => setItemForm({ ...itemForm, stock: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">最低在庫数</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input-field"
                    value={itemForm.min_stock}
                    onChange={(e) => setItemForm({ ...itemForm, min_stock: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">仕入先</label>
                <input
                  className="input-field"
                  placeholder="仕入先名"
                  value={itemForm.supplier}
                  onChange={(e) => setItemForm({ ...itemForm, supplier: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">単価 (円)</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  placeholder="0"
                  value={itemForm.unit_cost}
                  onChange={(e) => setItemForm({ ...itemForm, unit_cost: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowItemForm(false)} className="btn-secondary flex-1">
                  キャンセル
                </button>
                <button
                  onClick={handleSaveItem}
                  disabled={saving || !itemForm.name}
                  className="btn-primary flex-1"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purchase form modal */}
      {showPurchaseForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{editingPurchase ? '仕入れ編集' : '仕入れ登録'}</h2>
              <button onClick={() => { setShowPurchaseForm(false); setEditingPurchase(null) }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">日付</label>
                <input
                  type="date"
                  className="input-field"
                  value={purchaseForm.date}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">在庫から選択</label>
                <div className="relative">
                  <select
                    className="input-field appearance-none pr-7"
                    value={purchaseForm.item_id}
                    onChange={(e) => {
                      const item = items.find((i) => i.id === e.target.value)
                      setPurchaseForm({
                        ...purchaseForm,
                        item_id: e.target.value,
                        item_name: item?.name ?? purchaseForm.item_name,
                        unit_cost: item?.unit_cost ? String(item.unit_cost) : purchaseForm.unit_cost,
                        supplier: item?.supplier ?? purchaseForm.supplier,
                      })
                    }}
                  >
                    <option value="">-- 品目を選択 --</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">品目名 *</label>
                <input
                  className="input-field"
                  placeholder="品目名を直接入力も可"
                  value={purchaseForm.item_name}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, item_name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">数量 *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input-field"
                    value={purchaseForm.qty}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, qty: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">単価 (円) *</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    value={purchaseForm.unit_cost}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, unit_cost: e.target.value })}
                  />
                </div>
              </div>
              {purchaseForm.qty && purchaseForm.unit_cost && (
                <div className="bg-orange-50 rounded-lg px-3 py-2 text-sm font-semibold text-orange-700">
                  合計: ¥{(parseFloat(purchaseForm.qty) * parseInt(purchaseForm.unit_cost) || 0).toLocaleString()}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">仕入先</label>
                <input
                  className="input-field"
                  value={purchaseForm.supplier}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">メモ</label>
                <input
                  className="input-field"
                  value={purchaseForm.notes}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setShowPurchaseForm(false); setEditingPurchase(null) }} className="btn-secondary flex-1">
                  キャンセル
                </button>
                <button
                  onClick={handleSavePurchase}
                  disabled={saving || !purchaseForm.item_name || !purchaseForm.qty || !purchaseForm.unit_cost}
                  className="btn-primary flex-1"
                >
                  {saving ? (editingPurchase ? '更新中...' : '登録中...') : (editingPurchase ? '更新' : '登録')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

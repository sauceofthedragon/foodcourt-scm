'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { InventoryItem, Purchase } from '@/lib/database.types'
import { Plus, X, ChevronDown, AlertTriangle, ShoppingBag, Package } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'

const INV_CATEGORIES = ['食材', '飲料', '調味料', '消耗品', '備品', 'その他']

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
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [showItemForm, setShowItemForm] = useState(false)
  const [showPurchaseForm, setShowPurchaseForm] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm)
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(emptyPurchaseForm())
  const [saving, setSaving] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [showLowStock, setShowLowStock] = useState(false)

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
    const { data } = await supabase
      .from('purchases')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    setPurchases(data ?? [])
  }, [])

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

  const handleSavePurchase = async () => {
    if (!purchaseForm.item_name || !purchaseForm.qty || !purchaseForm.unit_cost) return
    setSaving(true)

    const qty = parseFloat(purchaseForm.qty)
    const unit_cost = parseInt(purchaseForm.unit_cost)
    const total = Math.round(qty * unit_cost)

    await supabase.from('purchases').insert({
      date: purchaseForm.date,
      item_id: purchaseForm.item_id || null,
      item_name: purchaseForm.item_name,
      qty,
      unit_cost,
      total,
      supplier: purchaseForm.supplier || null,
      notes: purchaseForm.notes || null,
    })

    // Update stock
    if (purchaseForm.item_id) {
      const item = items.find((i) => i.id === purchaseForm.item_id)
      if (item) {
        await supabase
          .from('inventory')
          .update({ stock: item.stock + qty })
          .eq('id', purchaseForm.item_id)
      }
    }

    setSaving(false)
    setShowPurchaseForm(false)
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
            onClick={() => { setPurchaseForm(emptyPurchaseForm()); setShowPurchaseForm(true) }}
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
          {purchases.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-gray-400 text-sm">仕入れ記録がありません</p>
            </div>
          ) : (
            purchases.map((p) => (
              <div key={p.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{p.item_name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                      <span>{p.date}</span>
                      <span>{p.qty}個</span>
                      <span>¥{p.unit_cost}/個</span>
                      {p.supplier && <span>{p.supplier}</span>}
                    </div>
                    {p.notes && <p className="text-xs text-gray-400 mt-0.5">{p.notes}</p>}
                  </div>
                  <span className="font-bold text-gray-900 shrink-0">
                    ¥{p.total.toLocaleString()}
                  </span>
                </div>
              </div>
            ))
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
              <h2 className="font-bold text-gray-900">仕入れ登録</h2>
              <button onClick={() => setShowPurchaseForm(false)} className="text-gray-400 hover:text-gray-600">
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
                <button onClick={() => setShowPurchaseForm(false)} className="btn-secondary flex-1">
                  キャンセル
                </button>
                <button
                  onClick={handleSavePurchase}
                  disabled={saving || !purchaseForm.item_name || !purchaseForm.qty || !purchaseForm.unit_cost}
                  className="btn-primary flex-1"
                >
                  {saving ? '登録中...' : '登録'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

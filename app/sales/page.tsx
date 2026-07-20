'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Sale, PayMethod } from '@/lib/database.types'
import { Plus, Search, X, ChevronDown, TrendingUp, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'

const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  cash: '現金',
  card: 'カード',
  qr: 'QR決済',
  other: 'その他',
}

const CATEGORIES = ['フード', 'ドリンク', 'アルコール', 'デザート', 'セット', 'テイクアウト', 'その他']

// category ごとの静的クラス名（Tailwindの動的クラス生成はビルド時にパージされるため使わない）
function menuItemButtonClass(category: string): string {
  if (category === 'フード') return 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100'
  if (category === 'アルコール') return 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
  if (category === 'ドリンク') return 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
  return 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
}

// 空文字・null・undefined は null に変換（Postgres側のinteger/numeric変換エラー防止）
function toNullableNumber(value: unknown): number | null {
  if (value === '' || value == null) return null
  return Number(value)
}

// 空文字・null・undefined は 0 に変換
function toNumberOrZero(value: unknown): number {
  if (value === '' || value == null) return 0
  return Number(value)
}

type FormData = {
  date: string
  time: string
  pay_method: PayMethod
  table_no: string
  notes: string
  lunch_count: string
  dinner_count: string
  customer_id: string
}

// emptyForm の直前に追加
type Customer = { id: string; name: string }

type MenuItem = {
  id: string
  name: string
  category: string
  menu_group: string | null
  price: number
  cost: number | null
}

type SaleItem = {
  menu_item_id: string | null
  item_name: string
  qty: number
  unit_price: number
  unit_cost: number | null
  subtotal: number
}

const emptyForm = (): FormData => ({
  date: format(new Date(), 'yyyy-MM-dd'),
  time: format(new Date(), 'HH:mm'),
  pay_method: 'cash',
  table_no: '',
  notes: '',
  lunch_count: '',
  dinner_count: '',
  customer_id: '',
})

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [filterCategory, setFilterCategory] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  useEffect(() => {
    supabase.from('customers').select('id, name').order('name').then(({ data }) => {
      setCustomers(data ?? [])
    })
  }, [])

  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [items, setItems] = useState<SaleItem[]>([])
  const [discount, setDiscount] = useState(0)
  useEffect(() => {
    supabase.from('menu_items')
      .select('id, name, category, menu_group, price, cost')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setMenuItems(data ?? [])
      })
  }, [])

  const fetchSales = useCallback(async () => {
    let query = supabase
      .from('sales')
      .select('*')
      .eq('date', filterDate)
      .order('time', { ascending: false })

    if (filterCategory) query = query.eq('category', filterCategory)

    const { data } = await query
    setSales(data ?? [])
    setLoading(false)
  }, [filterDate, filterCategory])

  useEffect(() => {
    fetchSales()

    const channel = supabase
      .channel('sales-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, fetchSales)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchSales])

  const handleSave = async () => {
    if (items.length === 0) {
      setSaveError('明細を入力してください')
      return
    }

    setSaveError(null)
    setSaving(true)

    const rpcItems = items.map((i) => ({
      menu_item_id: i.menu_item_id,
      item_name: i.item_name,
      qty: Number(i.qty),
      unit_price: Number(i.unit_price),
      unit_cost: toNullableNumber(i.unit_cost),
      subtotal: Number(i.subtotal),
    }))

    const { error } = await supabase.rpc('save_sale_with_items', {
      p_sale_id: editingId,
      p_date: form.date,
      p_time: form.time,
      p_discount: toNumberOrZero(discount),
      p_pay_method: form.pay_method,
      p_table_no: form.table_no,
      p_notes: form.notes,
      p_lunch_count: Number(form.lunch_count || 0),
      p_dinner_count: Number(form.dinner_count || 0),
      p_customer_id: form.customer_id || null,
      p_user_id: userId,
      p_items: rpcItems,
    })

    setSaving(false)

    if (error) {
      setSaveError(error.message)
      return
    }

    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm())
    setItems([])
    setDiscount(0)
  }

  const handleEdit = async (s: Sale) => {
    setEditingId(s.id)
    setForm({
      date: s.date,
      time: s.time,
      pay_method: s.pay_method,
      table_no: s.table_no ?? '',
      notes: s.notes ?? '',
      lunch_count: String(s.lunch_count ?? ''),
      dinner_count: String(s.dinner_count ?? ''),
      customer_id: (s as any).customer_id ?? '',
    })
    setItems([])
    setDiscount((s as any).discount ?? 0)
    setSaveError(null)
    setShowForm(true)

    const { data, error } = await supabase
      .from('sale_items')
      .select('menu_item_id, item_name, qty, unit_price, unit_cost, subtotal')
      .eq('sale_id', s.id)

    if (error) {
      console.error('sale_items fetch error:', error)
      setSaveError('明細の読み込みに失敗しました')
      return
    }

    setItems(
      (data ?? []).map((row) => ({
        menu_item_id: row.menu_item_id,
        item_name: row.item_name,
        qty: Number(row.qty),
        unit_price: Number(row.unit_price),
        unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
        subtotal: Number(row.subtotal),
      }))
    )
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この売上記録を削除しますか？')) return
    await supabase.from('sales').delete().eq('id', id)
  }

  const handleTapMenuItem = (m: MenuItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.menu_item_id === m.id)
      if (idx !== -1) {
        const next = [...prev]
        const qty = next[idx].qty + 1
        next[idx] = { ...next[idx], qty, subtotal: qty * next[idx].unit_price }
        return next
      }
      return [
        ...prev,
        {
          menu_item_id: m.id,
          item_name: m.name,
          qty: 1,
          unit_price: m.price,
          unit_cost: m.cost,
          subtotal: m.price,
        },
      ]
    })
  }

  const handleItemQtyChange = (index: number, qty: number) => {
    setItems((prev) =>
      prev.map((i, idx) => (idx === index ? { ...i, qty, subtotal: qty * i.unit_price } : i))
    )
  }

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  const itemsTotal = items.reduce((sum, i) => sum + i.subtotal, 0)
  const checkoutTotal = itemsTotal - discount

  const totalAmount = sales.reduce((sum, s) => sum + s.amount, 0)

  const byPayMethod = sales.reduce((acc, s) => {
    acc[s.pay_method] = (acc[s.pay_method] ?? 0) + s.amount
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">売上記録</h1>
        <button
          onClick={() => { setEditingId(null); setForm(emptyForm()); setItems([]); setDiscount(0); setSaveError(null); setShowForm(true) }}
          className="btn-primary flex items-center gap-1 text-sm py-1.5"
        >
          <Plus size={16} />
          売上登録
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="input-field flex-1"
        />
        <div className="relative flex-1">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="input-field appearance-none pr-7"
          >
            <option value="">全カテゴリ</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Summary */}
      <div className="card bg-gradient-to-br from-green-50 to-emerald-50 border-green-100">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-green-600" />
          <span className="text-sm font-medium text-green-700">
            {format(new Date(filterDate + 'T00:00:00'), 'M月d日')} の売上合計
          </span>
        </div>
        <p className="text-3xl font-bold text-green-800">
          ¥{totalAmount.toLocaleString()}
        </p>
        <div className="flex gap-3 mt-2 flex-wrap">
          {Object.entries(byPayMethod).map(([method, amount]) => (
            <span key={method} className="text-xs text-green-600">
              {PAY_METHOD_LABELS[method as PayMethod]}: ¥{amount.toLocaleString()}
            </span>
          ))}
        </div>
        <p className="text-xs text-green-500 mt-1">{sales.length}件</p>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : sales.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-gray-400 text-sm">売上記録がありません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sales.map((s) => (
            <div key={s.id} className="card">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">
                      {s.category || 'その他'}
                    </span>
                    <span className="text-xs text-gray-400">{s.time.slice(0, 5)}</span>
                    {s.table_no && (
                      <span className="text-xs text-gray-400">{s.table_no}番卓</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {PAY_METHOD_LABELS[s.pay_method]}
                    </span>
                    {s.notes && <span className="text-xs text-gray-400 truncate">{s.notes}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold text-gray-900 text-base">
                    ¥{s.amount.toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleEdit(s)}
                    className="text-gray-300 hover:text-orange-400 transition-colors p-1"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors p-1"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{editingId ? '売上編集' : '売上登録'}</h2>
              <button onClick={() => { setShowForm(false); setEditingId(null) }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">品目から追加</label>
                <div className="grid grid-cols-3 gap-1.5 max-h-64 overflow-y-auto p-1 border border-gray-100 rounded-lg">
                  {menuItems.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleTapMenuItem(m)}
                      className={clsx(
                        'border rounded-lg px-2 py-2 text-left transition-colors',
                        menuItemButtonClass(m.category)
                      )}
                    >
                      <p className="text-xs font-semibold leading-tight truncate">{m.name}</p>
                      <p className="text-xs opacity-70 mt-0.5">¥{m.price.toLocaleString()}</p>
                    </button>
                  ))}
                </div>

                {items.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {items.map((i, idx) => (
                      <div key={`${i.menu_item_id ?? 'unlinked'}-${idx}`} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 min-w-0 truncate">{i.item_name}</span>
                        <span className="text-xs text-gray-400 shrink-0">
                          ¥{i.unit_price.toLocaleString()}
                        </span>
                        <input
                          type="number"
                          min="0"
                          className="input-field w-16 text-center shrink-0"
                          value={i.qty}
                          onChange={(e) =>
                            handleItemQtyChange(idx, parseInt(e.target.value) || 0)
                          }
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-gray-300 hover:text-red-400 transition-colors p-1 shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">明細合計</span>
                    <span className="font-semibold text-gray-900">
                      ¥{itemsTotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-500">値引き</span>
                    <input
                      type="number"
                      min="0"
                      className="input-field w-28 text-right"
                      value={discount}
                      onChange={(e) => setDiscount(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">お会計</span>
                    <span className="font-bold text-gray-900 text-base">
                      ¥{checkoutTotal.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">日付</label>
                  <input
                    type="date"
                    className="input-field"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">時間</label>
                  <input
                    type="time"
                    className="input-field"
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">支払方法</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setForm({ ...form, pay_method: m })}
                      className={clsx(
                        'py-2 rounded-lg text-xs font-semibold border transition-colors',
                        form.pay_method === m
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      )}
                    >
                      {PAY_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">ランチ人数</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    placeholder="0"
                    value={form.lunch_count}
                    onChange={(e) => setForm({ ...form, lunch_count: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">ディナー人数</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    placeholder="0"
                    value={form.dinner_count}
                    onChange={(e) => setForm({ ...form, dinner_count: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">テーブルNo.</label>
                <input
                  className="input-field"
                  placeholder="A1"
                  value={form.table_no}
                  onChange={(e) => setForm({ ...form, table_no: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">顧客（任意）</label>
                <div className="relative">
                  <select
                    className="input-field appearance-none pr-7"
                    value={form.customer_id}
                    onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  >
                    <option value="">飛び込み・選択なし</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">メモ</label>
                <input
                  className="input-field"
                  placeholder="備考"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              {saveError && (
                <p className="text-xs text-red-500">{saveError}</p>
              )}
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setShowForm(false); setEditingId(null) }} className="btn-secondary flex-1">
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-primary flex-1"
                >
                  {saving ? (editingId ? '更新中...' : '登録中...') : (editingId ? '更新' : '登録')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

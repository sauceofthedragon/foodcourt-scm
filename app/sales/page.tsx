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

type FormData = {
  date: string
  time: string
  amount: string
  pay_method: PayMethod
  category: string
  table_no: string
  notes: string
}

const emptyForm = (): FormData => ({
  date: format(new Date(), 'yyyy-MM-dd'),
  time: format(new Date(), 'HH:mm'),
  amount: '',
  pay_method: 'cash',
  category: 'フード',
  table_no: '',
  notes: '',
})

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [filterCategory, setFilterCategory] = useState('')

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
    if (!form.amount || !form.date) return
    setSaving(true)

    const payload = {
      date: form.date,
      time: form.time,
      amount: parseInt(form.amount),
      pay_method: form.pay_method,
      category: form.category || null,
      table_no: form.table_no || null,
      notes: form.notes || null,
    }

    if (editingId) {
      const { data } = await supabase
        .from('sales')
        .update(payload)
        .eq('id', editingId)
        .select()
      if (data) setSales((prev) => prev.map((s) => (s.id === editingId ? data[0] : s)))
    } else {
      await supabase.from('sales').insert(payload)
    }

    setSaving(false)
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm())
  }

  const handleEdit = (s: Sale) => {
    setEditingId(s.id)
    setForm({
      date: s.date,
      time: s.time,
      amount: String(s.amount),
      pay_method: s.pay_method,
      category: s.category ?? 'その他',
      table_no: s.table_no ?? '',
      notes: s.notes ?? '',
    })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この売上記録を削除しますか？')) return
    await supabase.from('sales').delete().eq('id', id)
  }

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
          onClick={() => { setEditingId(null); setForm(emptyForm()); setShowForm(true) }}
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
                <label className="text-xs font-medium text-gray-600 mb-1 block">金額 (円) *</label>
                <input
                  type="number"
                  min="0"
                  className="input-field text-lg font-bold"
                  placeholder="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
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
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">カテゴリ</label>
                <div className="relative">
                  <select
                    className="input-field appearance-none pr-7"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
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
                <label className="text-xs font-medium text-gray-600 mb-1 block">メモ</label>
                <input
                  className="input-field"
                  placeholder="備考"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setShowForm(false); setEditingId(null) }} className="btn-secondary flex-1">
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.amount}
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

'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Customer } from '@/lib/database.types'
import { Plus, Search, X, Phone, Mail, FileText, Star } from 'lucide-react'
import { format } from 'date-fns'

type FormData = {
  name: string
  phone: string
  email: string
  notes: string
  visit_count: string
}

const emptyForm: FormData = {
  name: '',
  phone: '',
  email: '',
  notes: '',
  visit_count: '0',
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Customer | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null)

  const fetchCustomers = useCallback(async () => {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })
    setCustomers(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchCustomers()

    const channel = supabase
      .channel('customers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, fetchCustomers)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchCustomers])

  const openNew = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (c: Customer) => {
    setDetailCustomer(null)
    setEditTarget(c)
    setForm({
      name: c.name,
      phone: c.phone ?? '',
      email: c.email ?? '',
      notes: c.notes ?? '',
      visit_count: String(c.visit_count),
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name) return
    setSaving(true)

    const payload = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
      visit_count: parseInt(form.visit_count) || 0,
    }

    if (editTarget) {
      await supabase.from('customers').update(payload).eq('id', editTarget.id)
    } else {
      await supabase.from('customers').insert(payload)
    }

    setSaving(false)
    setShowForm(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この顧客情報を削除しますか？')) return
    await supabase.from('customers').delete().eq('id', id)
    setDetailCustomer(null)
  }

  const filtered = customers.filter(
    (c) =>
      c.name.includes(search) ||
      (c.phone ?? '').includes(search) ||
      (c.email ?? '').includes(search)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">顧客台帳</h1>
        <button onClick={openNew} className="btn-primary flex items-center gap-1 text-sm py-1.5">
          <Plus size={16} />
          新規登録
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="名前・電話・メールで検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field pl-8"
        />
      </div>

      <p className="text-xs text-gray-400 text-right">{filtered.length}件</p>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-gray-400 text-sm">顧客が見つかりません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="card cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setDetailCustomer(c)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{c.name}</p>
                    {c.visit_count >= 5 && (
                      <Star size={12} className="text-yellow-400 fill-yellow-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {c.phone && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Phone size={10} />
                        {c.phone}
                      </span>
                    )}
                    {c.email && (
                      <span className="text-xs text-gray-500 flex items-center gap-1 truncate">
                        <Mail size={10} />
                        <span className="truncate">{c.email}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs text-gray-400">{c.visit_count}回来店</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {detailCustomer && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">顧客詳細</h2>
              <button onClick={() => setDetailCustomer(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <p className="text-xs text-gray-500">お名前</p>
                <p className="font-semibold text-lg text-gray-900">{detailCustomer.name}</p>
              </div>
              {detailCustomer.phone && (
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-gray-400" />
                  <a href={`tel:${detailCustomer.phone}`} className="text-blue-600 text-sm">
                    {detailCustomer.phone}
                  </a>
                </div>
              )}
              {detailCustomer.email && (
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-gray-400" />
                  <a href={`mailto:${detailCustomer.email}`} className="text-blue-600 text-sm truncate">
                    {detailCustomer.email}
                  </a>
                </div>
              )}
              {detailCustomer.notes && (
                <div className="flex items-start gap-2">
                  <FileText size={14} className="text-gray-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-gray-700">{detailCustomer.notes}</p>
                </div>
              )}
              <div className="bg-orange-50 rounded-lg p-3 text-sm text-orange-700">
                来店回数: <span className="font-bold">{detailCustomer.visit_count}回</span>
                <span className="text-xs text-orange-400 ml-2">
                  (登録: {format(new Date(detailCustomer.created_at), 'yyyy/MM/dd')})
                </span>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleDelete(detailCustomer.id)}
                  className="btn-danger text-sm py-1.5 px-3"
                >
                  削除
                </button>
                <button
                  onClick={() => openEdit(detailCustomer)}
                  className="btn-primary flex-1 text-sm py-1.5"
                >
                  編集
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Create modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">
                {editTarget ? '顧客編集' : '新規顧客登録'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">お名前 *</label>
                <input
                  className="input-field"
                  placeholder="山田 太郎"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">電話番号</label>
                <input
                  type="tel"
                  className="input-field"
                  placeholder="090-0000-0000"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">メールアドレス</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="example@email.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">来店回数</label>
                <input
                  type="number"
                  min="0"
                  className="input-field"
                  value={form.visit_count}
                  onChange={(e) => setForm({ ...form, visit_count: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">メモ</label>
                <textarea
                  className="input-field resize-none"
                  rows={3}
                  placeholder="アレルギー、好み、特記事項など"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name}
                  className="btn-primary flex-1"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

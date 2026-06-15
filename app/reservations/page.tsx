'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Reservation, ReservationStatus } from '@/lib/database.types'
import { Plus, Search, X, ChevronDown } from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'

const STATUS_LABELS: Record<ReservationStatus, string> = {
  confirmed: '確定',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: 'ノーショー',
}

const STATUS_OPTIONS: ReservationStatus[] = ['confirmed', 'completed', 'cancelled', 'no_show']

type FormData = {
  customer_name: string
  date: string
  time: string
  party: string
  table_no: string
  status: ReservationStatus
  notes: string
}

const emptyForm: FormData = {
  customer_name: '',
  date: format(new Date(), 'yyyy-MM-dd'),
  time: '12:00',
  party: '2',
  table_no: '',
  status: 'confirmed',
  notes: '',
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Reservation | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [filterDate, setFilterDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch] = useState('')

  const fetchReservations = useCallback(async () => {
    let query = supabase
      .from('reservations')
      .select('*')
      .order('date')
      .order('time')

    if (filterDate) query = query.eq('date', filterDate)

    const { data } = await query
    setReservations(data ?? [])
    setLoading(false)
  }, [filterDate])

  useEffect(() => {
    fetchReservations()

    const channel = supabase
      .channel('reservations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, fetchReservations)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchReservations])

  const openNew = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (r: Reservation) => {
    setEditTarget(r)
    setForm({
      customer_name: r.customer_name,
      date: r.date,
      time: r.time.slice(0, 5),
      party: String(r.party),
      table_no: r.table_no ?? '',
      status: r.status,
      notes: r.notes ?? '',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.customer_name || !form.date || !form.time) return
    setSaving(true)

    const payload = {
      customer_name: form.customer_name,
      date: form.date,
      time: form.time,
      party: parseInt(form.party) || 1,
      table_no: form.table_no || null,
      status: form.status,
      notes: form.notes || null,
      customer_id: null,
    }

    if (editTarget) {
      await supabase.from('reservations').update(payload).eq('id', editTarget.id)
    } else {
      await supabase.from('reservations').insert(payload)
    }

    setSaving(false)
    setShowForm(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この予約を削除しますか？')) return
    await supabase.from('reservations').delete().eq('id', id)
  }

  const filtered = reservations.filter((r) =>
    r.customer_name.includes(search)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">予約管理</h1>
        <button onClick={openNew} className="btn-primary flex items-center gap-1 text-sm py-1.5">
          <Plus size={16} />
          新規予約
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="input-field flex-1"
        />
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="名前検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-8"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-gray-400 text-sm">予約が見つかりません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="card cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => openEdit(r)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`badge-${r.status}`}>{STATUS_LABELS[r.status]}</span>
                    <span className="text-xs text-gray-500">{r.date} {r.time.slice(0, 5)}</span>
                  </div>
                  <p className="font-semibold text-gray-900 truncate">{r.customer_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.party}名
                    {r.table_no && ` / ${r.table_no}番卓`}
                    {r.notes && ` / ${r.notes}`}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(r.id) }}
                  className="text-gray-300 hover:text-red-400 transition-colors p-1"
                >
                  <X size={16} />
                </button>
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
              <h2 className="font-bold text-gray-900">
                {editTarget ? '予約編集' : '新規予約'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">お客様名 *</label>
                <input
                  className="input-field"
                  placeholder="山田 太郎"
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">日付 *</label>
                  <input
                    type="date"
                    className="input-field"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">時間 *</label>
                  <input
                    type="time"
                    className="input-field"
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">人数</label>
                  <input
                    type="number"
                    min="1"
                    className="input-field"
                    value={form.party}
                    onChange={(e) => setForm({ ...form, party: e.target.value })}
                  />
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
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">ステータス</label>
                <div className="relative">
                  <select
                    className="input-field appearance-none pr-8"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ReservationStatus })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">メモ</label>
                <textarea
                  className="input-field resize-none"
                  rows={2}
                  placeholder="アレルギー、特記事項など"
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
                  disabled={saving || !form.customer_name}
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

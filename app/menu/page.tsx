'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Pencil, X, Eye, EyeOff } from 'lucide-react'

type MenuItem = {
  id: string
  name: string
  category: string
  menu_group: string | null
  price: number
  cost: number | null
  sort_order: number
  is_active: boolean
  created_at?: string
}

const CATEGORIES = ['フード', 'ドリンク', 'アルコール', 'デザート', 'セット', 'テイクアウト', 'その他']

const emptyForm = {
  name: '',
  category: 'フード',
  menu_group: '',
  price: '',
  cost: '',
  sort_order: '',
  is_active: true,
}

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [categoryFilter, setCategoryFilter] = useState<string>('すべて')
  const [showInactive, setShowInactive] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  // ---------------------------------------------------------
  // データ取得
  // ---------------------------------------------------------
  const fetchItems = async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      setErrorMsg(error.message)
      setItems([])
    } else {
      setErrorMsg(null)
      setItems(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchItems()

    const channel = supabase
      .channel('menu_items_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
        fetchItems()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // ---------------------------------------------------------
  // 保存
  // ---------------------------------------------------------
  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (item: MenuItem) => {
    setEditingId(item.id)
    setForm({
      name: item.name,
      category: item.category,
      menu_group: item.menu_group || '',
      price: String(item.price),
      cost: item.cost === null ? '' : String(item.cost),
      sort_order: String(item.sort_order),
      is_active: item.is_active,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert('品目名を入力してください')
      return
    }
    if (form.price === '' || isNaN(Number(form.price))) {
      alert('売価を数値で入力してください')
      return
    }

    setSaving(true)

    const payload = {
      name: form.name.trim(),
      category: form.category,
      menu_group: form.menu_group.trim() || null,
      price: Number(form.price),
      cost: form.cost === '' ? null : Number(form.cost),
      sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
      is_active: form.is_active,
    }

    if (editingId) {
      // .eq() を省略すると全行更新になる。必須。
      const { data, error } = await supabase
        .from('menu_items')
        .update(payload)
        .eq('id', editingId)
        .select()

      if (error) {
        alert('更新できませんでした: ' + error.message)
      } else if (!data || data.length === 0) {
        alert('更新が反映されませんでした。RLSのUPDATEポリシーを確認してください。')
      }
    } else {
      const { error } = await supabase.from('menu_items').insert(payload)
      if (error) alert('登録できませんでした: ' + error.message)
    }

    setSaving(false)
    setModalOpen(false)
    fetchItems()
  }

  const toggleActive = async (item: MenuItem) => {
    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
      .select()

    if (error) {
      alert('変更できませんでした: ' + error.message)
    } else if (!data || data.length === 0) {
      alert('変更が反映されませんでした。RLSのUPDATEポリシーを確認してください。')
    }
    fetchItems()
  }

  // ---------------------------------------------------------
  // 表示用の整形
  // ---------------------------------------------------------
  const visible = items
    .filter((i) => (showInactive ? true : i.is_active))
    .filter((i) => (categoryFilter === 'すべて' ? true : i.category === categoryFilter))

  const groups: { name: string; items: MenuItem[] }[] = []
  visible.forEach((item) => {
    const key = item.menu_group || '未分類'
    const found = groups.find((g) => g.name === key)
    if (found) found.items.push(item)
    else groups.push({ name: key, items: [item] })
  })

  const costRate = (item: MenuItem) => {
    if (item.cost === null || !item.price) return null
    return (item.cost / item.price) * 100
  }

  const rateClass = (rate: number) => {
    if (rate >= 40) return 'bg-red-100 text-red-700'
    if (rate >= 30) return 'bg-amber-100 text-amber-700'
    return 'bg-emerald-100 text-emerald-700'
  }

  const activeCount = items.filter((i) => i.is_active).length

  // ---------------------------------------------------------
  // 描画
  // ---------------------------------------------------------
  return (
    <div className="p-4 pb-24 md:pb-8 max-w-5xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">メニューマスタ</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            販売中 {activeCount}品目 / 登録 {items.length}品目
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={16} />
          品目を追加
        </button>
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap gap-2 mb-4">
        {['すべて', 'フード', 'ドリンク', 'アルコール'].map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className={
              categoryFilter === c
                ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-orange-500 text-white'
                : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }
          >
            {c}
          </button>
        ))}
        <button
          onClick={() => setShowInactive(!showInactive)}
          className={
            showInactive
              ? 'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 text-white ml-auto'
              : 'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 ml-auto'
          }
        >
          {showInactive ? <Eye size={14} /> : <EyeOff size={14} />}
          休止中も表示
        </button>
      </div>

      {/* エラー */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm mb-4">
          読み込みに失敗しました: {errorMsg}
        </div>
      )}

      {/* 本体 */}
      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中…</p>
      ) : items.length === 0 && !errorMsg ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
          <p className="text-gray-700 font-medium">品目がまだありません</p>
          <p className="text-sm text-gray-500 mt-1">
            データが入っているのに表示されない場合は、RLSのSELECTポリシーを確認してください。
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.name} className="mb-5">
            <h2 className="text-sm font-bold text-gray-500 mb-2">
              {group.name}
              <span className="ml-2 font-normal">{group.items.length}</span>
            </h2>
            <div className="space-y-2">
              {group.items.map((item) => {
                const rate = costRate(item)
                return (
                  <div
                    key={item.id}
                    className={
                      item.is_active
                        ? 'bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3'
                        : 'bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-3 opacity-60'
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{item.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.category}
                        {!item.is_active && ' ・休止中'}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900">¥{item.price.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">
                        原価 {item.cost === null ? '未設定' : `¥${item.cost.toLocaleString()}`}
                      </p>
                    </div>

                    <div className="w-14 text-center shrink-0">
                      {rate !== null && (
                        <span className={`text-xs font-bold px-2 py-1 rounded ${rateClass(rate)}`}>
                          {rate.toFixed(0)}%
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => toggleActive(item)}
                      title={item.is_active ? '休止する' : '販売を再開する'}
                      className="p-2 text-gray-400 hover:text-gray-700 shrink-0"
                    >
                      {item.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>

                    <button
                      onClick={() => openEdit(item)}
                      title="編集する"
                      className="p-2 text-gray-400 hover:text-orange-600 shrink-0"
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {/* モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="font-bold text-gray-900">
                {editingId ? '品目を編集' : '品目を追加'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">品目名 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="牛すじトマト煮"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">大カテゴリ</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">メニュー区分</label>
                  <input
                    value={form.menu_group}
                    onChange={(e) => setForm({ ...form, menu_group: e.target.value })}
                    list="menu-groups"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="看板料理"
                  />
                  <datalist id="menu-groups">
                    {Array.from(new Set(items.map((i) => i.menu_group).filter(Boolean))).map((g) => (
                      <option key={g as string} value={g as string} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">売価 *</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="1100"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">原価</label>
                  <input
                    type="number"
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="空欄可"
                  />
                </div>
              </div>

              {form.price !== '' && form.cost !== '' && Number(form.price) > 0 && (
                <p className="text-sm text-gray-600">
                  原価率{' '}
                  <span className="font-bold">
                    {((Number(form.cost) / Number(form.price)) * 100).toFixed(1)}%
                  </span>
                  ・粗利{' '}
                  <span className="font-bold">
                    ¥{(Number(form.price) - Number(form.cost)).toLocaleString()}
                  </span>
                </p>
              )}

              <div>
                <label className="block text-sm text-gray-600 mb-1">並び順</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="360"
                />
                <p className="text-xs text-gray-500 mt-1">
                  小さいほど先に表示されます。10刻みで空けてあります。
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4"
                />
                販売中にする
              </label>
            </div>

            <div className="flex gap-2 p-4 border-t border-gray-200">
              <button
                onClick={() => setModalOpen(false)}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 font-medium hover:bg-gray-50"
              >
                やめる
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg py-2 font-medium"
              >
                {saving ? '保存中…' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

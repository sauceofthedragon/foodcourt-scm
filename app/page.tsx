'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  CalendarDays,
  Users,
  ShoppingCart,
  Package,
  AlertTriangle,
  TrendingUp,
  Clock,
} from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import type { Reservation, Sale, InventoryItem } from '@/lib/database.types'

type DashboardStats = {
  todayReservations: number
  todaySales: number
  totalCustomers: number
  lowStockCount: number
  upcomingReservations: Reservation[]
  recentSales: Sale[]
  lowStockItems: InventoryItem[]
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    todayReservations: 0,
    todaySales: 0,
    totalCustomers: 0,
    lowStockCount: 0,
    upcomingReservations: [],
    recentSales: [],
    lowStockItems: [],
  })
  const [loading, setLoading] = useState(true)
  const today = format(new Date(), 'yyyy-MM-dd')

  const fetchStats = async () => {
    const [
      { count: reservationCount },
      { data: salesData },
      { count: customerCount },
      { data: inventoryData },
      { data: upcomingRes },
      { data: recentSales },
    ] = await Promise.all([
      supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('date', today)
        .neq('status', 'cancelled'),
      supabase.from('sales').select('amount').eq('date', today),
      supabase.from('customers').select('*', { count: 'exact', head: true }),
      supabase.from('inventory').select('*'),
      supabase
        .from('reservations')
        .select('*')
        .eq('date', today)
        .neq('status', 'cancelled')
        .order('time')
        .limit(5),
      supabase
        .from('sales')
        .select('*')
        .eq('date', today)
        .order('time', { ascending: false })
        .limit(5),
    ])

    const todaySales = salesData?.reduce((sum, s) => sum + s.amount, 0) ?? 0
    const lowStock = inventoryData?.filter((i) => i.stock <= i.min_stock) ?? []

    setStats({
      todayReservations: reservationCount ?? 0,
      todaySales,
      totalCustomers: customerCount ?? 0,
      lowStockCount: lowStock.length,
      upcomingReservations: upcomingRes ?? [],
      recentSales: recentSales ?? [],
      lowStockItems: lowStock.slice(0, 5),
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchStats()

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchStats)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const statCards = [
    {
      label: '本日の予約',
      value: stats.todayReservations,
      unit: '件',
      icon: CalendarDays,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      href: '/reservations',
    },
    {
      label: '本日の売上',
      value: stats.todaySales.toLocaleString(),
      unit: '円',
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
      href: '/sales',
    },
    {
      label: '登録顧客数',
      value: stats.totalCustomers,
      unit: '名',
      icon: Users,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      href: '/customers',
    },
    {
      label: '在庫不足',
      value: stats.lowStockCount,
      unit: '品目',
      icon: AlertTriangle,
      color: 'text-red-600',
      bg: 'bg-red-50',
      href: '/inventory',
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-gray-500">
          {format(new Date(), 'M月d日(E)', { locale: ja })}
        </p>
        <h1 className="page-title">ダッシュボード</h1>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {statCards.map((card) => (
          <Link key={card.href} href={card.href}>
            <div className="card hover:shadow-md transition-shadow">
              <div className={`inline-flex p-2 rounded-lg ${card.bg} mb-2`}>
                <card.icon size={18} className={card.color} />
              </div>
              <p className="text-xs text-gray-500 mb-0.5">{card.label}</p>
              <p className="text-2xl font-bold text-gray-900">
                {card.value}
                <span className="text-sm font-normal text-gray-500 ml-0.5">{card.unit}</span>
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* Upcoming reservations */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Clock size={16} className="text-orange-500" />
            本日の予約
          </h2>
          <Link href="/reservations" className="text-xs text-orange-600 font-medium">
            すべて見る
          </Link>
        </div>
        {stats.upcomingReservations.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">本日の予約はありません</p>
        ) : (
          <div className="space-y-2">
            {stats.upcomingReservations.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.customer_name}</p>
                  <p className="text-xs text-gray-500">{r.party}名 {r.table_no && `/ ${r.table_no}番卓`}</p>
                </div>
                <span className="text-sm font-semibold text-gray-700">
                  {r.time.slice(0, 5)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent sales */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <ShoppingCart size={16} className="text-orange-500" />
            本日の売上明細
          </h2>
          <Link href="/sales" className="text-xs text-orange-600 font-medium">
            すべて見る
          </Link>
        </div>
        {stats.recentSales.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">本日の売上記録はありません</p>
        ) : (
          <div className="space-y-2">
            {stats.recentSales.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {s.category || 'その他'}
                  </p>
                  <p className="text-xs text-gray-500">{s.time.slice(0, 5)} / {payMethodLabel(s.pay_method)}</p>
                </div>
                <span className="text-sm font-bold text-green-700">
                  ¥{s.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Low stock alert */}
      {stats.lowStockItems.length > 0 && (
        <div className="card border-red-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-red-700 flex items-center gap-2">
              <AlertTriangle size={16} />
              在庫不足アラート
            </h2>
            <Link href="/inventory" className="text-xs text-red-600 font-medium">
              在庫を確認
            </Link>
          </div>
          <div className="space-y-2">
            {stats.lowStockItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-1.5">
                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                <span className="text-sm text-red-600 font-semibold">
                  {item.stock}{item.unit} / 最低{item.min_stock}{item.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function payMethodLabel(method: string) {
  const labels: Record<string, string> = {
    cash: '現金',
    card: 'カード',
    qr: 'QR決済',
    other: 'その他',
  }
  return labels[method] ?? method
}

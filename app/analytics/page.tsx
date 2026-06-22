'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, subMonths, subDays, eachDayOfInterval as eachDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import clsx from 'clsx'

type ViewMode = 'daily' | 'monthly'

type DailyData = {
  date: string
  label: string
  amount: number
  count: number
}

type MonthlyData = {
  month: string
  label: string
  amount: number
  count: number
}

type CategoryData = {
  name: string
  value: number
}

// ── 来客数トレンド用 ──────────────────────────────────────────
type VisitorData = {
  date: string
  label: string
  lunch: number
  dinner: number
}

const PIE_COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444']

export default function AnalyticsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily')
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [dailyData, setDailyData] = useState<DailyData[]>([])
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([])
  const [categoryData, setCategoryData] = useState<CategoryData[]>([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState({
    total: 0,
    average: 0,
    count: 0,
    max: 0,
  })

  // ── 来客数トレンド state ──────────────────────────────────────
  const [visitorData, setVisitorData] = useState<VisitorData[]>([])
  const [visitorLoading, setVisitorLoading] = useState(true)

  const fetchDailyData = useCallback(async () => {
    setLoading(true)
    const monthStart = startOfMonth(new Date(selectedMonth + '-01'))
    const monthEnd = endOfMonth(monthStart)

    const { data: rawSalesData } = await supabase
      .from('sales')
      .select('date, amount, category')
      .gte('date', format(monthStart, 'yyyy-MM-dd'))
      .lte('date', format(monthEnd, 'yyyy-MM-dd'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const salesData = rawSalesData as any[] | null
    if (!salesData) { setLoading(false); return }

    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
    const grouped: Record<string, { amount: number; count: number }> = {}

    salesData.forEach((s) => {
      if (!grouped[s.date]) grouped[s.date] = { amount: 0, count: 0 }
      grouped[s.date].amount += s.amount
      grouped[s.date].count += 1
    })

    const daily = days.map((d) => {
      const key = format(d, 'yyyy-MM-dd')
      return {
        date: key,
        label: format(d, 'd日', { locale: ja }),
        amount: grouped[key]?.amount ?? 0,
        count: grouped[key]?.count ?? 0,
      }
    })

    setDailyData(daily)

    // Category breakdown
    const catGrouped: Record<string, number> = {}
    salesData.forEach((s) => {
      const cat = s.category || 'その他'
      catGrouped[cat] = (catGrouped[cat] ?? 0) + s.amount
    })
    setCategoryData(
      Object.entries(catGrouped)
        .sort(([, a], [, b]) => b - a)
        .map(([name, value]) => ({ name, value }))
    )

    const totalAmount = salesData.reduce((sum, s) => sum + s.amount, 0)
    const daysWithSales = daily.filter((d) => d.amount > 0)
    setSummary({
      total: totalAmount,
      count: salesData.length,
      average: daysWithSales.length ? Math.round(totalAmount / daysWithSales.length) : 0,
      max: Math.max(...daily.map((d) => d.amount), 0),
    })

    setLoading(false)
  }, [selectedMonth])

  const fetchMonthlyData = useCallback(async () => {
    setLoading(true)

    const months = Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(new Date(), 11 - i)
      return format(d, 'yyyy-MM')
    })

    const { data: rawMonthlySalesData } = await supabase
      .from('sales')
      .select('date, amount')
      .gte('date', months[0] + '-01')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const salesData = rawMonthlySalesData as any[] | null
    if (!salesData) { setLoading(false); return }

    const grouped: Record<string, { amount: number; count: number }> = {}
    salesData.forEach((s) => {
      const m = s.date.slice(0, 7)
      if (!grouped[m]) grouped[m] = { amount: 0, count: 0 }
      grouped[m].amount += s.amount
      grouped[m].count += 1
    })

    const monthly = months.map((m) => ({
      month: m,
      label: format(new Date(m + '-01'), 'M月', { locale: ja }),
      amount: grouped[m]?.amount ?? 0,
      count: grouped[m]?.count ?? 0,
    }))

    setMonthlyData(monthly)

    const total = salesData.reduce((sum: number, s: { amount: number }) => sum + s.amount, 0)
    const monthsWithSales = monthly.filter((m) => m.amount > 0)
    setSummary({
      total,
      count: salesData.length,
      average: monthsWithSales.length ? Math.round(total / monthsWithSales.length) : 0,
      max: Math.max(...monthly.map((m) => m.amount), 0),
    })

    setLoading(false)
  }, [])

  // ── 来客数トレンド フェッチ（直近30日固定） ──────────────────
  const fetchVisitorData = useCallback(async () => {
    setVisitorLoading(true)

    const today = new Date()
    const from = subDays(today, 29) // 30日前（当日含む）
    const fromStr = format(from, 'yyyy-MM-dd')
    const toStr = format(today, 'yyyy-MM-dd')

    const { data: raw } = await supabase
      .from('sales')
      .select('date, lunch_count, dinner_count')
      .gte('date', fromStr)
      .lte('date', toStr)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = raw as any[] | null

    // 日付ごとに SUM
    const grouped: Record<string, { lunch: number; dinner: number }> = {}
    if (rows) {
      rows.forEach((r) => {
        if (!grouped[r.date]) grouped[r.date] = { lunch: 0, dinner: 0 }
        grouped[r.date].lunch += r.lunch_count ?? 0
        grouped[r.date].dinner += r.dinner_count ?? 0
      })
    }

    // 30日分の連続した日付を生成し、欠損日は 0 補完
    const days = eachDay({ start: from, end: today })
    const visitor: VisitorData[] = days.map((d) => {
      const key = format(d, 'yyyy-MM-dd')
      return {
        date: key,
        label: format(d, 'M/d', { locale: ja }),
        lunch: grouped[key]?.lunch ?? 0,
        dinner: grouped[key]?.dinner ?? 0,
      }
    })

    setVisitorData(visitor)
    setVisitorLoading(false)
  }, [])

  useEffect(() => {
    if (viewMode === 'daily') {
      fetchDailyData()
    } else {
      fetchMonthlyData()
    }
  }, [viewMode, fetchDailyData, fetchMonthlyData])

  // 来客数トレンドはページロード時に一度だけ取得（viewMode に依存しない）
  useEffect(() => {
    fetchVisitorData()
  }, [fetchVisitorData])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartData: any[] = viewMode === 'daily' ? dailyData : monthlyData
  const xKey = 'label'

  const formatYAxis = (value: number) => {
    if (value >= 10000) return `${(value / 10000).toFixed(0)}万`
    if (value >= 1000) return `${(value / 1000).toFixed(0)}千`
    return String(value)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-100 shadow-lg rounded-lg px-3 py-2 text-xs">
          <p className="font-semibold text-gray-900 mb-1">{label}</p>
          <p className="text-green-700">売上: ¥{(payload[0]?.value ?? 0).toLocaleString()}</p>
          {payload[1] && <p className="text-blue-600">件数: {payload[1]?.value}件</p>}
        </div>
      )
    }
    return null
  }

  // ── 来客数トレンド用 Tooltip ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const VisitorTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-100 shadow-lg rounded-lg px-3 py-2 text-xs">
          <p className="font-semibold text-gray-900 mb-1">{label}</p>
          <p className="text-blue-500">ランチ: {payload[0]?.value ?? 0}人</p>
          <p className="text-orange-500">ディナー: {payload[1]?.value ?? 0}人</p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">売上分析</h1>
      </div>

      {/* View mode toggle */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        {(['daily', 'monthly'] as ViewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={clsx(
              'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
              viewMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            )}
          >
            {m === 'daily' ? '日別' : '月別'}
          </button>
        ))}
      </div>

      {viewMode === 'daily' && (
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="input-field"
        />
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">
            {viewMode === 'daily' ? '月間' : '年間'}売上合計
          </p>
          <p className="text-xl font-bold text-gray-900">
            ¥{summary.total.toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">
            {viewMode === 'daily' ? '日平均売上' : '月平均売上'}
          </p>
          <p className="text-xl font-bold text-gray-900">
            ¥{summary.average.toLocaleString()}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">取引件数</p>
          <p className="text-xl font-bold text-gray-900">{summary.count}件</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">最高売上日</p>
          <p className="text-xl font-bold text-gray-900">
            ¥{summary.max.toLocaleString()}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : (
        <>
          {/* Bar chart */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">
              {viewMode === 'daily' ? '日別売上' : '月別売上'}
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey={xKey}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  interval={viewMode === 'daily' ? 4 : 0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatYAxis}
                  width={36}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amount" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Line chart */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">売上推移</h2>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey={xKey}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  interval={viewMode === 'daily' ? 4 : 0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatYAxis}
                  width={36}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Category pie chart */}
          {viewMode === 'daily' && categoryData.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">カテゴリ別売上</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`¥${Number(value ?? 0).toLocaleString()}`, '']}
                  />
                  <Legend
                    formatter={(value) => <span className="text-xs">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {categoryData.map((c, i) => {
                  const pct = summary.total > 0 ? ((c.value / summary.total) * 100).toFixed(1) : '0'
                  return (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="text-gray-700">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs">{pct}%</span>
                        <span className="font-semibold text-gray-900">
                          ¥{c.value.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 来客数トレンド（直近30日） ────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">来客数トレンド</h2>
          <span className="text-xs text-gray-400">直近30日</span>
        </div>

        {visitorLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={visitorData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  interval={4}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={28}
                />
                <Tooltip content={<VisitorTooltip />} />
                <Line
                  type="monotone"
                  dataKey="lunch"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  name="ランチ"
                />
                <Line
                  type="monotone"
                  dataKey="dinner"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  name="ディナー"
                />
              </LineChart>
            </ResponsiveContainer>

            {/* 凡例 */}
            <div className="flex items-center gap-4 mt-3 justify-end">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-blue-500 inline-block rounded" />
                <span className="text-xs text-gray-500">ランチ</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-orange-500 inline-block rounded" />
                <span className="text-xs text-gray-500">ディナー</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  ShoppingCart,
  Package,
  UtensilsCrossed,
  BarChart2,
} from 'lucide-react'
import clsx from 'clsx'

// showOnMobile: false の項目はボトムナビに出さない。
// ボトムナビは flex-1 の等分割なので、項目を増やすほど1つあたりの幅が痩せる。
// 10px の日本語ラベル（例「ダッシュボード」= 約70px）に対して、
// 6項目・380px端末で1項目あたり63px。すでに余裕がない。
// メニューマスタは週次のPC作業なので、モバイルからは外す。
const navItems = [
  { href: '/', label: 'ダッシュボード', icon: LayoutDashboard, showOnMobile: true },
  { href: '/reservations', label: '予約', icon: CalendarDays, showOnMobile: true },
  { href: '/customers', label: '顧客台帳', icon: Users, showOnMobile: true },
  { href: '/sales', label: '売上', icon: ShoppingCart, showOnMobile: true },
  { href: '/inventory', label: '在庫', icon: Package, showOnMobile: true },
  { href: '/menu', label: 'メニュー', icon: UtensilsCrossed, showOnMobile: false },
  { href: '/analytics', label: '分析', icon: BarChart2, showOnMobile: true },
]

const mobileNavItems = navItems.filter((item) => item.showOnMobile)

export default function Navigation() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-full w-56 bg-white border-r border-gray-200 z-40">
        <div className="px-4 py-5 border-b border-gray-100">
          <h1 className="text-base font-bold text-orange-600 leading-tight">
            ソースオブザドラゴン<br />管理システム
          </h1>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-orange-50 text-orange-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon size={18} />
                {label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 safe-area-pb">
        <div className="flex">
          {mobileNavItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors',
                  active ? 'text-orange-600' : 'text-gray-500'
                )}
              >
                <Icon size={22} />
                <span className="text-[10px] leading-none">{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

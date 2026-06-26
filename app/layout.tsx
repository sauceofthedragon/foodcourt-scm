import type { Metadata, Viewport } from 'next'
import './globals.css'
import Navigation from '@/components/Navigation'
import { InactivityGuard } from '@/components/InactivityGuard' 

export const metadata: Metadata = {
  title: 'フードコート管理システム',
  description: 'フードコート向け統合管理アプリ',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50">
        <InactivityGuard /> 
        <div className="flex min-h-screen">
          <Navigation />
          <main className="flex-1 pb-20 md:pb-0 md:pl-56">
            <div className="max-w-4xl mx-auto px-4 py-4 md:py-6">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  )
}

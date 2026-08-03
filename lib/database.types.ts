export type Database = {
  public: {
    Tables: {
      customers: {
        Row: Customer
        Insert: Omit<Customer, 'id' | 'created_at'>
        Update: Partial<Omit<Customer, 'id' | 'created_at'>>
      }
      reservations: {
        Row: Reservation
        Insert: Omit<Reservation, 'id' | 'created_at'>
        Update: Partial<Omit<Reservation, 'id' | 'created_at'>>
      }
      sales: {
        Row: Sale
        Insert: Omit<Sale, 'id' | 'created_at'>
        Update: Partial<Omit<Sale, 'id' | 'created_at'>>
      }
      inventory: {
        Row: InventoryItem
        Insert: Omit<InventoryItem, 'id' | 'created_at'>
        Update: Partial<Omit<InventoryItem, 'id' | 'created_at'>>
      }
      purchases: {
        Row: Purchase
        Insert: Omit<Purchase, 'id' | 'created_at'>
        Update: Partial<Omit<Purchase, 'id' | 'created_at'>>
      }
      purchase_receipts: {
        Row: PurchaseReceipt
        Insert: Omit<PurchaseReceipt, 'id' | 'created_at' | 'imported_at' | 'user_id'>
        Update: Partial<Omit<PurchaseReceipt, 'id' | 'created_at'>>
      }
      inventory_counts: {
        Row: InventoryCount
        Insert: Omit<InventoryCount, 'id' | 'created_at' | 'updated_at' | 'user_id'>
        Update: Partial<Omit<InventoryCount, 'id' | 'created_at'>>
      }
    }
  }
}

export type Customer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  visit_count: number
  created_at: string
}

export type ReservationStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show'

export type Reservation = {
  id: string
  customer_id: string | null
  customer_name: string
  date: string
  time: string
  party: number
  table_no: string | null
  status: ReservationStatus
  notes: string | null
  created_at: string
}

export type PayMethod = 'cash' | 'card' | 'qr' | 'other'

export type Sale = {
  id: string
  date: string
  time: string
  amount: number
  pay_method: PayMethod
  category: string | null
  table_no: string | null
  notes: string | null
  created_at: string
  lunch_count: number | null
  dinner_count: number | null
}

export type InventoryItem = {
  id: string
  name: string
  category: string | null
  unit: string
  stock: number
  min_stock: number
  supplier: string | null
  unit_cost: number | null
  created_at: string
}

/**
 * 原価区分。
 * food      = 食材・飲料・調味料      → 原価率の分子に常に含む
 * supply    = 包材・消耗品            → トグルで含める／外す
 * equipment = 備品                    → 原価率には含めない
 * other     = それ以外                → 原価率には含めない
 * null      = 未分類                  → 集計時に必ず別枠で可視化する
 */
export type CostCategory = 'food' | 'supply' | 'equipment' | 'other'

export type Purchase = {
  id: string
  date: string
  item_id: string | null
  item_name: string
  qty: number
  unit_cost: number
  total: number
  supplier: string | null
  notes: string | null
  created_at: string
  /** 領収証取り込み由来の明細が参照する親レシート。手入力の仕入れは null */
  receipt_id?: string | null
  /** レシート内の明細順序（1始まり）。手入力の仕入れは null */
  line_no?: number | null
  /** 税率区分（8 または 10）。不明時は null */
  tax_rate?: number | null
  /** 原価区分。null は未分類 */
  cost_category?: CostCategory | null
}

/** OCR の状態。failed は存在しない（失敗した画像は行を作らず 00_未取込 に残す） */
export type OcrStatus = 'ok' | 'partial'

/** 領収証1枚 = 1行。明細は purchases 側に receipt_id で紐づく */
export type PurchaseReceipt = {
  id: string
  date: string
  supplier: string | null
  subtotal: number | null
  tax: number | null
  discount: number | null
  total: number
  pay_method: PayMethod | null
  notes: string | null
  /** Drive の fileId。この列の UNIQUE 制約が二重取り込み防止の本体 */
  source_file_id: string
  source_file_name: string | null
  source_url: string | null
  ocr_raw: unknown | null
  ocr_model: string | null
  ocr_status: OcrStatus
  imported_at: string
  user_id: string
  created_at: string
}

/** 月末簡易棚卸。month は必ずその月の1日に正規化して保存する */
export type InventoryCount = {
  id: string
  month: string
  cost_category: CostCategory
  amount: number
  counted_on: string | null
  notes: string | null
  user_id: string
  created_at: string
  updated_at: string
}

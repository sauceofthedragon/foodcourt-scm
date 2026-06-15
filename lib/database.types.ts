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
}

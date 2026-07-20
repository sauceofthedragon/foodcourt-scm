// デモ用ダミーデータの生成ロジック。
// 実行日を基準に過去90日分（当月は月初〜実行日）を生成する相対設計。
// すべての波形はseed可能なPRNG(mulberry32)から導出され、同じseedなら同じ結果になる。

const CATEGORIES = ['フード', 'ドリンク', 'アルコール', 'デザート', 'セット', 'テイクアウト', 'その他']
const PAY_METHODS = ['cash', 'card', 'qr', 'other']
const PAY_METHOD_WEIGHTS = [0.45, 0.3, 0.2, 0.05]
const CLOSED_WEEKDAY = 2 // 0=日,1=月,2=火...6=土 → 火曜定休
const DEMO_CUSTOMER_NAMES = [
  'サンプル太郎', 'デモ花子', 'テスト次郎', '見本三郎',
  'ダミー美咲', '試作健太', '仮名ゆり', '検証一郎', '架空すみれ', 'モック大輔',
]
const INVENTORY_DEFS = [
  ['鶏もも肉', '食材', 'kg', 400],
  ['豚バラ肉', '食材', 'kg', 550],
  ['玉ねぎ', '食材', '個', 40],
  ['じゃがいも', '食材', '個', 35],
  ['にんじん', '食材', '本', 30],
  ['キャベツ', '食材', '玉', 150],
  ['米', '食材', 'kg', 450],
  ['卵', '食材', '個', 25],
  ['豆腐', '食材', '丁', 60],
  ['醤油', '調味料', 'L', 400],
  ['みりん', '調味料', 'L', 500],
  ['塩', '調味料', 'kg', 200],
  ['サラダ油', '調味料', 'L', 350],
  ['小麦粉', '調味料', 'kg', 250],
  ['ビール', '飲料', '本', 280],
  ['日本酒', '飲料', '本', 900],
  ['烏龍茶', '飲料', '本', 120],
  ['コーラ', '飲料', '本', 130],
  ['紙ナプキン', '消耗品', '個', 5],
  ['割り箸', '消耗品', '膳', 3],
  ['テイクアウト容器', '消耗品', '個', 20],
  ['食器用洗剤', '消耗品', '本', 300],
  ['エプロン', '備品', '枚', 1200],
]

function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function weightedPick(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}

function dateRangePast(days, endDate) {
  const end = endDate ? new Date(endDate) : new Date()
  const dates = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    dates.push(d)
  }
  return dates
}

function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function weekdayFactor(dow, rng) {
  if (dow === 5 || dow === 6) return 1.3 + rng() * 0.3 // 金・土
  if (dow === 0) return 1.0 + rng() * 0.2 // 日
  return 0.9 + rng() * 0.2 // 平日
}

// 低周波サイン波＋クリップ済みランダムウォークで「緩やかな増減」を作る（単調増減は起きない）
function buildDriftSeries(totalDays, rng) {
  const drift = []
  let walk = 0
  const phase = rng() * Math.PI * 2
  for (let i = 0; i < totalDays; i++) {
    walk += (rng() - 0.5) * 0.02
    walk = Math.max(-0.1, Math.min(0.1, walk))
    const sine = Math.sin((i / totalDays) * Math.PI * 2 * 1.2 + phase) * 0.08
    let factor = 1 + sine + walk
    factor = Math.max(0.85, Math.min(1.15, factor))
    drift.push(factor)
  }
  return drift
}

function pickOutlierDays(openDayIndices, rng, countHigh, countLow) {
  const pool = [...openDayIndices]
  const highs = new Set()
  const lows = new Set()
  for (let i = 0; i < countHigh && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length)
    highs.add(pool.splice(idx, 1)[0])
  }
  for (let i = 0; i < countLow && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length)
    lows.add(pool.splice(idx, 1)[0])
  }
  return { highs, lows }
}

function generateDemoData(seedValue) {
  const rng = mulberry32(seedValue)
  const days = dateRangePast(90)
  const openDayIndices = []
  days.forEach((d, i) => {
    if (d.getDay() !== CLOSED_WEEKDAY) openDayIndices.push(i)
  })

  const drift = buildDriftSeries(days.length, rng)
  const { highs, lows } = pickOutlierDays(
    openDayIndices,
    rng,
    randInt(rng, 3, 5),
    randInt(rng, 3, 5)
  )

  // 顧客（明らかに架空と分かるダミー名）
  const customerCount = randInt(rng, 6, 10)
  const customers = []
  for (let i = 0; i < customerCount; i++) {
    customers.push({
      name: DEMO_CUSTOMER_NAMES[i % DEMO_CUSTOMER_NAMES.length],
      phone: `000-0000-${String(1000 + i).slice(-4)}`,
      email: `demo-user${i + 1}@example.com`,
      notes: 'デモデータ',
      visit_count: randInt(rng, 0, 12),
    })
  }

  // 在庫（一般的な食材名、実取引と無関係）
  const inventory = INVENTORY_DEFS.map(([name, category, unit, unitCost]) => {
    const minStock = randInt(rng, 5, 20)
    const isLow = rng() < 0.25
    const stock = isLow
      ? Math.max(0, minStock - randInt(rng, 1, 5))
      : minStock + randInt(rng, 5, 40)
    return {
      name,
      category,
      unit,
      stock,
      min_stock: minStock,
      supplier: `${category}卸A`,
      unit_cost: unitCost,
    }
  })

  const sales = []
  const reservations = []
  const purchases = []

  days.forEach((d, i) => {
    if (d.getDay() === CLOSED_WEEKDAY) return // 定休日はデータなし

    const isWeekend = d.getDay() === 5 || d.getDay() === 6
    let factor = weekdayFactor(d.getDay(), rng) * drift[i]
    if (highs.has(i)) factor *= 1.8 + rng() * 0.4
    if (lows.has(i)) factor *= 0.3 + rng() * 0.2

    const baseLow = isWeekend ? 55000 : 35000
    const baseHigh = isWeekend ? 90000 : 60000
    const dayTarget = Math.max(3000, Math.round((baseLow + rng() * (baseHigh - baseLow)) * factor))

    const txCount = isWeekend ? randInt(rng, 15, 25) : randInt(rng, 8, 15)
    const lunchRatio = isWeekend ? 0.3 : 0.4
    const dateStr = fmtDate(d)

    let remaining = dayTarget
    for (let t = 0; t < txCount; t++) {
      const isLast = t === txCount - 1
      const amount = isLast
        ? Math.max(500, remaining)
        : Math.max(500, Math.round((remaining / (txCount - t)) * (0.5 + rng())))
      remaining -= amount

      const isLunch = rng() < lunchRatio
      const hour = isLunch ? randInt(rng, 11, 14) : randInt(rng, 17, 21)
      const minute = randInt(rng, 0, 59)
      const party = randInt(rng, 1, 4)

      sales.push({
        date: dateStr,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
        amount,
        pay_method: weightedPick(rng, PAY_METHODS, PAY_METHOD_WEIGHTS),
        category: pick(rng, CATEGORIES),
        table_no: String(randInt(rng, 1, 12)),
        notes: null,
        lunch_count: isLunch ? party : 0,
        dinner_count: isLunch ? 0 : party,
      })
    }

    const resCount = randInt(rng, 3, 10)
    for (let r = 0; r < resCount; r++) {
      const isLunch = rng() < lunchRatio
      const hour = isLunch ? randInt(rng, 11, 14) : randInt(rng, 17, 21)
      const minute = pick(rng, ['00', '15', '30', '45'])
      const statusRoll = rng()
      const status = statusRoll < 0.8 ? 'completed' : statusRoll < 0.9 ? 'cancelled' : 'no_show'

      reservations.push({
        customer_name: `${pick(rng, DEMO_CUSTOMER_NAMES)}様`,
        date: dateStr,
        time: `${String(hour).padStart(2, '0')}:${minute}:00`,
        party: randInt(rng, 1, 6),
        table_no: String(randInt(rng, 1, 12)),
        status,
        notes: null,
      })
    }

    // 仕入：週2〜3回のペース
    if (rng() < 3 / 7) {
      const itemCount = randInt(rng, 2, 5)
      for (let p = 0; p < itemCount; p++) {
        const item = pick(rng, INVENTORY_DEFS)
        const qty = randInt(rng, 5, 30)
        const unitCost = item[3]
        purchases.push({
          date: dateStr,
          item_name: item[0],
          qty,
          unit_cost: unitCost,
          total: qty * unitCost,
          supplier: `${item[1]}卸A`,
          notes: null,
        })
      }
    }
  })

  return { customers, inventory, sales, reservations, purchases }
}

module.exports = {
  mulberry32,
  generateDemoData,
  dateRangePast,
  fmtDate,
}

/**
 * EventBridge cron, read and written.
 *
 * A schedules page whose only answer to "when does this run" is `0 8 ? * MON-FRI *` has not
 * answered. This turns the six fields into English and into the actual next firing times, and
 * builds one back from a frequency the person picked. Six fields, always UTC:
 *
 *     minute  hour  day-of-month  month  day-of-week  year
 *
 * Exactly one of day-of-month / day-of-week is `?` — that is EventBridge's rule, not cron's.
 * Day-of-week is 1-7 with SUN=1, or the three-letter names.
 */
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export type Fields = { min: string; hour: string; dom: string; month: string; dow: string; year: string }

/** Glue hands schedules back wrapped as `cron(...)`. */
export const unwrap = (s: string): string => /^cron\((.*)\)$/.exec(s.trim())?.[1] ?? s.trim()

export function fields(expr: string): Fields | null {
  const p = unwrap(expr).split(/\s+/)
  if (p.length !== 6) return null
  return { min: p[0]!, hour: p[1]!, dom: p[2]!, month: p[3]!, dow: p[4]!, year: p[5]! }
}

/** One field to the set of numbers it allows. Returns null when the field cannot be read. */
function expand(field: string, lo: number, hi: number, names?: string[]): Set<number> | null {
  const out = new Set<number>()
  const num = (t: string): number | null => {
    const i = names ? names.indexOf(t.toUpperCase()) : -1
    if (i >= 0) return i + (names === DOW ? 1 : 1)     // both are 1-based in EventBridge
    return /^\d+$/.test(t) ? Number(t) : null
  }
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isFinite(step) || step < 1) return null
    let a = lo, b = hi
    if (range !== '*' && range !== '?') {
      const m = range!.split('-')
      const first = num(m[0]!)
      if (first == null) return null
      a = first
      b = m.length > 1 ? (num(m[1]!) ?? -1) : (stepRaw === undefined ? first : hi)
      if (b < 0) return null
    }
    if (a < lo || b > hi || a > b) return null
    for (let v = a; v <= b; v += step) out.add(v)
  }
  return out.size ? out : null
}

type Sets = { min: Set<number>; hour: Set<number>; dom: Set<number> | null; month: Set<number>; dow: Set<number> | null; year: Set<number> | null }

function sets(f: Fields): Sets | null {
  const min = expand(f.min, 0, 59), hour = expand(f.hour, 0, 23), month = expand(f.month, 1, 12, MON)
  if (!min || !hour || !month) return null
  const dom = f.dom === '?' || f.dom === '*' ? null : expand(f.dom, 1, 31)
  const dow = f.dow === '?' || f.dow === '*' ? null : expand(f.dow, 1, 7, DOW)
  if ((f.dom !== '?' && f.dom !== '*' && !dom) || (f.dow !== '?' && f.dow !== '*' && !dow)) return null
  const year = f.year === '*' || f.year === '?' ? null : expand(f.year, 1970, 2199)
  if (f.year !== '*' && f.year !== '?' && !year) return null
  return { min, hour, dom, month, dow, year }
}

/**
 * The next `n` firing times at or after `from`, in UTC.
 *
 * Walks candidate days rather than minutes — a yearly schedule is ~1500 day checks instead of two
 * million minute checks — and gives up after four years so a nonsense expression cannot hang.
 */
export function nextRuns(expr: string, from: Date = new Date(), n = 3): Date[] {
  const f = fields(expr)
  const s = f && sets(f)
  if (!s) return []
  const out: Date[] = []
  const hours = [...s.hour].sort((a, b) => a - b)
  const mins = [...s.min].sort((a, b) => a - b)
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  for (let i = 0; i < 366 * 4 && out.length < n; i++) {
    const y = day.getUTCFullYear()
    const okYear = !s.year || s.year.has(y)
    const okMonth = s.month.has(day.getUTCMonth() + 1)
    // EventBridge: whichever of the two is not `?` decides the day
    const okDay = okYear && okMonth
      && (s.dom ? s.dom.has(day.getUTCDate()) : true)
      && (s.dow ? s.dow.has(day.getUTCDay() + 1) : true)
    if (okDay) {
      for (const h of hours) {
        for (const m of mins) {
          const t = new Date(Date.UTC(y, day.getUTCMonth(), day.getUTCDate(), h, m))
          if (t > from) { out.push(t); if (out.length === n) return out }
        }
      }
    }
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return out
}

const hhmm = (h: Set<number>, m: Set<number>) => {
  const hs = [...h].sort((a, b) => a - b), ms = [...m].sort((a, b) => a - b)
  if (hs.length === 1 && ms.length === 1) return `${String(hs[0]).padStart(2, '0')}:${String(ms[0]).padStart(2, '0')}`
  return null
}
const list = (v: number[], names: string[], base = 1) => v.map((x) => names[x - base]).join(', ')
const ord = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`

/** Plain English for the common shapes; an honest field summary for the rest. */
export function describe(expr: string): string {
  const f = fields(expr)
  const s = f && sets(f)
  if (!f || !s) return 'Custom schedule'
  const at = hhmm(s.hour, s.min)
  const every = /^\*\/(\d+)$/.exec(f.min)
  const everyH = /^\*\/(\d+)$/.exec(f.hour)

  if (f.min === '*' ) return 'Every minute'
  if (every && f.hour === '*') return `Every ${every[1]} minutes`
  if (everyH && s.min.size === 1) return `Every ${everyH[1]} hours at :${String([...s.min][0]).padStart(2, '0')}`
  if (f.hour === '*' && s.min.size === 1) return `Hourly at :${String([...s.min][0]).padStart(2, '0')}`
  if (!at) return 'Custom schedule'

  const days = s.dow ? [...s.dow].sort((a, b) => a - b) : null
  if (days) {
    const weekdays = days.length === 5 && days.every((d) => d >= 2 && d <= 6)
    const weekend = days.length === 2 && days.includes(1) && days.includes(7)
    const which = weekdays ? 'every weekday' : weekend ? 'at weekends' : `every ${list(days, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])}`
    return `${which[0]!.toUpperCase()}${which.slice(1)} at ${at} UTC`
  }
  if (s.dom) {
    const d = [...s.dom].sort((a, b) => a - b)
    return `Monthly on the ${d.map(ord).join(', ')} at ${at} UTC`
  }
  return `Every day at ${at} UTC`
}

/* -------------------------------------------------------------- building */

export type Every = 'hour' | 'day' | 'week' | 'month'
export type Spec = { every: Every; minute: number; hour: number; days: number[]; dayOfMonth: number }

export const DEFAULT_SPEC: Spec = { every: 'day', minute: 0, hour: 6, days: [2, 3, 4, 5, 6], dayOfMonth: 1 }

export function build(s: Spec): string {
  const m = String(s.minute)
  switch (s.every) {
    case 'hour': return `${m} * * * ? *`
    case 'day': return `${m} ${s.hour} * * ? *`
    case 'week': return `${m} ${s.hour} ? * ${(s.days.length ? [...s.days].sort((a, b) => a - b) : [2]).map((d) => DOW[d - 1]).join(',')} *`
    case 'month': return `${m} ${s.hour} ${s.dayOfMonth} * ? *`
  }
}

/** Read an expression back into the builder, so editing an existing schedule is not a rewrite. */
export function toSpec(expr: string): Spec | null {
  const f = fields(expr)
  const s = f && sets(f)
  if (!f || !s || s.min.size !== 1) return null
  const minute = [...s.min][0]!
  if (f.hour === '*') return { ...DEFAULT_SPEC, every: 'hour', minute }
  if (s.hour.size !== 1) return null
  const hour = [...s.hour][0]!
  if (s.dow) return { ...DEFAULT_SPEC, every: 'week', minute, hour, days: [...s.dow].sort((a, b) => a - b) }
  if (s.dom) { const d = [...s.dom]; return d.length === 1 ? { ...DEFAULT_SPEC, every: 'month', minute, hour, dayOfMonth: d[0]! } : null }
  return { ...DEFAULT_SPEC, every: 'day', minute, hour }
}

export const WEEKDAYS: [number, string][] = [[2, 'Mon'], [3, 'Tue'], [4, 'Wed'], [5, 'Thu'], [6, 'Fri'], [7, 'Sat'], [1, 'Sun']]

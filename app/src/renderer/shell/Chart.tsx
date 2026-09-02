import { useMemo, useRef, useState } from 'react'

/**
 * The chart set, in inline SVG. Two forms only, because the app needs two: a time series (one or
 * two lines with a crosshair) and a stacked category bar. Colours come from the validated palettes
 * below — categorical for series identity, the status four for run outcomes, which always ship with
 * a labelled legend so identity is never colour alone.
 */
const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
/** Validated with the palette checker: light #1D4ED8,#C2410C,#047857,#A21CAF · dark #4A86E8,#C07F1F,#2BA774,#B96BB4 */
export const SERIES = () => (dark() ? ['#4A86E8', '#C07F1F', '#2BA774', '#B96BB4'] : ['#1D4ED8', '#C2410C', '#047857', '#A21CAF'])
export const STATUS: Record<string, string> = { succeeded: 'var(--add)', failed: 'var(--del)', stopped: 'var(--warn)', running: 'var(--accent)' }

export type Point = [number, number]

export function fmtValue(v: number, unit?: string): string {
  if (unit === 'bytes') { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = v; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ } return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}` }
  if (unit === 'percent') return `${(v * (v <= 1 ? 100 : 1)).toFixed(0)}%`
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return String(Math.round(v * 100) / 100)
}
const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** One measure over time. Two series at most; more than that is two charts. */
export function TimeChart({ title, series, unit, height = 130 }: { title: string; series: { label: string; points: Point[] }[]; unit?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const box = useRef<SVGSVGElement>(null)
  const colors = SERIES()
  const W = 560, H = height, PADL = 46, PADR = 10, PADT = 10, PADB = 20
  const all = series.flatMap((s) => s.points)
  const geom = useMemo(() => {
    if (!all.length) return null
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys, 0)
    const sx = (x: number) => PADL + ((x - x0) / Math.max(1, x1 - x0)) * (W - PADL - PADR)
    const sy = (y: number) => H - PADB - (y / Math.max(1e-9, y1)) * (H - PADT - PADB)
    return { x0, x1, y1, sx, sy }
  }, [all, H])
  if (!geom || !all.length) return <div className="chart"><div className="chart-title">{title}</div><div className="faint small" style={{ padding: '18px 0', textAlign: 'center' }}>no data points</div></div>
  const { x0, x1, y1, sx, sy } = geom
  const ticks = [0, y1 / 2, y1]
  const at = hover == null ? null : x0 + (hover / (W - PADL - PADR)) * (x1 - x0)
  const nearest = (pts: Point[]) => (at == null ? null : pts.reduce((a, b) => (Math.abs(b[0] - at) < Math.abs(a[0] - at) ? b : a)))
  return (
    <div className="chart">
      <div className="row"><div className="chart-title">{title}</div><span className="fill" />
        {series.length > 1 && series.map((s, i) => <span key={s.label} className="legend"><span className="swatch" style={{ background: colors[i % colors.length] }} />{s.label}</span>)}
      </div>
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}
        onMouseMove={(e) => { const r = box.current!.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W - PADL; setHover(Math.max(0, Math.min(W - PADL - PADR, x))) }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => <g key={i}><line x1={PADL} x2={W - PADR} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth="1" /><text x={PADL - 6} y={sy(t) + 3} textAnchor="end" className="tick">{fmtValue(t, unit)}</text></g>)}
        <text x={PADL} y={H - 6} className="tick">{time(x0)}</text>
        <text x={W - PADR} y={H - 6} textAnchor="end" className="tick">{time(x1)}</text>
        {series.map((s, i) => {
          if (s.points.length === 0) return null
          const d = s.points.map((p, k) => `${k ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')
          return <g key={s.label}>
            <path d={d} fill="none" stroke={colors[i % colors.length]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.points.length === 1 && <circle cx={sx(s.points[0]![0])} cy={sy(s.points[0]![1])} r="4" fill={colors[i % colors.length]} />}
          </g>
        })}
        {at != null && <line x1={sx(at)} x2={sx(at)} y1={PADT} y2={H - PADB} stroke="var(--line-strong)" strokeWidth="1" />}
        {at != null && series.map((s, i) => { const p = nearest(s.points); return p ? <circle key={s.label} cx={sx(p[0])} cy={sy(p[1])} r="4" fill={colors[i % colors.length]} stroke="var(--raised)" strokeWidth="2" /> : null })}
      </svg>
      {at != null && (
        <div className="chart-tip">
          <span className="fig">{time(nearest(series[0]!.points)?.[0] ?? at)}</span>
          {series.map((s, i) => { const p = nearest(s.points); return p ? <span key={s.label} className="row" style={{ gap: 5 }}><span className="swatch" style={{ background: colors[i % colors.length] }} />{series.length > 1 ? s.label + ' ' : ''}<b className="fig">{fmtValue(p[1], unit)}</b></span> : null })}
        </div>)}
    </div>
  )
}

/** Counts by category, stacked by run outcome. Status colours, always with the legend. */
export function StackedBars({ title, data, keys, height = 150, onPick }:
  { title: string; data: { label: string; values: Record<string, number> }[]; keys: string[]; height?: number; onPick?: (label: string, key?: string) => void }) {
  const max = Math.max(1, ...data.map((d) => keys.reduce((s, k) => s + (d.values[k] ?? 0), 0)))
  const H = height, barH = 18, gap = 8
  const rows = data.slice(0, 12)
  if (!rows.length) return null
  return (
    <div className="chart">
      <div className="row"><div className="chart-title">{title}</div><span className="fill" />
        {keys.map((k) => <span key={k} className="legend"><span className="swatch" style={{ background: STATUS[k] ?? 'var(--dim)' }} />{k}</span>)}
      </div>
      <div className="bars" style={{ minHeight: Math.min(H, rows.length * (barH + gap)) }}>
        {rows.map((d) => {
          const total = keys.reduce((s, k) => s + (d.values[k] ?? 0), 0)
          return (
            <div key={d.label} className="bar-row" onClick={() => onPick?.(d.label)}>
              <span className="bar-label" title={d.label}>{d.label}</span>
              <span className="bar-track">
                {keys.map((k) => { const v = d.values[k] ?? 0; return v ? <span key={k} className="bar-seg" title={`${d.label} · ${k}: ${v}`} style={{ width: `${(v / max) * 100}%`, background: STATUS[k] ?? 'var(--dim)' }} /> : null })}
              </span>
              <span className="bar-value fig">{total}</span>
            </div>)
        })}
      </div>
    </div>
  )
}

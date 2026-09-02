export function ago(iso?: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
export function duration(sec?: number | null, startedOn?: string | null, running = false): string {
  let s = sec ?? 0
  if (running && startedOn) s = Math.max(s, Math.floor((Date.now() - new Date(startedOn).getTime()) / 1000))
  if (!s) return '—'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${r}s` : `${r}s`
}
export function stateTone(state?: string): 'ok' | 'err' | 'warn' | 'info' | '' {
  switch (state) {
    case 'SUCCEEDED': return 'ok'
    case 'FAILED': case 'ERROR': case 'TIMEOUT': return 'err'
    case 'STOPPED': case 'STOPPING': case 'EXPIRED': return 'warn'
    case 'RUNNING': case 'STARTING': case 'WAITING': return 'info'
    default: return ''
  }
}
export const RUNNING_STATES = new Set(['STARTING', 'RUNNING', 'STOPPING', 'WAITING'])
export function isRunning(state?: string): boolean { return !!state && RUNNING_STATES.has(state) }
export function when(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

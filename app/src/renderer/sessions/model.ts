import type { SessionInfo, StatementResult } from '@/wire/types'

/**
 * What a session costs and how long it has left.
 *
 * A session bills for every minute it is alive, whether or not anyone is typing into it — a
 * G.1X × 2 left running overnight is real money. The old page showed `0.00 DPU-h` in 12px grey
 * and nothing else, so this is the arithmetic the header needs to make that impossible to miss.
 */
const DPU: Record<string, number> = { 'G.025X': 0.25, 'G.1X': 1, 'G.2X': 2, 'G.4X': 4, 'G.8X': 8, 'G.12X': 12, 'G.16X': 16, 'R.1X': 1, 'R.2X': 2, 'R.4X': 4, 'R.8X': 8, 'Z.2X': 2 }
/** Glue's standard rate. Regional rates differ, so everything derived from it is labelled "≈". */
export const RATE = 0.44

export const LIVE = new Set(['PROVISIONING', 'READY'])
export const isLive = (s?: string): boolean => !!s && LIVE.has(s)

export function dpu(workerType?: string, workers?: number): number {
  return (DPU[workerType ?? 'G.1X'] ?? 1) * (workers ?? 2)
}
export const perHour = (s: SessionInfo): number => dpu(s.workerType, s.numberOfWorkers) * RATE
export function money(n: number): string {
  if (n === 0) return '$0'
  return n < 1 ? `$${n.toFixed(2)}` : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`
}
/** What the session has cost so far. `dpuSeconds` is what Glue actually bills. */
export function spent(s: SessionInfo): number { return ((s.dpuSeconds ?? 0) / 3600) * RATE }

/** Session age in ms, or null when Glue has not told us when it started. */
export function ageMs(s: SessionInfo, now = Date.now()): number | null {
  const t = Date.parse(s.createdOn ?? '')
  return Number.isFinite(t) ? Math.max(0, now - t) : null
}

/**
 * Minutes until the idle timeout stops it, measured from the last statement that finished — or
 * from creation if it has never run one. Null when there is nothing to measure from, or when the
 * session is not live; never guess a countdown we cannot stand behind.
 */
export function idleLeftMin(s: SessionInfo, statements: StatementResult[], now = Date.now()): number | null {
  if (!isLive(s.status) || !s.idleTimeout) return null
  const last = statements.reduce<number>((acc, st) => {
    const t = Date.parse(String(st.completedOn ?? st.startedOn ?? ''))
    return Number.isFinite(t) ? Math.max(acc, t) : acc
  }, 0)
  const from = last || Date.parse(s.createdOn ?? '')
  if (!Number.isFinite(from) || !from) return null
  return Math.max(0, Math.round(s.idleTimeout - (now - from) / 60_000))
}

/** `keel-8f3a-41207` and `glue-studio-datapreview-16c0627a-…` are both unreadable in a 240px list. */
export function shortName(s: SessionInfo): string {
  if (s.id.startsWith('glue-studio-datapreview-')) return 'Glue Studio data preview'
  const m = /^keel-[0-9a-f]+-(\d+)$/.exec(s.id)
  if (m) return `Keel session ${m[1]}`
  return s.id
}

/** Ours, the console's, or someone else's — it changes what you may assume about it. */
export function origin(s: SessionInfo): 'keel' | 'studio' | 'other' {
  if (s.id.startsWith('keel-')) return 'keel'
  if (s.id.startsWith('glue-studio-')) return 'studio'
  return 'other'
}

import { create } from 'zustand'
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useToast } from './Toast'
import type { Fault } from '@/api/client'

export type Op = { id: string; title: string; started: number; detail?: string; stop?: () => void }
type Store = {
  ops: Op[]
  start: (title: string, stop?: () => void) => string
  detail: (id: string, detail: string) => void
  finish: (id: string) => void
}

/**
 * Long work is visible while it runs. A deploy takes ~110 s and a preview can take ten minutes
 * behind an image pull; before this the app showed nothing and then claimed a timeout.
 */
export const useOps = create<Store>((set, get) => ({
  ops: [],
  start: (title, stop) => {
    const id = Math.random().toString(36).slice(2)
    set({ ops: [...get().ops, { id, title, started: Date.now(), stop }] })
    return id
  },
  detail: (id, detail) => set({ ops: get().ops.map((o) => (o.id === id ? { ...o, detail } : o)) }),
  finish: (id) => set({ ops: get().ops.filter((o) => o.id !== id) }),
}))

/** `await track('Deploying orders-etl', api.post(..., 240_000))` — tray while it runs, toast when it lands. */
export async function track<T>(
  title: string,
  p: Promise<{ ok: true; value: T } | { ok: false; fault: Fault }>,
  opts?: { stop?: () => void; okMessage?: string; okDetail?: (v: T) => string | undefined },
): Promise<T | null> {
  const id = useOps.getState().start(title, opts?.stop)
  try {
    const r = await p
    if (!r.ok) { useToast.getState().fail(title.toLowerCase(), r.fault); return null }
    if (opts?.okMessage) useToast.getState().push({ kind: 'ok', title: opts.okMessage, detail: opts.okDetail?.(r.value) })
    return r.value
  } finally { useOps.getState().finish(id) }
}

export function OpsTray() {
  const ops = useOps((s) => s.ops)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!ops.length) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [ops.length])
  if (!ops.length) return null
  return (
    <div className="ops-tray" role="status" aria-live="polite">
      {ops.map((o) => (
        <div key={o.id} className="ops-row">
          <Icon name="spinner" size={13} className="spin" />
          <div className="fill">
            <div className="t">{o.title}</div>
            {o.detail && <div className="d">{o.detail}</div>}
          </div>
          <span className="fig faint small">{Math.round((Date.now() - o.started) / 1000)}s</span>
          {o.stop && <button className="quiet" aria-label={`Stop ${o.title}`} title="Stop" onClick={o.stop}><Icon name="stop" size={12} /></button>}
        </div>))}
    </div>
  )
}

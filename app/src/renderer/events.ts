import { subscribe, type Sse } from '@/api/sse'
import { useApp } from '@/stores/app'
import type { EventFrame } from '@/wire/types'

/**
 * The one door. One subscription to /api/events per window; every store that cares registers a
 * route here. `connected` re-reads everything, because whatever happened in the gap is gone.
 */
type Route = (kind: string, data: unknown) => void
const routes = new Set<Route>()
export function onEvent(r: Route): () => void { routes.add(r); return () => routes.delete(r) }

let current: Sse | null = null
let backoff = 500

export function connectEvents(): void {
  current?.close()
  current = null
  if (!useApp.getState().port) return
  current = subscribe('/api/events', {
    on: (name, data) => {
      if (name === 'connected') {
        backoff = 500
        useApp.getState().setConnection('connected')
        void useApp.getState().refreshState()
        routes.forEach((r) => r('connected', null))
        return
      }
      let frame: EventFrame
      try { frame = JSON.parse(data) } catch { return }
      routes.forEach((r) => r(frame.kind, frame.data))
    },
    end: () => {
      if (!useApp.getState().port) return
      useApp.getState().setConnection('reconnecting')
      setTimeout(connectEvents, backoff)
      backoff = Math.min(backoff * 2, 10_000)
    },
  }, { silenceMs: 45_000 })
}

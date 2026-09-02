import { create } from 'zustand'
import { api } from '@/api/client'
import { onEvent } from '@/events'
import { useOps } from '@/shell/Ops'

export type EngineStatus = { up: boolean; starting?: string | null; container?: string | null; port: number; idleSeconds: number; idleStopSeconds: number }

type Store = {
  status: EngineStatus | null
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
}

/**
 * The warm local engine: a Spark session held open in the Glue image so a preview is a query,
 * not a wait. It costs a container, so its state and its Stop button are always in reach.
 */
export const useEngine = create<Store>((set) => ({
  status: null,
  refresh: async () => { const r = await api.get<EngineStatus>('/api/engine', 'the local engine'); if (r.ok) set({ status: r.value }) },
  start: async () => {
    const op = useOps.getState().start('Starting the local engine')
    const r = await api.post<EngineStatus>('/api/engine/start', {}, 'the local engine', 20 * 60_000).finally(() => useOps.getState().finish(op))
    if (r.ok) set({ status: r.value })
    else { const { useToast } = await import('@/shell/Toast'); useToast.getState().fail('start the local engine', r.fault) }
  },
  stop: async () => { const r = await api.post<EngineStatus>('/api/engine/stop', {}, 'stopping the local engine'); if (r.ok) set({ status: r.value }) },
}))

onEvent((kind) => { if (kind === 'engine' || kind === 'connected') void useEngine.getState().refresh() })

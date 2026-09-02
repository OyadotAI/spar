import { create } from 'zustand'
import { api, setBase } from '@/api/client'
import type { Fault } from '@/api/client'
import type { StateReply } from '@/wire/types'

export type Connection = 'starting' | 'connected' | 'reconnecting' | 'dead'

type AppStore = {
  port: number; project: string; connection: Connection; deathReason?: string
  state?: StateReply; stateFault?: Fault
  showTerminal: boolean; showSettings: boolean; showPalette: boolean
  setPort: (port: number, project?: string) => void
  setConnection: (c: Connection) => void
  daemonDied: (reason: string) => void
  refreshState: () => Promise<void>
  toggle: (k: 'showTerminal' | 'showSettings' | 'showPalette', v?: boolean) => void
}

export const useApp = create<AppStore>((set, get) => ({
  port: 0, project: '', connection: 'starting',
  showTerminal: false, showSettings: false, showPalette: false,
  setPort: (port, project) => { setBase(port); set({ port, project: project ?? get().project, deathReason: undefined }) },
  setConnection: (connection) => set({ connection }),
  daemonDied: (reason) => { setBase(0); set({ port: 0, connection: 'dead', deathReason: reason }) },
  refreshState: async () => {
    const r = await api.get<StateReply>('/api/state', 'the daemon state')
    if (r.ok) set({ state: r.value, stateFault: undefined, project: r.value.project ?? '' })
    else set({ stateFault: r.fault })
  },
  toggle: (k, v) => set({ [k]: v ?? !get()[k] } as Partial<AppStore>),
}))

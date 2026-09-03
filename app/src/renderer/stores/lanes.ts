import { create } from 'zustand'
import { useToast } from '@/shell/Toast'
import { api } from '@/api/client'

export type Tab = 'console' | 'authoring' | 'script' | 'details' | 'schedules' | 'upgrade' | 'changes'
export type Lane = { id: string; title: string; tab: Tab; worktree?: string }

type Lanes = {
  open: Lane[]; active: string
  openJob: (name: string) => void
  close: (id: string) => void
  select: (id: string) => void
  setTab: (id: string, tab: Tab) => void
  setWorktree: (id: string, wt: string) => void
  /** Tabs are remembered per project: switching projects swaps the set. */
  loadFor: (project: string) => void
}

let projectKey = ''
function load(key: string): { open: Lane[]; active: string } {
  try {
    const v = localStorage.getItem('lanes:' + key)
    // 'dq' was the Data quality tab; a lane saved on it would land on a section that no longer exists
    if (v) { const p = JSON.parse(v) as { open: Lane[]; active: string }; p.open = p.open.map((l) => (l.tab as string) === 'dq' ? { ...l, tab: 'console' as Tab } : l); return p }
  } catch { /* fresh */ }
  return { open: [], active: 'home' }
}

export const useLanes = create<Lanes>((set, get) => ({
  open: [], active: 'home',
  loadFor: (project) => { if (project === projectKey) return; projectKey = project; set(load(project)) },
  openJob: (name) => {
    const open = get().open
    if (!open.some((l) => l.id === name)) {
      set({ open: [...open, { id: name, title: name, tab: 'console' }] })
      // a local folder + its own branch, made once; the daemon is idempotent about both
      void (async () => {
        // a job that already has a local folder needs no AWS round trip; only a new tab for a
        // remote job does, and even then a failure is not fatal — the lane is what matters
        const local = await api.get<{ name: string }[]>('/api/jobs', 'the local jobs')
        const known = local.ok && local.value.some((l) => l.name === name)
        if (!known) await api.post(`/api/jobs/${encodeURIComponent(name)}/import`, {}, `importing ${name}`)
        const r = await api.post<{ path: string; branch: string }>(`/api/jobs/${encodeURIComponent(name)}/lane`, {}, `the lane for ${name}`)
        if (r.ok) get().setWorktree(name, r.value.path)
        else useToast.getState().fail(`open ${name}`, r.fault)
      })()
    }
    set({ active: name })
  },
  close: (id) => {
    const open = get().open.filter((l) => l.id !== id)
    set({ open, active: get().active === id ? (open[open.length - 1]?.id ?? 'home') : get().active })
  },
  select: (active) => set({ active }),
  setTab: (id, tab) => set({ open: get().open.map((l) => (l.id === id ? { ...l, tab } : l)) }),
  setWorktree: (id, worktree) => set({ open: get().open.map((l) => (l.id === id ? { ...l, worktree } : l)) }),
}))

useLanes.subscribe((s) => { if (!projectKey) return; try { localStorage.setItem('lanes:' + projectKey, JSON.stringify({ open: s.open, active: s.active })) } catch { /* ignore */ } })
export const activeLane = (s: Lanes): Lane | undefined => s.open.find((l) => l.id === s.active)

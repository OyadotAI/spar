import { create } from 'zustand'
import { api } from '@/api/client'

export type Finding = { node: string | null; level: 'warn' | 'info'; rule: string; message: string; fix: string }

/** One stable empty array: a selector that builds a new one on every call re-renders forever. */
export const NO_FINDINGS: Finding[] = []

type Store = {
  byJob: Record<string, { rev: number; findings: Finding[] }>
  check: (job: string, rev: number) => Promise<void>
}

/**
 * The static check, refreshed whenever the DAG changes. It costs no AWS call and no Spark, so it
 * can run on every save and put the silent traps on the canvas while they are still being drawn.
 */
export const useLint = create<Store>((set, get) => ({
  byJob: {},
  check: async (job, rev) => {
    if (get().byJob[job]?.rev === rev) return
    const r = await api.get<{ rev: number; findings: Finding[] }>(`/api/jobs/${encodeURIComponent(job)}/lint`, 'the checks')
    if (r.ok) set({ byJob: { ...get().byJob, [job]: { rev: r.value.rev, findings: r.value.findings } } })
  },
}))

export function findingsFor(job: string, node?: string): Finding[] {
  const all = useLint.getState().byJob[job]?.findings ?? []
  return node ? all.filter((f) => f.node === node) : all
}

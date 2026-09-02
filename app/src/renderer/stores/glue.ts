import { create } from 'zustand'
import { api, type Fault } from '@/api/client'
import { onEvent } from '@/events'
import type { GlueJob, GlueRun } from '@/wire/types'

export type Auth = { kind: 'ok' } | { kind: 'noProfile' } | { kind: 'expired'; fix: string } | { kind: 'missingCli' }

export type LocalJob = { name: string; imported: boolean; hasDag: boolean; hasScript: boolean; hasTests: boolean; lane: { exists: boolean; branch?: string; dirty?: number } }
type GlueStore = {
  jobs: GlueJob[]; local: LocalJob[]; loaded: boolean; failure?: Fault; auth: Auth; query: string; refreshedAt?: string
  refreshLocal: () => Promise<void>
  createLocal: (name: string) => Promise<Fault | null>
  refresh: () => Promise<void>
  setQuery: (q: string) => void
  patchRun: (job: string, run: GlueRun | null) => void
  markRemote: (job: string) => void
}

export const useGlue = create<GlueStore>((set, get) => ({
  jobs: [], local: [], loaded: false, auth: { kind: 'noProfile' }, query: '',
  refreshLocal: async () => { const r = await api.get<LocalJob[]>('/api/jobs', 'the local jobs'); if (r.ok) set({ local: r.value }) },
  createLocal: async (name) => {
    const r = await api.post(`/api/jobs/${encodeURIComponent(name)}/lane`, {}, `creating ${name}`)
    if (!r.ok) return r.fault
    const d = await api.put(`/api/jobs/${encodeURIComponent(name)}/dag`, { dag: {}, layout: {} }, 'the empty DAG')
    if (!d.ok) return d.fault
    await get().refreshLocal()
    return null
  },
  refresh: async () => {
    const r = await api.get<{ refreshedAt?: string; jobs: GlueJob[] }>('/api/glue/jobs', 'the Glue job list')
    if (r.ok) set({ jobs: r.value.jobs, refreshedAt: r.value.refreshedAt, loaded: true, failure: undefined, auth: { kind: 'ok' } })
    else if (r.fault.status === 400) set({ loaded: true, auth: { kind: 'noProfile' }, failure: undefined })
    else if (r.fault.status === 401) set({ loaded: true, auth: { kind: 'expired', fix: r.fault.fix ?? 'aws sso login' }, failure: undefined })
    else set({ loaded: true, failure: r.fault })
  },
  setQuery: (query) => set({ query }),
  patchRun: (job, run) => set({ jobs: get().jobs.map((j) => (j.name === job ? { ...j, latestRun: run } : j)) }),
  markRemote: (job) => set({ jobs: get().jobs.map((j) => (j.name === job && j.local?.imported ? { ...j, local: { ...j.local, remoteChanged: true } } : j)) }),
}))

onEvent((kind, data) => {
  const s = useGlue.getState()
  if (kind === 'connected' || kind === 'jobs.changed' || kind === 'state.changed') { void s.refresh(); void s.refreshLocal() }
  else if (kind === 'git.changed') void s.refreshLocal()
  else if (kind === 'run.changed') { const d = data as { job: string; run: GlueRun | Record<string, never> }; s.patchRun(d.job, d.run && 'id' in d.run ? (d.run as GlueRun) : null) }
  else if (kind === 'job.changed') { const d = data as { name: string; remote?: unknown }; if (d.remote) s.markRemote(d.name) }
  else if (kind === 'aws.auth') { const d = data as { fix: string }; useGlue.setState({ auth: { kind: 'expired', fix: d.fix } }) }
})

export function filteredJobs(jobs: GlueJob[], query: string): GlueJob[] {
  const q = query.trim().toLowerCase()
  if (!q) return jobs
  return jobs.filter((j) => j.name.toLowerCase().includes(q) || (j.latestRun?.state ?? '').toLowerCase().includes(q))
}

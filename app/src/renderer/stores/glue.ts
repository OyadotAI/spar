import { create } from 'zustand'
import { api, type Fault } from '@/api/client'
import { onEvent } from '@/events'
import type { GlueJob, GlueRun } from '@/wire/types'

export type Auth = { kind: 'ok' } | { kind: 'noProfile' } | { kind: 'expired'; fix: string } | { kind: 'missingCli' }

export type LocalJob = { name: string; imported: boolean; hasDag: boolean; hasScript: boolean; hasTests: boolean; lane: { exists: boolean; branch?: string; dirty?: number } }
type GlueStore = {
  jobs: GlueJob[]; local: LocalJob[]; loaded: boolean; failure?: Fault; auth: Auth; query: string; refreshedAt?: string; stale?: boolean; offline?: string | null
  /** the `profile@region` this listing belongs to; null until the first state arrives */
  account: string | null
  refreshLocal: () => Promise<void>
  createLocal: (name: string) => Promise<Fault | null>
  refresh: () => Promise<void>
  setQuery: (q: string) => void
  patchRun: (job: string, run: GlueRun | null) => void
  markRemote: (job: string) => void
  /** The daemon says the profile or region changed; drop anything that belonged to the old one. */
  accountChanged: (profile?: string | null, region?: string | null) => void
}

/** `profile@region`. Everything in this store is scoped to one of these. */
export const accountKey = (profile?: string | null, region?: string | null): string => `${profile ?? ''}@${region ?? ''}`

/**
 * The account a screen's data belongs to. Put it in the dependencies of any effect that reads from
 * AWS — connections, sessions, schedules, run history — and switching profile or region re-reads it
 * instead of leaving the previous account's answer on screen.
 */
export const useAccount = (): string | null => useGlue((s) => s.account)

export const useGlue = create<GlueStore>((set, get) => ({
  jobs: [], local: [], loaded: false, auth: { kind: 'noProfile' }, query: '', account: null,
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
    const r = await api.get<{ refreshedAt?: string; jobs: GlueJob[]; stale?: boolean; offline?: string | null }>('/api/glue/jobs', 'the Glue job list')
    if (r.ok) set({ jobs: r.value.jobs, refreshedAt: r.value.refreshedAt, stale: r.value.stale, offline: r.value.offline ?? null, loaded: true, failure: undefined, auth: { kind: 'ok' } })
    else if (r.fault.status === 400) set({ loaded: true, auth: { kind: 'noProfile' }, failure: undefined })
    else if (r.fault.status === 401) set({ loaded: true, auth: { kind: 'expired', fix: r.fault.fix ?? 'aws sso login' }, failure: undefined })
    else set({ loaded: true, failure: r.fault })
  },
  setQuery: (query) => set({ query }),
  patchRun: (job, run) => set({ jobs: get().jobs.map((j) => (j.name === job ? { ...j, latestRun: run } : j)) }),
  markRemote: (job) => set({ jobs: get().jobs.map((j) => (j.name === job && j.local?.imported ? { ...j, local: { ...j.local, remoteChanged: true } } : j)) }),
  accountChanged: (profile, region) => {
    const key = accountKey(profile, region)
    const was = get().account
    // the first sighting is not a change; a real one means these jobs are from somewhere else
    if (was === null || was === key) { set({ account: key }); return }
    set({ account: key, jobs: [], loaded: false, failure: undefined, refreshedAt: undefined, stale: false, offline: null })
  },
}))

onEvent((kind, data) => {
  const s = useGlue.getState()
  if (kind === 'state.changed') {
    // switching region used to leave the previous region's jobs on screen: the daemon only
    // announced a change when job *names* differed, so moving to an empty region announced nothing
    const d = data as { profile?: string; region?: string }
    s.accountChanged(d.profile, d.region)
  }
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

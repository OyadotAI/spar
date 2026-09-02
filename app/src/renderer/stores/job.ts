import { create } from 'zustand'
import { useToast } from '@/shell/Toast'
import { api, type Fault } from '@/api/client'
import { subscribe, type Sse } from '@/api/sse'
import { onEvent } from '@/events'
import { useLanes } from '@/stores/lanes'
import type { GlueRun, LogLine } from '@/wire/types'
import { isRunning } from '@/shell/format'

export type LogState = { kind: 'idle' } | { kind: 'streaming' } | { kind: 'stalled'; reason: string } | { kind: 'ended'; reason: string }
export type JobState = {
  runs: GlueRun[]; next?: string | null; runsFault?: Fault; loaded: boolean
  selectedRun?: string; lines: LogLine[]; group: 'all' | 'error' | 'output'; follow: boolean; search: string
  logState: LogState; busy?: string; streams: { group: string; stream: string }[]
}
const LINE_CAP = 5000
const empty = (): JobState => ({ runs: [], loaded: false, lines: [], group: 'all', follow: true, search: '', logState: { kind: 'idle' }, streams: [] })

type Store = {
  jobs: Record<string, JobState>
  get: (name: string) => JobState
  refreshRuns: (name: string) => Promise<void>
  select: (name: string, runId?: string) => void
  setGroup: (name: string, group: JobState['group']) => void
  setFollow: (name: string, follow: boolean) => void
  setSearch: (name: string, search: string) => void
  clearLines: (name: string) => void
  start: (name: string, args?: Record<string, string>, retryOf?: string) => Promise<Fault | null>
  stop: (name: string, runId: string) => Promise<Fault | null>
  patchRun: (name: string, run: GlueRun) => void
  reconnectLogs: (name: string) => void
}

const streams = new Map<string, Sse>()

function patch(set: (fn: (s: Store) => Partial<Store>) => void, name: string, p: Partial<JobState> | ((j: JobState) => Partial<JobState>)) {
  set((s) => { const j = s.jobs[name] ?? empty(); return { jobs: { ...s.jobs, [name]: { ...j, ...(typeof p === 'function' ? p(j) : p) } } } })
}

export const useJob = create<Store>((set, get) => ({
  jobs: {},
  get: (name) => get().jobs[name] ?? empty(),
  refreshRuns: async (name) => {
    const r = await api.get<{ runs: GlueRun[]; next?: string | null }>(`/api/glue/jobs/${encodeURIComponent(name)}/runs?max=50`, `the runs of ${name}`)
    if (r.ok) {
      patch(set, name, (j) => ({ runs: r.value.runs, next: r.value.next, loaded: true, runsFault: undefined,
        selectedRun: j.selectedRun && r.value.runs.some((x) => x.id === j.selectedRun) ? j.selectedRun : r.value.runs[0]?.id }))
      const j = get().get(name)
      if (j.selectedRun && !streams.has(name)) openLogs(name, j.selectedRun)
    } else patch(set, name, { runsFault: r.fault, loaded: true })
  },
  select: (name, runId) => {
    const cur = get().get(name)
    if (cur.selectedRun === runId && streams.has(name)) return
    patch(set, name, { selectedRun: runId, lines: [], streams: [] })
    if (runId) openLogs(name, runId); else closeLogs(name)
  },
  setGroup: (name, group) => { patch(set, name, { group, lines: [] }); const id = get().get(name).selectedRun; if (id) openLogs(name, id) },
  setFollow: (name, follow) => patch(set, name, { follow }),
  setSearch: (name, search) => patch(set, name, { search }),
  clearLines: (name) => patch(set, name, { lines: [] }),
  start: async (name, args, retryOf) => {
    patch(set, name, { busy: 'starting' })
    const r = await api.post<{ runId: string }>(`/api/glue/jobs/${encodeURIComponent(name)}/runs`, { arguments: args, retryOf }, `starting ${name}`)
    patch(set, name, { busy: undefined })
    if (!r.ok) { useToast.getState().fail(`start ${name}`, r.fault); return r.fault }
    await get().refreshRuns(name)
    get().select(name, r.value.runId)
    useToast.getState().done(`${name} started`, r.value.runId.slice(3, 19) + '…')
    return null
  },
  stop: async (name, runId) => {
    patch(set, name, { busy: 'stopping' })
    const r = await api.post<{ ok: boolean; errors: string[] }>(`/api/glue/jobs/${encodeURIComponent(name)}/runs/${runId}/stop`, {}, `stopping ${runId}`)
    patch(set, name, { busy: undefined })
    if (!r.ok) { useToast.getState().fail(`stop ${name}`, r.fault); return r.fault }
    if (!r.value.ok) { const f = { what: `stopping ${runId}`, why: r.value.errors.join('; ') }; useToast.getState().fail(`stop ${name}`, f); return f }
    useToast.getState().done(`Stopping ${name}`)
    return null
  },
  patchRun: (name, run) => patch(set, name, (j) => {
    const i = j.runs.findIndex((r) => r.id === run.id)
    if (i >= 0) { const runs = j.runs.slice(); runs[i] = { ...runs[i], ...run }; return { runs } }
    return { runs: [run, ...j.runs] }
  }),
  reconnectLogs: (name) => { const id = get().get(name).selectedRun; if (id) openLogs(name, id) },
}))

function openLogs(name: string, runId: string): void {
  closeLogs(name)
  const group = useJob.getState().get(name).group
  const set = useJob.setState
  patch(set, name, { logState: { kind: 'streaming' }, lines: [] })
  const s = subscribe(`/api/glue/jobs/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}/logs?group=${group}`, {
    on: (ev, data) => {
      if (ev === 'line') {
        const line = JSON.parse(data) as LogLine
        patch(set, name, (j) => { const lines = j.lines.length >= LINE_CAP ? j.lines.slice(500) : j.lines; return { lines: [...lines, line] } })
      } else if (ev === 'streams') patch(set, name, (j) => ({ streams: JSON.parse(data), logState: j.logState.kind === 'stalled' ? { kind: 'streaming' } : j.logState }))
      else if (ev === 'end') { patch(set, name, { logState: { kind: 'ended', reason: (JSON.parse(data) as { reason: string }).reason } }); streams.delete(name) }
    },
    end: (reason) => {
      if (streams.get(name) !== s) return
      streams.delete(name)
      patch(set, name, (j) => ({ logState: j.logState.kind === 'ended' ? j.logState : { kind: 'stalled', reason } }))
    },
  }, { silenceMs: 60_000 })
  streams.set(name, s)
}
function closeLogs(name: string): void { streams.get(name)?.close(); streams.delete(name) }

onEvent((kind, data) => {
  const st = useJob.getState()
  if (kind === 'run.changed') {
    const d = data as { job: string; run: GlueRun | Record<string, never> }
    if (d.run && 'id' in d.run) {
      const before = st.jobs[d.job]?.runs.find((r) => r.id === (d.run as GlueRun).id)
      st.patchRun(d.job, d.run as GlueRun)
      if (before && isRunning(before.state) && !isRunning((d.run as GlueRun).state)) notify(d.job, d.run as GlueRun)
    }
  } else if (kind === 'connected') {
    for (const l of useLanes.getState().open) void st.refreshRuns(l.id)
  }
})

function notify(job: string, run: GlueRun): void {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') void Notification.requestPermission()
    if (Notification.permission !== 'granted') return
    new Notification(`${job}: ${run.state}`, { body: run.errorMessage ? run.errorMessage.slice(0, 160) : `run ${run.id.slice(0, 12)}… ${run.state.toLowerCase()}` })
  } catch { /* notifications are a nicety */ }
}

import { create } from 'zustand'
import { api, type Fault } from '@/api/client'
import { subscribe, type Sse } from '@/api/sse'
import { onEvent } from '@/events'
import type { TestResult } from '@/wire/types'

export type AuthoringState = {
  script?: string | null; ranges: Record<string, [number, number]>; tests: { path: string; content: string }[]
  loaded: boolean; failure?: Fault; running: boolean; output: string[]; result?: TestResult; busy?: string; message?: string
}
const empty = (): AuthoringState => ({ ranges: {}, tests: [], loaded: false, running: false, output: [] })

type Store = {
  jobs: Record<string, AuthoringState>
  get: (job: string) => AuthoringState
  refresh: (job: string) => Promise<void>
  generate: (job: string) => Promise<void>
  runTests: (job: string) => void
  stopTests: (job: string) => Promise<void>
  deploy: (job: string, create?: boolean) => Promise<string>
}
const runs = new Map<string, Sse>()
function patch(set: (fn: (s: Store) => Partial<Store>) => void, job: string, p: Partial<AuthoringState> | ((a: AuthoringState) => Partial<AuthoringState>)) {
  set((s) => { const a = s.jobs[job] ?? empty(); return { jobs: { ...s.jobs, [job]: { ...a, ...(typeof p === 'function' ? p(a) : p) } } } })
}

export const useAuthoring = create<Store>((set, get) => ({
  jobs: {},
  get: (job) => get().jobs[job] ?? empty(),
  refresh: async (job) => {
    const r = await api.get<{ script?: string | null; ranges?: Record<string, [number, number]> | null; tests: { path: string; content: string }[] }>(`/api/jobs/${encodeURIComponent(job)}`, `the files of ${job}`)
    if (r.ok) patch(set, job, { script: r.value.script, ranges: r.value.ranges ?? {}, tests: r.value.tests ?? [], loaded: true, failure: undefined })
    else patch(set, job, { loaded: true, failure: r.fault })
  },
  generate: async (job) => {
    patch(set, job, { busy: 'generating', message: undefined })
    const r = await api.post<{ written: string[] }>(`/api/jobs/${encodeURIComponent(job)}/generate`, { tests: true }, 'code generation')
    patch(set, job, { busy: undefined, message: r.ok ? `generated ${r.value.written.join(', ')}` : `${r.fault.why}` })
    await get().refresh(job)
  },
  runTests: (job) => {
    if (runs.has(job)) return
    patch(set, job, { running: true, output: [], result: undefined })
    const s = subscribe(`/api/jobs/${encodeURIComponent(job)}/test`, {
      on: (ev, data) => {
        if (ev === 'line') patch(set, job, (a) => ({ output: [...a.output.slice(-1999), (JSON.parse(data) as { text: string }).text] }))
        else if (ev === 'result') patch(set, job, { result: JSON.parse(data) as TestResult })
        else if (ev === 'done') { patch(set, job, { running: false }); runs.delete(job) }
      },
      end: (reason) => { if (runs.get(job) === s) { runs.delete(job); patch(set, job, (a) => ({ running: false, output: a.result ? a.output : [...a.output, `[${reason}]`] })) } },
    }, { silenceMs: 25 * 60_000 })
    runs.set(job, s)
  },
  stopTests: async (job) => { await api.post(`/api/jobs/${encodeURIComponent(job)}/test/stop`, {}, 'stopping tests'); runs.get(job)?.close(); runs.delete(job); patch(set, job, { running: false }) },
  deploy: async (job, create = false) => {
    patch(set, job, { busy: 'deploying', message: undefined })
    const r = await api.post<{ note: string; scriptLocation: string }>(`/api/jobs/${encodeURIComponent(job)}/deploy`, { create }, 'the deploy')
    const msg = r.ok ? r.value.note : `${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}`
    patch(set, job, { busy: undefined, message: msg })
    return msg
  },
}))

onEvent((kind, data) => {
  if (kind === 'job.changed') { const d = data as { name: string }; if (useAuthoring.getState().jobs[d.name]) void useAuthoring.getState().refresh(d.name) }
  else if (kind === 'connected') for (const job of Object.keys(useAuthoring.getState().jobs)) void useAuthoring.getState().refresh(job)
})

import { create } from 'zustand'
import { useToast } from '@/shell/Toast'
import { confirm } from '@/shell/Confirm'
import { useApp } from '@/stores/app'
import { useOps } from '@/shell/Ops'
import { api, type Fault } from '@/api/client'
import { subscribe, type Sse } from '@/api/sse'
import { onEvent } from '@/events'
import type { TestResult } from '@/wire/types'

export type LocalResult = {
  status: 'passed' | 'failed' | 'error'
  nodes?: { node: string; rows: number; columns: number }[]
  written?: { node: string; path: string; rows: number; format: string }[]
  notCovered?: string[]
  bookmark?: { simulated: boolean; state: Record<string, string[] | string> }
  bookmarksSimulated?: boolean
  message?: string
  elapsed?: number
  ms?: number
  out?: string
}

export type AuthoringState = {
  script?: string | null; ranges: Record<string, [number, number]>; tests: { path: string; content: string }[]
  loaded: boolean; failure?: Fault; running: boolean; output: string[]; result?: TestResult; busy?: string; message?: string
  localRunning: boolean; localOutput: string[]; localResult?: LocalResult
}
const empty = (): AuthoringState => ({ ranges: {}, tests: [], loaded: false, running: false, output: [], localRunning: false, localOutput: [] })

type Store = {
  jobs: Record<string, AuthoringState>
  get: (job: string) => AuthoringState
  refresh: (job: string) => Promise<void>
  generate: (job: string) => Promise<void>
  runTests: (job: string) => void
  runLocal: (job: string, bookmarks: boolean) => void
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
    patch(set, job, { busy: undefined, message: r.ok ? `generated ${r.value.written.join(', ')}` : undefined })
    if (!r.ok) useToast.getState().fail('generate the code', r.fault)
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
  /**
   * The whole pipeline on this machine, against samples/. Same event shape as the test run, so the
   * pane is the same shape too — lines arrive in one burst because the engine answers when it is done.
   */
  runLocal: (job, bookmarks) => {
    const key = 'local:' + job
    if (runs.has(key)) return
    patch(set, job, { localRunning: true, localOutput: [], localResult: undefined })
    const op = useOps.getState().start(`Running ${job} locally`)
    const s2 = subscribe(`/api/jobs/${encodeURIComponent(job)}/run/local?bookmarks=${bookmarks}`, {
      on: (ev, data) => {
        if (ev === 'line') patch(set, job, (a) => ({ localOutput: [...a.localOutput.slice(-1999), (JSON.parse(data) as { text: string }).text] }))
        else if (ev === 'result') {
          const r = JSON.parse(data) as LocalResult
          patch(set, job, { localResult: r })
          if (r.status === 'passed') useToast.getState().done(`${job} ran locally`, `${r.nodes?.length ?? 0} nodes, ${(r.ms ?? 0) / 1000}s, no AWS`)
          else useToast.getState().push({ kind: 'bad', title: `${job} failed locally`, detail: (r.message ?? '').split('\n').slice(-2).join(' ') })
        } else if (ev === 'done') { patch(set, job, { localRunning: false }); runs.delete(key); useOps.getState().finish(op) }
      },
      end: (reason) => {
        if (runs.get(key) === s2) {
          runs.delete(key); useOps.getState().finish(op)
          patch(set, job, (a) => ({ localRunning: false, localOutput: a.localResult ? a.localOutput : [...a.localOutput, `[${reason}]`] }))
        }
      },
    }, { silenceMs: 25 * 60_000 })
    runs.set(key, s2)
  },
  stopTests: async (job) => { await api.post(`/api/jobs/${encodeURIComponent(job)}/test/stop`, {}, 'stopping tests'); runs.get(job)?.close(); runs.delete(job); patch(set, job, { running: false }) },
  /**
   * The only write this app makes to a live Glue job, and it was the only one with no confirmation
   * while every delete had two. Confirming here rather than at the button covers all three entry
   * points — the toolbar, ⇧⌘D and the command palette — because they all land on this function.
   */
  deploy: async (job, create = false) => {
    const st = useApp.getState().state
    const where = `${st?.profile ?? 'the current profile'}${st?.region ? ` · ${st.region}` : ''}`
    const ok = await confirm({
      title: create ? `Create ${job} in AWS?` : `Deploy ${job} to AWS?`,
      confirmLabel: create ? 'Create the job' : 'Deploy',
      body: create
        ? `This creates a new Glue job named "${job}" in ${where}, and uploads its script to S3. Nothing in AWS is overwritten.`
        : `This overwrites the job definition of "${job}" in ${where} — its DAG, its settings and the script at its ScriptLocation. The run history is untouched, and the previous definition is not kept by Glue.`,
    })
    if (!ok) return ''
    patch(set, job, { busy: 'deploying', message: undefined })
    // Deploy settles + verifies the script against Glue's own regeneration: ~110 s, well past the default ceiling.
    const id = useOps.getState().start(`Deploying ${job}`)
    const r = await api.post<{ note: string; scriptLocation: string; scriptIsOurs?: boolean; jobMode?: string }>(`/api/jobs/${encodeURIComponent(job)}/deploy`, { create }, 'the deploy', 4 * 60_000)
      .finally(() => useOps.getState().finish(id))
    const msg = r.ok ? r.value.note : `${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}`
    patch(set, job, { busy: undefined, message: r.ok ? msg : undefined })
    if (!r.ok) useToast.getState().fail('deploy', r.fault)
    else useToast.getState().push({ kind: r.value.scriptIsOurs === false ? 'info' : 'ok', title: `${job} deployed`, detail: r.value.note })
    return msg
  },
}))

onEvent((kind, data) => {
  if (kind === 'job.changed') { const d = data as { name: string }; if (useAuthoring.getState().jobs[d.name]) void useAuthoring.getState().refresh(d.name) }
  else if (kind === 'connected') for (const job of Object.keys(useAuthoring.getState().jobs)) void useAuthoring.getState().refresh(job)
})

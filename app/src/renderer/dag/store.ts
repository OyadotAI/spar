import { create } from 'zustand'
import { api, type Fault } from '@/api/client'
import { onEvent } from '@/events'
import { category, maxInputs, template } from './schema'
import { autoLayout } from './layout'

export type DagNode = { id: string; type: string; name: string; inputs: string[]; category: 'source' | 'transform' | 'target' }
export type DagEdge = { from: string; to: string }

/** A selector must return the same reference when nothing changed, or React re-renders forever. */
export const NO_NODES: DagNode[] = []
export type Raw = Record<string, Record<string, Record<string, unknown>>>
export type Pos = { x: number; y: number }

export type DagState = {
  raw: Raw; nodes: DagNode[]; edges: DagEdge[]; layout: Record<string, Pos>; rev: number
  loaded: boolean; failure?: Fault; imported: boolean
  selection: string[]; undo: string[]; redo: string[]; conflict?: string; dirtyLayout: boolean
  jobDef?: Record<string, unknown>
}
const empty = (): DagState => ({ raw: {}, nodes: [], edges: [], layout: {}, rev: 0, loaded: false, imported: false, selection: [], undo: [], redo: [], dirtyLayout: false })

type Store = {
  jobs: Record<string, DagState>
  get: (job: string) => DagState
  load: (job: string) => Promise<void>
  remoteChanged: (job: string, rev?: number) => void
  select: (job: string, ids: string[]) => void
  add: (job: string, type: string, at: Pos) => string
  remove: (job: string, ids: string[]) => void
  connect: (job: string, from: string, to: string) => string | null
  disconnect: (job: string, from: string, to: string) => void
  setField: (job: string, id: string, key: string, value: unknown) => void
  rename: (job: string, id: string, name: string) => void
  replaceNode: (job: string, id: string, type: string, body: Record<string, unknown>) => void
  move: (job: string, positions: Record<string, Pos>) => void
  relayout: (job: string) => void
  undo: (job: string) => void
  redo: (job: string) => void
  flush: (job: string) => Promise<void>
}

function derive(raw: Raw): { nodes: DagNode[]; edges: DagEdge[] } {
  const nodes: DagNode[] = []; const edges: DagEdge[] = []
  for (const [id, node] of Object.entries(raw)) {
    const type = Object.keys(node)[0]; if (!type) continue
    const body = node[type] ?? {}
    const inputs = Array.isArray(body.Inputs) ? (body.Inputs as string[]) : []
    nodes.push({ id, type, name: String(body.Name ?? id), inputs, category: category(type) })
    for (const from of inputs) edges.push({ from, to: id })
  }
  return { nodes, edges }
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
let ownRevs = new Map<string, number>()

function patch(set: (fn: (s: Store) => Partial<Store>) => void, job: string, p: Partial<DagState> | ((d: DagState) => Partial<DagState>)) {
  set((s) => { const d = s.jobs[job] ?? empty(); return { jobs: { ...s.jobs, [job]: { ...d, ...(typeof p === 'function' ? p(d) : p) } } } })
}

/** Every mutation: snapshot for undo, apply, re-derive, schedule a save. */
function mutate(set: (fn: (s: Store) => Partial<Store>) => void, get: () => Store, job: string, fn: (raw: Raw, layout: Record<string, Pos>) => void, layoutOnly = false) {
  const d = get().get(job)
  const snap = JSON.stringify({ raw: d.raw, layout: d.layout })
  const raw = structuredClone(d.raw); const layout = { ...d.layout }
  fn(raw, layout)
  const derived = derive(raw)
  patch(set, job, { raw, layout, ...derived, undo: [...d.undo.slice(-49), snap], redo: [], dirtyLayout: d.dirtyLayout || layoutOnly })
  schedule(set, get, job, layoutOnly)
}

function schedule(set: (fn: (s: Store) => Partial<Store>) => void, get: () => Store, job: string, layoutOnly: boolean) {
  const prev = saveTimers.get(job); if (prev) clearTimeout(prev)
  saveTimers.set(job, setTimeout(() => { saveTimers.delete(job); void save(set, get, job, layoutOnly && !get().get(job).dirtyLayout) }, 300))
}

async function save(set: (fn: (s: Store) => Partial<Store>) => void, get: () => Store, job: string, layoutOnly: boolean) {
  const d = get().get(job)
  if (layoutOnly) { await api.put(`/api/jobs/${encodeURIComponent(job)}/layout`, d.layout, 'the layout'); return }
  const r = await api.put<{ rev: number }>(`/api/jobs/${encodeURIComponent(job)}/dag`, { dag: d.raw, layout: d.layout, rev: d.rev }, 'the DAG')
  if (r.ok) { ownRevs.set(job, r.value.rev); patch(set, job, { rev: r.value.rev, conflict: undefined, dirtyLayout: false }) }
  else if (r.fault.status === 409) patch(set, job, { conflict: r.fault.why })
  else patch(set, job, { conflict: `${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}` })
}

export const useDag = create<Store>((set, get) => ({
  jobs: {},
  get: (job) => get().jobs[job] ?? empty(),
  load: async (job) => {
    const r = await api.get<{ dag?: Raw | null; layout?: Record<string, Pos> | null; rev: number; job?: Record<string, unknown> }>(`/api/jobs/${encodeURIComponent(job)}`, `the DAG of ${job}`)
    if (!r.ok) { patch(set, job, { loaded: true, failure: r.fault, imported: r.fault.status !== 404 }); return }
    const raw = r.value.dag ?? {}
    const derived = derive(raw)
    let layout = r.value.layout ?? {}
    const missing = derived.nodes.some((n) => !layout[n.id])
    if (missing && derived.nodes.length) layout = { ...autoLayout(derived.nodes, derived.edges), ...layout }
    patch(set, job, (d) => ({ raw, ...derived, layout, rev: r.value.rev, loaded: true, failure: undefined, imported: true, jobDef: r.value.job ?? undefined,
      selection: d.selection.filter((id) => id in raw), conflict: undefined }))
    if (missing && derived.nodes.length) void api.put(`/api/jobs/${encodeURIComponent(job)}/layout`, layout, 'the layout')
  },
  remoteChanged: (job, rev) => {
    if (rev !== undefined && ownRevs.get(job) === rev) return
    if (!get().jobs[job]) return
    void get().load(job)
  },
  select: (job, selection) => patch(set, job, { selection }),
  add: (job, type, at) => {
    const id = 'node-' + crypto.randomUUID().slice(0, 8)
    const n = get().get(job).nodes.filter((x) => x.type === type).length
    mutate(set, get, job, (raw, layout) => { raw[id] = { [type]: template(type, `${type.replace(/(Source|Target)$/, ' $1')}${n ? ' ' + (n + 1) : ''}`.trim()) }; layout[id] = at })
    patch(set, job, { selection: [id] })
    return id
  },
  remove: (job, ids) => {
    mutate(set, get, job, (raw, layout) => {
      for (const id of ids) { delete raw[id]; delete layout[id] }
      for (const node of Object.values(raw)) for (const body of Object.values(node)) if (Array.isArray(body.Inputs)) body.Inputs = (body.Inputs as string[]).filter((i) => !ids.includes(i))
    })
    patch(set, job, (d) => ({ selection: d.selection.filter((s) => !ids.includes(s)) }))
  },
  connect: (job, from, to) => {
    const d = get().get(job)
    const target = d.nodes.find((n) => n.id === to); const source = d.nodes.find((n) => n.id === from)
    if (!target || !source) return 'no such node'
    if (from === to) return 'a node cannot feed itself'
    if (target.category === 'source') return 'a source has no inputs'
    if (source.category === 'target') return 'a target has no output'
    if (target.inputs.includes(from)) return null
    const max = maxInputs(target.type)
    mutate(set, get, job, (raw) => {
      const body = raw[to]![target.type]!
      const inputs = Array.isArray(body.Inputs) ? (body.Inputs as string[]).slice() : []
      if (inputs.length >= max) inputs.splice(0, inputs.length - max + 1) // single-input transforms replace their input
      inputs.push(from); body.Inputs = inputs
    })
    return null
  },
  disconnect: (job, from, to) => {
    const target = get().get(job).nodes.find((n) => n.id === to); if (!target) return
    mutate(set, get, job, (raw) => { const body = raw[to]![target.type]!; body.Inputs = ((body.Inputs as string[]) ?? []).filter((i) => i !== from) })
  },
  setField: (job, id, key, value) => {
    const node = get().get(job).nodes.find((n) => n.id === id); if (!node) return
    mutate(set, get, job, (raw) => { const body = raw[id]![node.type]!; if (value === undefined || value === '') delete body[key]; else body[key] = value })
  },
  rename: (job, id, name) => get().setField(job, id, 'Name', name),
  replaceNode: (job, id, type, body) => mutate(set, get, job, (raw) => { raw[id] = { [type]: body } }),
  move: (job, positions) => mutate(set, get, job, (_raw, layout) => Object.assign(layout, positions), true),
  relayout: (job) => { const d = get().get(job); mutate(set, get, job, (_raw, layout) => Object.assign(layout, autoLayout(d.nodes, d.edges)), true) },
  undo: (job) => {
    const d = get().get(job); const snap = d.undo[d.undo.length - 1]; if (!snap) return
    const { raw, layout } = JSON.parse(snap) as { raw: Raw; layout: Record<string, Pos> }
    patch(set, job, { raw, layout, ...derive(raw), undo: d.undo.slice(0, -1), redo: [...d.redo, JSON.stringify({ raw: d.raw, layout: d.layout })] })
    schedule(set, get, job, false)
  },
  redo: (job) => {
    const d = get().get(job); const snap = d.redo[d.redo.length - 1]; if (!snap) return
    const { raw, layout } = JSON.parse(snap) as { raw: Raw; layout: Record<string, Pos> }
    patch(set, job, { raw, layout, ...derive(raw), redo: d.redo.slice(0, -1), undo: [...d.undo, JSON.stringify({ raw: d.raw, layout: d.layout })] })
    schedule(set, get, job, false)
  },
  flush: async (job) => { const t = saveTimers.get(job); if (t) { clearTimeout(t); saveTimers.delete(job); await save(set, get, job, false) } },
}))

onEvent((kind, data) => {
  if (kind === 'job.changed') { const d = data as { name: string; rev?: number }; useDag.getState().remoteChanged(d.name, d.rev) }
  else if (kind === 'connected') { for (const job of Object.keys(useDag.getState().jobs)) void useDag.getState().load(job) }
})

export { derive }
export function resetOwnRevs(): void { ownRevs = new Map() }

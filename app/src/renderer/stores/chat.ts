import { create } from 'zustand'
import { api } from '@/api/client'
import { subscribe, type Sse } from '@/api/sse'
import { onEvent } from '@/events'
import { Decoder, newTurn, type Turn } from '@/wire/decoder'
import type { Pending } from '@/wire/types'

export type Mode = 'debug' | 'author'
export type ChatState = { turns: Turn[]; running: boolean; session?: string; pending: Pending[]; lastProgressAt: number; stalled?: string }
const empty = (): ChatState => ({ turns: [], running: false, pending: [], lastProgressAt: 0 })

type Store = {
  lanes: Record<string, ChatState>
  get: (lane: string) => ChatState
  send: (job: string, mode: Mode, prompt: string, run?: string, permission?: 'acceptEdits' | 'plan') => void
  stop: (job: string, mode: Mode) => Promise<void>
  answer: (lane: string, id: string, decision: 'allow' | 'deny', rules: string[], scope: 'once' | 'project' | 'session' | 'trust', answer?: string) => Promise<void>
  pollPending: (lane: string) => Promise<void>
}

export const laneOf = (job: string, mode: Mode): string => (mode === 'debug' ? `${job}~debug` : job)
const streams = new Map<string, Sse>()
const decoders = new Map<string, Decoder>()

function patch(set: (fn: (s: Store) => Partial<Store>) => void, lane: string, p: Partial<ChatState> | ((c: ChatState) => Partial<ChatState>)) {
  set((s) => { const c = s.lanes[lane] ?? empty(); return { lanes: { ...s.lanes, [lane]: { ...c, ...(typeof p === 'function' ? p(c) : p) } } } })
}
/** Turns mutate in place as deltas land; bump the array identity so React redraws the current card. */
function touch(set: (fn: (s: Store) => Partial<Store>) => void, lane: string) {
  patch(set, lane, (c) => ({ turns: c.turns.slice(), lastProgressAt: Date.now() }))
}

export const useChat = create<Store>((set, get) => ({
  lanes: {},
  get: (lane) => get().lanes[lane] ?? empty(),
  send: (job, mode, prompt, run, permission = 'acceptEdits') => {
    const lane = laneOf(job, mode)
    if (get().get(lane).running) return
    const turn = newTurn(prompt)
    const dec = new Decoder(turn)
    decoders.set(lane, dec)
    patch(set, lane, (c) => ({ turns: [...c.turns, turn], running: true, stalled: undefined, lastProgressAt: Date.now() }))
    const q = new URLSearchParams({ job, mode, prompt, permission })
    if (run) q.set('run', run)
    const session = get().get(lane).session
    if (session) q.set('session', session)
    let raf = 0
    const flush = () => { raf = 0; touch(set, lane) }
    const s = subscribe('/api/chat?' + q.toString(), {
      on: (ev, data) => {
        if (ev === 'msg') { dec.feed(data); if (!raf) raf = requestAnimationFrame(flush) }
        else if (ev === 'done') {
          const d = JSON.parse(data) as { code: number; session: string }
          turn.running = false; turn.endedAt = Date.now(); turn.facts.code = d.code
          patch(set, lane, (c) => ({ running: false, session: d.session || c.session, turns: c.turns.slice() }))
          streams.delete(lane)
        } else if (ev === 'fatal') { turn.error = (JSON.parse(data) as { text: string }).text; touch(set, lane) }
        else if (ev === 'err') { turn.error = data; touch(set, lane) }
      },
      end: (reason) => {
        if (streams.get(lane) !== s) return
        streams.delete(lane)
        if (turn.running) { turn.running = false; turn.endedAt = Date.now(); turn.error = turn.error ?? `stream ended: ${reason}`; patch(set, lane, (c) => ({ running: false, turns: c.turns.slice(), stalled: reason })) }
      },
    }, { silenceMs: 90_000 })
    streams.set(lane, s)
  },
  stop: async (job, mode) => { await api.post(`/api/chat/stop?job=${encodeURIComponent(job)}&mode=${mode}`, {}, 'stopping the turn') },
  answer: async (lane, id, decision, rules, scope, answer) => {
    const remember = scope === 'once' ? [] : rules
    await api.post('/api/approve/answer', { id, decision, rules: remember, scope: scope === 'once' ? 'project' : scope, answer }, 'the answer')
    patch(set, lane, (c) => ({ pending: c.pending.filter((p) => p.id !== id) }))
  },
  pollPending: async (lane) => {
    const r = await api.get<Pending[]>(`/api/approve/poll?lane=${encodeURIComponent(lane)}`, 'pending approvals')
    if (r.ok) patch(set, lane, { pending: r.value })
  },
}))

onEvent((kind, data) => {
  const st = useChat.getState()
  if (kind === 'pending') {
    const d = data as { lane: string }
    if (d.lane in st.lanes || st.get(d.lane).running || true) void st.pollPending(d.lane)
  } else if (kind === 'turn') {
    const d = data as { lane: string; turn: string; kind: string } & Record<string, unknown>
    // facts are keyed by job (debug and author share a job); apply to the running turn of whichever lane is running
    for (const [lane, c] of Object.entries(st.lanes)) {
      if (!lane.startsWith(d.lane)) continue
      const t = c.turns[c.turns.length - 1]
      if (!t || (!t.running && d.kind !== 'ended')) continue
      applyFact(t, d)
      useChat.setState((s) => ({ lanes: { ...s.lanes, [lane]: { ...c, turns: c.turns.slice() } } }))
    }
  } else if (kind === 'connected') {
    for (const lane of Object.keys(st.lanes)) void st.pollPending(lane)
  }
})

function applyFact(t: Turn, d: { kind: string } & Record<string, unknown>): void {
  switch (d.kind) {
    case 'started': t.facts.snapshot = String(d.snapshot ?? ''); break
    case 'files': t.facts.files = (d.files as string[]) ?? []; break
    case 'gate': t.facts.gate = d as Record<string, unknown>; break
    case 'commit': t.facts.commit = d.commit as string | undefined; if (d.error) t.facts.error = String(d.error); break
    case 'usage': t.usage = { ...(t.usage ?? {}), input: d.input as number, output: d.output as number, cacheRead: d.cacheRead as number, cacheWrite: d.cacheWrite as number, costUsd: d.costUsd as number }; break
    case 'ended': t.facts.ms = d.ms as number; t.facts.code = d.code as number; break
  }
}

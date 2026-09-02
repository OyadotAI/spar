/**
 * stream-json → turns. Ported from keel-viewer's Decoder.swift and pruned to what the pane draws:
 * a turn is a sequence of steps (prose, thinking, tool calls with their results), in the order
 * they happened, filling in as deltas arrive.
 */
export type Step =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'call'; id: string; name: string; inputText: string; input?: unknown; result?: string; isError?: boolean; done: boolean }

export type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; durationMs?: number; error?: string }
export type Facts = { snapshot?: string; files?: string[]; gate?: Record<string, unknown>; commit?: string; ms?: number; code?: number; error?: string }
export type Turn = { id: string; prompt: string; steps: Step[]; running: boolean; startedAt: number; endedAt?: number; usage?: Usage; facts: Facts; error?: string; session?: string }

type Raw = { type?: string; subtype?: string; event?: RawEvent; message?: RawMessage; session_id?: string; usage?: Record<string, number>; total_cost_usd?: number; duration_ms?: number; is_error?: boolean; result?: string }
type RawEvent = { type: string; index?: number; content_block?: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }; delta?: { type: string; text?: string; thinking?: string; partial_json?: string } }
type RawMessage = { role?: string; content?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }> }

export class Decoder {
  private blocks = new Map<number, Step>()
  constructor(readonly turn: Turn) {}

  feed(line: string): void {
    let raw: Raw
    try { raw = JSON.parse(line) } catch { return }
    const t = this.turn
    switch (raw.type) {
      case 'system': if (raw.subtype === 'init' && raw.session_id) t.session = raw.session_id; return
      case 'stream_event': this.event(raw.event); return
      case 'assistant': this.assistant(raw.message); return
      case 'user': this.user(raw.message); return
      case 'result':
        t.usage = { input: raw.usage?.input_tokens, output: raw.usage?.output_tokens, cacheRead: raw.usage?.cache_read_input_tokens,
          cacheWrite: raw.usage?.cache_creation_input_tokens, costUsd: raw.total_cost_usd, durationMs: raw.duration_ms }
        if (raw.is_error) t.error = raw.result ?? 'the turn ended with an error'
        return
      default: return
    }
  }

  private event(ev?: RawEvent): void {
    if (!ev) return
    const t = this.turn
    switch (ev.type) {
      case 'message_start': this.blocks = new Map(); return
      case 'content_block_start': {
        const b = ev.content_block; if (!b || ev.index === undefined) return
        let step: Step
        if (b.type === 'text') step = { kind: 'text', text: b.text ?? '' }
        else if (b.type === 'thinking') step = { kind: 'thinking', text: b.thinking ?? '' }
        else if (b.type === 'tool_use') step = { kind: 'call', id: b.id ?? '', name: b.name ?? '?', inputText: '', input: b.input, done: false }
        else return
        this.blocks.set(ev.index, step); t.steps.push(step); return
      }
      case 'content_block_delta': {
        const step = ev.index === undefined ? undefined : this.blocks.get(ev.index); const d = ev.delta
        if (!step || !d) return
        if (d.type === 'text_delta' && step.kind === 'text') step.text += d.text ?? ''
        else if (d.type === 'thinking_delta' && step.kind === 'thinking') step.text += d.thinking ?? ''
        else if (d.type === 'input_json_delta' && step.kind === 'call') step.inputText += d.partial_json ?? ''
        return
      }
      case 'content_block_stop': {
        const step = ev.index === undefined ? undefined : this.blocks.get(ev.index)
        if (step?.kind === 'call' && step.input === undefined && step.inputText) { try { step.input = JSON.parse(step.inputText) } catch { /* partial */ } }
        return
      }
      default: return
    }
  }

  /** The full message after the deltas: the authoritative content for anything the deltas missed. */
  private assistant(m?: RawMessage): void {
    if (!m?.content) return
    m.content.forEach((b, i) => {
      const existing = this.blocks.get(i)
      if (b.type === 'text') { if (existing?.kind === 'text') existing.text = b.text ?? existing.text; else if (!existing) this.add(i, { kind: 'text', text: b.text ?? '' }) }
      else if (b.type === 'thinking') { if (existing?.kind === 'thinking') existing.text = b.thinking ?? existing.text; else if (!existing) this.add(i, { kind: 'thinking', text: b.thinking ?? '' }) }
      else if (b.type === 'tool_use') {
        const found = existing?.kind === 'call' ? existing : this.turn.steps.find((s): s is Extract<Step, { kind: 'call' }> => s.kind === 'call' && s.id === b.id)
        if (found) { found.input = b.input; found.name = b.name ?? found.name; found.id = b.id ?? found.id }
        else this.add(i, { kind: 'call', id: b.id ?? '', name: b.name ?? '?', inputText: '', input: b.input, done: false })
      }
    })
  }

  private user(m?: RawMessage): void {
    if (!m?.content) return
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue
      const call = this.turn.steps.find((s): s is Extract<Step, { kind: 'call' }> => s.kind === 'call' && s.id === b.tool_use_id)
      if (!call) continue
      call.result = resultText(b.content); call.isError = !!b.is_error; call.done = true
    }
  }

  private add(i: number, s: Step): void { this.blocks.set(i, s); this.turn.steps.push(s) }
}

function resultText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : '')).join('\n')
  return c == null ? '' : JSON.stringify(c)
}

export function newTurn(prompt: string): Turn {
  return { id: crypto.randomUUID(), prompt, steps: [], running: true, startedAt: Date.now(), facts: {} }
}

/** One line per call, the way the pane draws it. */
export function callSubject(step: Extract<Step, { kind: 'call' }>): string {
  const inp = (step.input ?? safeParse(step.inputText)) as Record<string, unknown> | undefined
  if (!inp) return step.name
  switch (step.name) {
    case 'Bash': return String(inp.command ?? '').split('\n')[0] ?? ''
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': return String(inp.file_path ?? inp.path ?? '')
    case 'Glob': case 'Grep': return String(inp.pattern ?? '')
    case 'WebFetch': return String(inp.url ?? '')
    case 'WebSearch': return String(inp.query ?? '')
    case 'Task': return String(inp.description ?? '')
    default: return Object.entries(inp).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v)?.slice(0, 60)}`).join(' ')
  }
}
function safeParse(s: string): unknown { try { return s ? JSON.parse(s) : undefined } catch { return undefined } }

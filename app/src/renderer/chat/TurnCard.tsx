import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { callSubject, type Step, type Turn } from '@/wire/decoder'
import { Icon } from '@/shell/Icon'

type Call = Extract<Step, { kind: 'call' }>

/** Consecutive tool calls fold into one "N commands" card, the way v1 draws a turn. */
function group(steps: Step[]): (Step | { kind: 'calls'; calls: Call[] })[] {
  const out: (Step | { kind: 'calls'; calls: Call[] })[] = []
  for (const s of steps) {
    const last = out[out.length - 1]
    if (s.kind === 'call') { if (last && last.kind === 'calls') last.calls.push(s); else out.push({ kind: 'calls', calls: [s] }) }
    else out.push(s)
  }
  return out
}

export function TurnCard({ turn, index }: { turn: Turn; index: number }) {
  return (
    <div className="turn">
      <div className="prompt">{turn.prompt}</div>
      <div className="who"><Icon name="keel" size={14} />Keel <span className="faint" style={{ fontWeight: 400 }}>· turn {index}</span></div>
      {group(turn.steps).map((s, i) => s.kind === 'calls' ? <Calls key={i} calls={s.calls} running={turn.running} /> : <StepView key={i} step={s} />)}
      {turn.error && <pre className="err">{turn.error}</pre>}
      {!turn.running && <Footer turn={turn} />}
    </div>
  )
}

function StepView({ step }: { step: Step }) {
  if (step.kind === 'text') return <div className="md"><Markdown remarkPlugins={[remarkGfm]}>{step.text}</Markdown></div>
  if (step.kind === 'thinking') return step.text ? <details className="thinking"><summary>thinking</summary><div className="faint small" style={{ whiteSpace: 'pre-wrap' }}>{step.text}</div></details> : null
  return null
}

function Calls({ calls, running }: { calls: Call[]; running: boolean }) {
  const [open, setOpen] = useState(running)
  const bad = calls.filter((c) => c.isError).length
  return (
    <details className="calls" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><Icon name="chevron" size={12} style={{ color: 'var(--faint)' }} /><span>{calls.length} {calls.length === 1 ? 'command' : 'commands'}</span>{bad > 0 && <span className="pill err">{bad} failed</span>}{running && !calls[calls.length - 1]?.done && <span className="dot live" style={{ color: 'var(--accent)', marginLeft: 4 }} />}</summary>
      {calls.map((c) => <CallRow key={c.id || c.name + c.inputText} step={c} />)}
    </details>
  )
}

function CallRow({ step }: { step: Call }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'call' + (step.isError ? ' bad' : step.done ? ' ok' : '')}>
      <div className="head" onClick={() => setOpen(!open)}>
        <span className="mark">{step.done ? (step.isError ? '✗' : '✓') : '…'}</span>
        <span className="name">{step.name}</span>
        <span className="subject">{callSubject(step)}</span>
      </div>
      {open && (
        <div className="body">
          <pre>{typeof step.input === 'object' ? JSON.stringify(step.input, null, 2) : step.inputText}</pre>
          {step.result !== undefined && <pre className={step.isError ? 'err' : ''} style={{ marginTop: 8 }}>{step.result.length > 4000 ? step.result.slice(0, 4000) + '\n…' : step.result}</pre>}
        </div>)}
    </div>
  )
}

function Footer({ turn }: { turn: Turn }) {
  const f = turn.facts
  const gate = f.gate as { status?: string; passed?: number; failed?: number } | undefined
  const tokens = (turn.usage?.input ?? 0) + (turn.usage?.cacheRead ?? 0) + (turn.usage?.cacheWrite ?? 0)
  const cached = tokens ? Math.round(((turn.usage?.cacheRead ?? 0) / tokens) * 100) : 0
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  return (
    <div className="footer">
      {f.files && f.files.length > 0 && <div className="fact"><span className="eyebrow">Files</span><span className="v" title={f.files.join('\n')}><Icon name="files" />{f.files.length} changed</span></div>}
      {gate?.status && <div className="fact"><span className="eyebrow">Tests</span><span className={'v ' + (gate.status === 'passed' ? 'ok' : gate.status === 'failed' ? 'bad' : '')}><Icon name={gate.status === 'passed' ? 'check' : 'x'} />{gate.status}{gate.passed != null ? ` · ${gate.passed}✓${gate.failed ? ` ${gate.failed}✗` : ''}` : ''}</span></div>}
      {f.commit && <div className="fact"><span className="eyebrow">Commit</span><span className="v ok"><Icon name="commit" />{f.commit}</span></div>}
      {f.ms != null && <div className="fact"><span className="eyebrow">Time</span><span className="v"><Icon name="clock" />{(f.ms / 1000).toFixed(1)}s</span></div>}
      {turn.usage?.output != null && <div className="fact"><span className="eyebrow">Tokens</span><span className="v"><Icon name="tokens" />{k(tokens)} in · {k(turn.usage.output)} out{cached > 0 && <span className="faint" style={{ fontFamily: 'var(--font)' }}> {cached}% cached</span>}</span></div>}
      {turn.usage?.costUsd != null && <div className="fact"><span className="eyebrow">Cost</span><span className="v"><Icon name="dollar" />${turn.usage.costUsd.toFixed(3)}</span></div>}
      {f.code != null && f.code !== 0 && <div className="fact"><span className="eyebrow">Exit</span><span className="v bad">{f.code}</span></div>}
    </div>
  )
}

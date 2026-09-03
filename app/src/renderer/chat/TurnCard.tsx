import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { callSubject, type Step, type Turn } from '@/wire/decoder'
import { Icon } from '@/shell/Icon'
import { useTerminal } from '@/stores/terminal'
import { useApp } from '@/stores/app'

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
      {turn.error && <TurnError error={turn.error} turn={turn} />}
      {!turn.running && <Footer turn={turn} />}
    </div>
  )
}

function TurnError({ error, turn }: { error: string; turn: Turn }) {
  const openTerminal = useTerminal((s) => s.openWith)
  const state = useApp((s) => s.state)
  const claudeTool = state?.tools?.claude

  const isLogin =
    /not logged in|\/login|claude login|claude auth login|authentication|subscription/i.test(error) ||
    turn.steps.some((s) => s.kind === 'text' && /not logged in|\/login|claude login/i.test(s.text)) ||
    claudeTool?.loggedIn === false

  const isNotInstalled =
    /not found|could not (?:find|start) claude|ENOENT|code 127/i.test(error) ||
    (claudeTool !== undefined && !claudeTool.installed)

  if (isLogin) {
    return (
      <div className="card" style={{ padding: 'var(--s3)', margin: 'var(--s2) 0', border: '1px solid var(--warn)', background: 'var(--warn-bg)' }}>
        <div className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--warn)', marginBottom: 4 }}>
          <Icon name="warn" size={14} />Not signed in to Claude Code
        </div>
        <p className="small dim" style={{ margin: '0 0 var(--s2) 0', color: 'var(--text)' }}>
          Claude Code requires an active subscription or sign in. Sign in using the terminal to enable the agent.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <button className="primary" onClick={() => openTerminal('claude login')}>
            <Icon name="terminal" />Sign in (claude login)
          </button>
        </div>
        <details className="thinking" style={{ marginTop: 8 }}>
          <summary>Error details</summary>
          <pre className="err" style={{ marginTop: 4 }}>{error}</pre>
        </details>
      </div>
    )
  }

  if (isNotInstalled) {
    return (
      <div className="card" style={{ padding: 'var(--s3)', margin: 'var(--s2) 0', border: '1px solid var(--del)', background: 'var(--del-bg)' }}>
        <div className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--del)', marginBottom: 4 }}>
          <Icon name="bad" size={14} />Claude Code is not installed
        </div>
        <p className="small dim" style={{ margin: '0 0 var(--s2) 0', color: 'var(--text)' }}>
          Keel drives your local <code>claude</code> CLI for debugging and authoring. Install it globally on your machine.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <button className="primary" onClick={() => openTerminal('npm i -g @anthropic-ai/claude-code')}>
            <Icon name="terminal" />Install Claude Code
          </button>
        </div>
        <details className="thinking" style={{ marginTop: 8 }}>
          <summary>Error details</summary>
          <pre className="err" style={{ marginTop: 4 }}>{error}</pre>
        </details>
      </div>
    )
  }

  return (
    <div style={{ margin: 'var(--s2) 0' }}>
      <pre className="err">{error}</pre>
      {/claude exited/i.test(error) && (
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <button className="primary" onClick={() => openTerminal('claude login')}>
            <Icon name="terminal" />Sign in (claude login)
          </button>
          <button onClick={() => openTerminal('claude -p "hi"')}>
            <Icon name="terminal" />Test claude in terminal
          </button>
        </div>
      )}
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

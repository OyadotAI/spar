import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat, laneOf, type Mode } from '@/stores/chat'
import { useApp } from '@/stores/app'
import { useTerminal } from '@/stores/terminal'
import { Icon } from '@/shell/Icon'
import { TurnCard } from './TurnCard'
import { ApprovalCard } from './ApprovalCard'

/** One stable empty array: a fresh one per render would re-run the follow effect for ever. */
const NO_TURNS: ReturnType<typeof useChat.getState>['lanes'][string]['turns'] = []

export function ChatRail({
  job,
  mode,
  run,
  placeholder,
  title,
  onClose,
}: {
  job: string
  mode: Mode
  run?: string
  placeholder?: string
  title?: string
  onClose?: () => void
}) {
  const lane = laneOf(job, mode)
  const c = useChat((s) => s.lanes[lane])
  const { send, stop, pollPending } = useChat()
  const state = useApp((s) => s.state)
  const openTerminal = useTerminal((s) => s.openWith)
  const [text, setText] = useState('')
  const [plan, setPlan] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const turns = c?.turns ?? NO_TURNS
  const running = c?.running ?? false
  const pending = c?.pending ?? []
  useEffect(() => { void pollPending(lane) }, [lane, pollPending])

  const [atTail, setAtTail] = useState(true)
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (el) setAtTail(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])
  const toTail = useCallback(() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; setAtTail(true) } }, [])
  useEffect(() => { const el = scroller.current; if (el && atTail) el.scrollTop = el.scrollHeight }, [turns, pending.length, running, atTail])
  const submit = (override?: string) => {
    const p = (override ?? text).trim()
    if (!p || running) return
    setText('')
    send(job, mode, p, run, plan ? 'plan' : 'acceptEdits')
  }
  const last = turns[turns.length - 1]
  const claudeTool = state?.tools?.claude
  const notInstalled = claudeTool && !claudeTool.installed
  const notLoggedIn = claudeTool && claudeTool.installed && claudeTool.loggedIn === false

  const defaultPlaceholder = mode === 'debug'
    ? 'Ask why this run failed or how to fix it…'
    : 'Describe what the pipeline should do…'

  const suggestions = mode === 'debug'
    ? ['Why did this run fail?', 'Explain the error logs', 'Suggest code fixes']
    : ['Add an S3 source and target', 'Filter records where status is active', 'Add unit tests for transforms']

  return (
    <div className="col chat" style={{ height: '100%', borderLeft: '1px solid var(--line)' }}>
      <div className="panel-head" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          <Icon name={mode === 'debug' ? 'debug' : 'magic'} size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, fontSize: 'var(--small)' }}>
            {title ?? (mode === 'debug' ? 'Debug Agent' : 'Authoring Agent')}
          </span>
          {mode === 'debug' && run && (
            <span className="pill micro mono" title={run}>
              run {run.slice(3, 11)}…
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {running && <span className="dot live" style={{ color: 'var(--accent)' }} />}
          {onClose && (
            <button className="quiet micro" onClick={onClose} title="Hide agent" aria-label="Hide agent">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      <div ref={scroller} className="fill scroll" style={{ overflow: 'auto', position: 'relative' }} onScroll={onScroll}>
        {turns.length === 0 && !pending.length && (
          <>
            <div className="intro">
              {mode === 'debug'
                ? 'The agent starts with the job definition, the selected run and its error log already in front of it. Ask what happened, why, and what to change.'
                : 'Describe what the pipeline should do. The agent writes the DAG, the tests, and keeps the canvas in sync while you edit it.'}
            </div>
            {notInstalled && (
              <div className="card" style={{ padding: 'var(--s3)', margin: 'var(--s2) 0', border: '1px solid var(--del)', background: 'var(--del-bg)' }}>
                <div className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--del)', marginBottom: 4 }}>
                  <Icon name="bad" size={14} />Claude Code not installed
                </div>
                <p className="small dim" style={{ margin: '0 0 var(--s2) 0', color: 'var(--text)' }}>
                  The agent needs Claude Code to run. Install it globally on this machine.
                </p>
                <button className="primary" onClick={() => openTerminal('npm i -g @anthropic-ai/claude-code')}>
                  <Icon name="terminal" />Install Claude Code
                </button>
              </div>)}
            {notLoggedIn && (
              <div className="card" style={{ padding: 'var(--s3)', margin: 'var(--s2) 0', border: '1px solid var(--warn)', background: 'var(--warn-bg)' }}>
                <div className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--warn)', marginBottom: 4 }}>
                  <Icon name="warn" size={14} />Sign in to Claude Code
                </div>
                <p className="small dim" style={{ margin: '0 0 var(--s2) 0', color: 'var(--text)' }}>
                  Claude Code is installed, but not signed in. Connect your subscription in the terminal.
                </p>
                <button className="primary" onClick={() => openTerminal('claude login')}>
                  <Icon name="terminal" />Sign in (claude login)
                </button>
              </div>)}
            <div className="col" style={{ gap: 6, marginTop: 12 }}>
              <span className="eyebrow">Suggestions</span>
              <div className="col" style={{ gap: 4 }}>
                {suggestions.map((s) => (
                  <button key={s} className="quiet" style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '6px 8px', borderRadius: 'var(--r)', background: 'var(--ghost)' }} onClick={() => setText(s)}>
                    <Icon name="chevron" size={11} style={{ color: 'var(--faint)' }} /><span>{s}</span>
                  </button>
                ))}
              </div>
            </div>
          </>)}
        {turns.map((t, i) => <TurnCard key={t.id} turn={t} index={i + 1} />)}
        {pending.map((p) => <ApprovalCard key={p.id} lane={lane} pending={p} />)}
        {running && last && (
          <div className={'working' + (pending.length ? ' paused' : '')}>
            <span className="bar" />
            <span>{pending.length ? 'paused — waiting for your answer' : 'working…'}</span>
            <span className="fill" />
            <span className="fig">{Math.round((Date.now() - last.startedAt) / 1000)}s</span>
            <button className="quiet danger" onClick={() => void stop(job, mode)}>Stop</button>
          </div>)}
        {c?.stalled && !running && <div className="faint small" style={{ padding: 8 }}>stream ended: {c.stalled}</div>}
      </div>

      {!atTail && turns.length > 0 && (
        <button className="to-tail" style={{ bottom: 104 }} onClick={toTail} title="Jump to the newest">
          <Icon name="chevronDown" size={12} />{running ? 'Following…' : 'Latest'}
        </button>)}

      <div className="composer">
        <textarea
          value={text}
          placeholder={placeholder ?? defaultPlaceholder}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }}
        />
        <div className="bar">
          <div className="seg">
            <button className={plan ? 'on' : ''} onClick={() => setPlan(true)} title="Read and plan only; no edits">Plan</button>
            <button className={!plan ? 'on' : ''} onClick={() => setPlan(false)} title="Edits allowed; commands ask">Auto</button>
          </div>
          <span className="fill" />
          {running ? (
            <button className="danger" onClick={() => void stop(job, mode)}>Stop</button>
          ) : (
            <button className="primary" onClick={() => submit()} disabled={!text.trim()}>
              Send <span className="faint" style={{ fontWeight: 400 }}>⌘↵</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat, laneOf, type Mode } from '@/stores/chat'
import { Icon } from '@/shell/Icon'
import { TurnCard } from './TurnCard'
import { ApprovalCard } from './ApprovalCard'

/** One stable empty array: a fresh one per render would re-run the follow effect for ever. */
const NO_TURNS: ReturnType<typeof useChat.getState>['lanes'][string]['turns'] = []

export function ChatRail({ job, mode, run, placeholder, composerOnTop = false }:
  { job: string; mode: Mode; run?: string; placeholder: string; composerOnTop?: boolean }) {
  const lane = laneOf(job, mode)
  const c = useChat((s) => s.lanes[lane])
  const { send, stop, pollPending } = useChat()
  const [text, setText] = useState('')
  const [plan, setPlan] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const turns = c?.turns ?? NO_TURNS
  const running = c?.running ?? false
  const pending = c?.pending ?? []
  useEffect(() => { void pollPending(lane) }, [lane, pollPending])
  /**
   * Follow the tail while a turn streams — but only when you are already at the tail.
   *
   * This was `if (el && !composerOnTop)`, which switched following off entirely on the authoring
   * and script rails, so a long turn grew past the fold and its footer (files, tests, commit,
   * cost) never came into view. Unconditional scrolling is the opposite bug: it yanks you back
   * mid-read. Same rule the log console already uses.
   */
  const [atTail, setAtTail] = useState(true)
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (el) setAtTail(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])
  const toTail = useCallback(() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; setAtTail(true) } }, [])
  useEffect(() => { const el = scroller.current; if (el && atTail) el.scrollTop = el.scrollHeight }, [turns, pending.length, running, atTail])
  const submit = () => { const p = text.trim(); if (!p || running) return; setText(''); send(job, mode, p, run, plan ? 'plan' : 'acceptEdits') }
  const last = turns[turns.length - 1]
  const composer = (
    <div className="composer">
      <textarea value={text} placeholder={placeholder} rows={composerOnTop ? 4 : 3} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }} />
      <div className="bar">
        <div className="seg"><button className={plan ? 'on' : ''} onClick={() => setPlan(true)} title="Read and plan only; no edits">Plan</button><button className={!plan ? 'on' : ''} onClick={() => setPlan(false)} title="Edits allowed; commands ask">Auto</button></div>
        <span className="fill" />
        {running ? <button className="danger" onClick={() => void stop(job, mode)}>Stop</button> : <button className="primary" onClick={submit} disabled={!text.trim()}>Send <span className="faint" style={{ fontWeight: 400 }}>⌘↵</span></button>}
      </div>
    </div>
  )
  return (
    <div className="col chat" style={{ height: '100%' }}>
      {composerOnTop && composer}
      <div ref={scroller} className="fill scroll" style={{ overflow: 'auto', position: 'relative' }} onScroll={onScroll}>
        {turns.length === 0 && !pending.length && (
          <div className="intro">
            {mode === 'debug' ? 'The agent starts with the job definition, the selected run and its error log already in front of it. Ask what happened, why, and what to change.'
              : 'Describe what the pipeline should do. The agent writes the DAG, the tests, and keeps the canvas in sync while you edit it.'}
          </div>)}
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
        <button className="to-tail" style={{ bottom: composerOnTop ? 14 : 104 }} onClick={toTail} title="Jump to the newest">
          <Icon name="chevronDown" size={12} />{running ? 'Following…' : 'Latest'}
        </button>)}
      {!composerOnTop && composer}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useChat, laneOf, type Mode } from '@/stores/chat'
import { TurnCard } from './TurnCard'
import { ApprovalCard } from './ApprovalCard'

export function ChatRail({ job, mode, run, placeholder, composerOnTop = false }:
  { job: string; mode: Mode; run?: string; placeholder: string; composerOnTop?: boolean }) {
  const lane = laneOf(job, mode)
  const c = useChat((s) => s.lanes[lane])
  const { send, stop, pollPending } = useChat()
  const [text, setText] = useState('')
  const [plan, setPlan] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const turns = c?.turns ?? []
  const running = c?.running ?? false
  const pending = c?.pending ?? []
  useEffect(() => { void pollPending(lane) }, [lane, pollPending])
  useEffect(() => { const el = scroller.current; if (el && !composerOnTop) el.scrollTop = el.scrollHeight }, [turns, pending.length, composerOnTop])
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
      <div ref={scroller} className="fill scroll" style={{ overflow: 'auto' }}>
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
      {!composerOnTop && composer}
    </div>
  )
}

import { useState } from 'react'
import { useChat } from '@/stores/chat'
import { Icon } from '@/shell/Icon'
import type { Pending } from '@/wire/types'

type Q = { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean }

export function ApprovalCard({ lane, pending }: { lane: string; pending: Pending }) {
  const answer = useChat((s) => s.answer)
  const [reason, setReason] = useState('')
  if (pending.tool === 'AskUserQuestion') return <QuestionCard lane={lane} pending={pending} />
  const rule = pending.rules[0]
  return (
    <div className="approval">
      <div className="title"><Icon name="hand" size={16} style={{ color: 'var(--warn)' }} />Let the agent run this?</div>
      <div className="cmd">{pending.command || JSON.stringify(pending.input, null, 2)}</div>
      <div className="actions">
        <button className="primary" onClick={() => void answer(lane, pending.id, 'allow', [], 'trust')} title="Stop asking about this project">Trust this project</button>
        {rule && <button onClick={() => void answer(lane, pending.id, 'allow', [rule], 'project')} title={`Remember ${rule} for this project`}>Allow {rule.replace(/^Bash\((.*)\*\)$/, 'Bash($1 *)')}</button>}
        <button onClick={() => void answer(lane, pending.id, 'allow', [], 'once')}>Once</button>
        <span className="fill" />
        <input placeholder="why not (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 150 }} />
        <button className="danger" onClick={() => void answer(lane, pending.id, 'deny', [], 'once', reason)}>Deny</button>
      </div>
    </div>
  )
}

function QuestionCard({ lane, pending }: { lane: string; pending: Pending }) {
  const answer = useChat((s) => s.answer)
  const qs = ((pending.input as { questions?: Q[] })?.questions ?? []).filter((q) => q && q.question)
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [free, setFree] = useState<Record<number, string>>({})
  const toggle = (i: number, label: string, multi?: boolean) => setPicked((p) => {
    const cur = p[i] ?? []
    if (multi) return { ...p, [i]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] }
    return { ...p, [i]: [label] }
  })
  const submit = () => {
    const text = qs.map((q, i) => `${q.question}\n→ ${[...(picked[i] ?? []), free[i]].filter(Boolean).join(', ') || '(no answer)'}`).join('\n\n')
    void answer(lane, pending.id, 'deny', [], 'once', text)
  }
  return (
    <div className="approval" style={{ borderColor: 'var(--accent)' }}>
      <div className="title"><Icon name="hand" size={16} style={{ color: 'var(--accent)' }} />The agent has a question</div>
      {qs.map((q, i) => (
        <div key={i} className="q">
          <div className="qt">{q.header ? <span className="eyebrow" style={{ marginRight: 8 }}>{q.header}</span> : null}{q.question}</div>
          {q.options.map((o) => (
            <label key={o.label} className="opt">
              <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`q${i}`} checked={(picked[i] ?? []).includes(o.label)} onChange={() => toggle(i, o.label, q.multiSelect)} />
              <span><b>{o.label}</b>{o.description && <span className="dim"> — {o.description}</span>}</span>
            </label>))}
          <input placeholder="or type your own" value={free[i] ?? ''} onChange={(e) => setFree({ ...free, [i]: e.target.value })} style={{ width: '100%', marginTop: 4 }} />
        </div>))}
      <div className="actions"><span className="fill" /><button className="primary" onClick={submit}>Answer</button></div>
    </div>
  )
}

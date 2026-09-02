import { useEffect, useState } from 'react'
import { api, type Fault } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { confirm } from '@/shell/Confirm'
import { tell } from '@/shell/Toast'
import { EmptyState, FaultState } from '@/shell/EmptyState'

type Entity = { name: string; regexString: string; contextWords?: string[] }

/** The console's Detection entities page: custom PII patterns a Detect Sensitive Data node can use. */
export function Entities() {
  const [custom, setCustom] = useState<Entity[] | null>(null)
  const [managed, setManaged] = useState<string[]>([])
  const [fault, setFault] = useState<Fault | null>(null)
  const [draft, setDraft] = useState<Entity | null>(null)
  const [sample, setSample] = useState('')
  const [check, setCheck] = useState<{ ok: boolean; matches?: string[]; why?: string } | null>(null)
  const load = async () => { const r = await api.get<{ custom: Entity[]; managed: string[] }>('/api/glue/entities', 'the detection entities'); if (r.ok) { setCustom(r.value.custom); setManaged(r.value.managed); setFault(null) } else setFault(r.fault) }
  useEffect(() => { void load() }, [])
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!custom) return <EmptyState title="Reading detection entities…" />
  const validate = async () => {
    if (!draft) return
    const r = await api.post<{ valid: boolean; matches?: string[] }>('/api/glue/entities/validate', { regex: draft.regexString, sample }, 'the pattern')
    setCheck(r.ok ? { ok: true, matches: r.value.matches } : { ok: false, why: r.fault.why })
  }
  const save = async () => {
    if (!draft) return
    const r = await api.post('/api/glue/entities', { name: draft.name, regex: draft.regexString, contextWords: draft.contextWords }, 'the entity')
    if (!r.ok) { setCheck({ ok: false, why: r.fault.why }); return }
    setDraft(null); setCheck(null); void load()
  }
  const del = async (name: string) => { if (!await confirm({ title: `Delete the detection entity "${name}"?`, danger: true, confirmLabel: 'Delete', body: "Detect Sensitive Data nodes that name this pattern will fail." })) return; await api.del(`/api/glue/entities/${encodeURIComponent(name)}`, 'deleting'); void load() }
  return (
    <div className="details" style={{ overflow: 'auto', height: '100%', maxWidth: 900 }}>
      <div className="row" style={{ marginBottom: 12 }}><h1 style={{ margin: 0 }}>Detection entities</h1><span className="fill" />
        <button className="primary" onClick={() => { setDraft({ name: '', regexString: '', contextWords: [] }); setCheck(null) }}><Icon name="plus" />Create entity</button></div>
      <p className="dim">Patterns a <b>Detect Sensitive Data</b> node can look for, on top of Glue's managed ones. A pattern is a regular expression; context words raise confidence when they appear nearby.</p>
      {draft && (
        <div className="card" style={{ padding: 16, margin: '12px 0' }}>
          <div className="grid">
            <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="EMPLOYEE_ID" /></label>
            <label>Context words (optional)<input value={(draft.contextWords ?? []).join(', ')} onChange={(e) => setDraft({ ...draft, contextWords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="employee, staff, badge" /></label>
            <label style={{ gridColumn: '1 / -1' }}>Regular expression<input className="mono" value={draft.regexString} onChange={(e) => { setDraft({ ...draft, regexString: e.target.value }); setCheck(null) }} placeholder="EMP-[0-9]{6}" /></label>
            <label style={{ gridColumn: '1 / -1' }}>Sample text to test against<input className="mono" value={sample} onChange={(e) => setSample(e.target.value)} placeholder="badge EMP-004213 issued" /></label>
          </div>
          {check && (check.ok
            ? <div className="small" style={{ color: check.matches?.length ? 'var(--add)' : 'var(--warn)' }}>{check.matches?.length ? `matches: ${check.matches.join(', ')}` : 'the pattern compiles, but matched nothing in the sample'}</div>
            : <div className="small" style={{ color: 'var(--del)' }}>{check.why}</div>)}
          <div className="row" style={{ marginTop: 12 }}><button onClick={() => void validate()}><Icon name="check" />Validate</button><span className="fill" />
            <button onClick={() => setDraft(null)}>Cancel</button><button className="primary" disabled={!draft.name || !draft.regexString} onClick={() => void save()}>Create</button></div>
        </div>)}
      <h2>Custom entities</h2>
      {custom.length === 0 && <p className="faint">None yet.</p>}
      {custom.map((e) => (
        <div key={e.name} className="card row" style={{ padding: '10px 14px', marginBottom: 6, alignItems: 'flex-start' }}>
          <Icon name="pii" style={{ color: 'var(--dim)', marginTop: 2 }} />
          <div className="fill"><b>{e.name}</b><div className="mono small dim" style={{ wordBreak: 'break-all' }}>{e.regexString}</div>
            {e.contextWords?.length ? <div className="faint small">context: {e.contextWords.join(', ')}</div> : null}</div>
          <button className="quiet danger" onClick={() => void del(e.name)}><Icon name="trash" /></button>
        </div>))}
      <h2>Managed entities</h2>
      <p className="dim small">Available to every Detect Sensitive Data node without setup.</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{managed.map((m) => <span key={m} className="pill">{m}</span>)}</div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useAccount } from '@/stores/glue'
import { api, type Fault } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { confirm } from '@/shell/Confirm'
import { tell } from '@/shell/Toast'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useSurfaceReason } from '@/shell/useSurfaceReason'
import { when } from '@/shell/format'

type Profile = { name: string; description?: string; createdOn?: string; job?: Record<string, Param>; session?: Record<string, Param> }
type Param = { default?: string; allowed?: string[]; min?: string; max?: string }
const JOB_KEYS = ['--enable-glue-datacatalog', 'GlueVersion', 'WorkerType', 'NumberOfWorkers', 'MaxRetries', 'Timeout', 'ExecutionClass', '--enable-continuous-cloudwatch-log', '--enable-metrics', '--enable-observability-metrics']
const SESSION_KEYS = ['GlueVersion', 'WorkerType', 'NumberOfWorkers', 'IdleTimeout', 'Timeout']

/** Usage profiles: the account's capacity guardrails, and what a job's ProfileName points at. */
export function Profiles() {
  const account = useAccount()
  const [list, setList] = useState<Profile[] | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [cur, setCur] = useState<Profile | null>(null)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = async () => { const r = await api.get<Profile[]>('/api/glue/profiles', 'the usage profiles'); if (r.ok) { setList(r.value); setFault(null) } else setFault(r.fault) }
  useEffect(() => { void load() }, [account]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) void api.get<Profile>(`/api/glue/profiles/${encodeURIComponent(sel)}`, 'the profile').then((r) => { if (r.ok) setCur(r.value) }) }, [sel])
  // the pane says which reason it is before it says it could not read anything
  const reason = useSurfaceReason('usage profiles')
  if (reason) return reason
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading usage profiles…" />
  const save = async () => {
    if (!draft?.name) return
    setMsg(null)
    const body = { description: draft.description, job: toParams(draft.job), session: toParams(draft.session) }
    const exists = list.some((p) => p.name === draft.name)
    const r = exists ? await api.put(`/api/glue/profiles/${encodeURIComponent(draft.name)}`, body, 'the profile') : await api.post(`/api/glue/profiles/${encodeURIComponent(draft.name)}`, body, 'the profile')
    if (!r.ok) { setMsg(r.fault.why); return }
    setDraft(null); setSel(draft.name); void load()
  }
  const del = async (name: string) => { if (!await confirm({ title: `Delete the usage profile "${name}"?`, danger: true, confirmLabel: 'Delete', body: "Jobs carrying this profile keep running; new jobs lose its defaults and limits." })) return; await api.del(`/api/glue/profiles/${encodeURIComponent(name)}`, 'deleting'); setSel(null); setCur(null); void load() }
  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <div className="panel" style={{ width: 260, flex: 'none' }}>
        <div className="panel-head"><span className="eyebrow">Usage profiles</span><span className="fill" />
          <button className="quiet" onClick={() => { setDraft({ name: '', job: {}, session: {} }); setSel(null) }}><Icon name="plus" size={12} /></button></div>
        <div className="fill" style={{ overflow: 'auto' }}>
          {list.length === 0 && <div className="faint small" style={{ padding: 12 }}>None in this account.</div>}
          {list.map((p) => <div key={p.name} className={'panel-row' + (p.name === sel ? ' on' : '')} onClick={() => { setSel(p.name); setDraft(null) }}><Icon name="gear" size={14} style={{ color: 'var(--dim)' }} /><span className="fill">{p.name}</span></div>)}
        </div>
      </div>
      <div className="fill details" style={{ overflow: 'auto' }}>
        {msg && <div className="small" style={{ color: 'var(--del)', marginBottom: 8 }}>{msg}</div>}
        {draft ? (
          <>
            <h2 style={{ marginTop: 0 }}>{list.some((p) => p.name === draft.name) ? 'Edit profile' : 'New usage profile'}</h2>
            <div className="grid">
              <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={list.some((p) => p.name === draft.name)} /></label>
              <label>Description<input value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
            </div>
            <ParamTable title="Job configuration" keys={JOB_KEYS} value={draft.job ?? {}} onChange={(job) => setDraft({ ...draft, job })} />
            <ParamTable title="Session configuration" keys={SESSION_KEYS} value={draft.session ?? {}} onChange={(session) => setDraft({ ...draft, session })} />
            <div className="row" style={{ marginTop: 14 }}><span className="fill" /><button onClick={() => setDraft(null)}>Cancel</button><button className="primary" onClick={() => void save()}>Save profile</button></div>
          </>
        ) : cur ? (
          <>
            <div className="row" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>{cur.name}</h2><span className="fill" />
              <button onClick={() => setDraft({ ...cur })}><Icon name="edit" />Edit</button>
              <button className="quiet danger" onClick={() => void del(cur.name)}><Icon name="trash" /></button></div>
            {cur.description && <p className="dim">{cur.description}</p>}
            <p className="faint small">Created {when(cur.createdOn)}</p>
            <Shown title="Job configuration" value={cur.job} />
            <Shown title="Session configuration" value={cur.session} />
          </>
        ) : <EmptyState title="Pick a usage profile">A profile caps and defaults what a job or session may request. A job carries one as its ProfileName; Keel shows it on Job details.</EmptyState>}
      </div>
    </div>
  )
}

function Shown({ title, value }: { title: string; value?: Record<string, Param> }) {
  const rows = Object.entries(value ?? {})
  if (!rows.length) return null
  return (<><h2>{title}</h2><table className="mono small" style={{ borderCollapse: 'collapse' }}>
    <thead><tr><th style={{ textAlign: 'left', paddingRight: 16 }} className="eyebrow">parameter</th><th className="eyebrow" style={{ textAlign: 'left', paddingRight: 16 }}>default</th><th className="eyebrow" style={{ textAlign: 'left', paddingRight: 16 }}>allowed</th><th className="eyebrow" style={{ textAlign: 'left' }}>range</th></tr></thead>
    <tbody>{rows.map(([k, v]) => <tr key={k}><td style={{ paddingRight: 16 }}>{k}</td><td style={{ paddingRight: 16 }}>{v.default ?? '—'}</td><td style={{ paddingRight: 16 }}>{v.allowed?.join(', ') ?? '—'}</td><td>{v.min || v.max ? `${v.min ?? ''}–${v.max ?? ''}` : '—'}</td></tr>)}</tbody>
  </table></>)
}

function ParamTable({ title, keys, value, onChange }: { title: string; keys: string[]; value: Record<string, Param>; onChange: (v: Record<string, Param>) => void }) {
  const rows = Object.entries(value)
  const set = (k: string, p: Partial<Param>) => onChange({ ...value, [k]: { ...value[k], ...p } })
  return (
    <><h2>{title}</h2>
      <div className="mini-table">
        <div className="mini-head" style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr 70px 70px 22px' }}><span>parameter</span><span>default</span><span>allowed (comma)</span><span>min</span><span>max</span><span /></div>
        {rows.map(([k, p]) => (
          <div key={k} className="mini-row" style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr 70px 70px 22px' }}>
            <span className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</span>
            <input className="mono" defaultValue={p.default ?? ''} onBlur={(e) => set(k, { default: e.target.value })} />
            <input className="mono" defaultValue={Array.isArray(p.allowed) ? p.allowed.join(',') : ''} onBlur={(e) => onChange({ ...value, [k]: { ...p, allowed: e.target.value ? e.target.value.split(',').map((s) => s.trim()) : undefined } })} />
            <input className="mono" defaultValue={p.min ?? ''} onBlur={(e) => set(k, { min: e.target.value })} />
            <input className="mono" defaultValue={p.max ?? ''} onBlur={(e) => set(k, { max: e.target.value })} />
            <button className="quiet" aria-label={`Remove ${k}`} onClick={() => { const n = { ...value }; delete n[k]; onChange(n) }}><Icon name="x" size={12} /></button>
          </div>))}
        <select value="" onChange={(e) => { if (e.target.value) onChange({ ...value, [e.target.value]: {} }) }}>
          <option value="">+ parameter…</option>
          {keys.filter((k) => !(k in value)).map((k) => <option key={k}>{k}</option>)}
        </select>
      </div></>
  )
}

function toParams(v?: Record<string, Param>): Record<string, { defaultValue?: string; allowedValues?: string; minValue?: string; maxValue?: string }> | undefined {
  if (!v || !Object.keys(v).length) return undefined
  const out: Record<string, { defaultValue?: string; allowedValues?: string; minValue?: string; maxValue?: string }> = {}
  for (const [k, p] of Object.entries(v)) out[k] = { defaultValue: p.default, allowedValues: Array.isArray(p.allowed) ? p.allowed.join(',') : undefined, minValue: p.min, maxValue: p.max }
  return out
}

import { useEffect, useState } from 'react'
import { api, type Fault } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { confirm } from '@/shell/Confirm'
import { tell } from '@/shell/Toast'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { when } from '@/shell/format'

type Conn = { name: string; type: string; description?: string; status?: string; statusReason?: string; createdOn?: string; lastUpdated?: string
  properties: Record<string, string>; subnetId?: string; securityGroups?: string[]; availabilityZone?: string; matchCriteria?: string[] }

const COMMON: Record<string, string[]> = {
  JDBC: ['JDBC_CONNECTION_URL', 'USERNAME', 'PASSWORD', 'SECRET_ID', 'JDBC_ENFORCE_SSL'],
  KAFKA: ['KAFKA_BOOTSTRAP_SERVERS', 'KAFKA_SSL_ENABLED', 'KAFKA_CUSTOM_CERT'],
  NETWORK: [],
  MONGODB: ['CONNECTION_URL', 'USERNAME', 'PASSWORD'],
  SNOWFLAKE: ['SECRET_ID', 'HOST', 'WAREHOUSE', 'ROLE_ARN'],
  REDSHIFT: ['JDBC_CONNECTION_URL', 'SECRET_ID'],
}

/** The Glue console's Connections page: what a job attaches to, created, edited, tested, deleted. */
export function Connections() {
  const [list, setList] = useState<Conn[] | null>(null)
  const [types, setTypes] = useState<string[]>([])
  const [fault, setFault] = useState<Fault | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<Conn> | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = async () => { const r = await api.get<Conn[]>('/api/glue/connections/full', 'the connections'); if (r.ok) { setList(r.value); setFault(null) } else setFault(r.fault) }
  useEffect(() => { void load(); void api.get<string[]>('/api/glue/connections/types', 'connection types').then((r) => { if (r.ok) setTypes(r.value) }) }, [])
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading connections…" />
  const cur = list.find((c) => c.name === sel)
  const save = async () => {
    if (!editing?.name) return
    setMsg(null)
    const body = { name: editing.name, type: editing.type ?? 'JDBC', description: editing.description, properties: editing.properties ?? {}, subnetId: editing.subnetId, securityGroups: editing.securityGroups, availabilityZone: editing.availabilityZone }
    const exists = list.some((c) => c.name === editing.name)
    const r = exists ? await api.put(`/api/glue/connections/${encodeURIComponent(editing.name)}`, body, 'the connection') : await api.post('/api/glue/connections', body, 'the connection')
    if (!r.ok) { setMsg(r.fault.why); return }
    setEditing(null); setSel(editing.name); void load()
  }
  const del = async (name: string) => { if (!await confirm({ title: `Delete the connection "${name}"?`, danger: true, confirmLabel: 'Delete', body: "Jobs that reference this connection will fail to run until it is recreated." })) return; await api.del(`/api/glue/connections/${encodeURIComponent(name)}`, 'deleting'); setSel(null); void load() }
  const test = async (name: string) => { const r = await api.post<{ note: string }>(`/api/glue/connections/${encodeURIComponent(name)}/test`, {}, 'the test'); setMsg(r.ok ? r.value.note : r.fault.why) }
  const props = editing?.properties ?? {}
  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <div className="panel" style={{ width: 280, flex: 'none' }}>
        <div className="panel-head"><span className="eyebrow">Connections</span><span className="fill" />
          <button className="quiet" onClick={() => { setEditing({ name: '', type: 'JDBC', properties: {} }); setSel(null) }}><Icon name="plus" size={12} /></button>
          <button className="quiet" onClick={() => void load()}><Icon name="refresh" size={12} /></button></div>
        <div className="fill" style={{ overflow: 'auto' }}>
          {list.length === 0 && <div className="faint small" style={{ padding: 12 }}>None in this region.</div>}
          {list.map((c) => (
            <div key={c.name} className={'panel-row' + (c.name === sel ? ' on' : '')} style={{ height: 'auto', padding: '6px 12px' }} onClick={() => { setSel(c.name); setEditing(null); setMsg(null) }}>
              <Icon name={c.type === 'KAFKA' ? 'stream' : c.type === 'NETWORK' ? 'link' : 'database'} size={14} style={{ color: 'var(--dim)' }} />
              <div className="col fill" style={{ gap: 1 }}><span>{c.name}</span><span className="faint" style={{ fontSize: 10 }}>{c.type}</span></div>
            </div>))}
        </div>
      </div>
      <div className="fill details" style={{ overflow: 'auto' }}>
        {msg && <div className="card" style={{ padding: '8px 12px', marginBottom: 10 }}><span className="small">{msg}</span></div>}
        {editing ? (
          <>
            <h2 style={{ marginTop: 0 }}>{list.some((c) => c.name === editing.name) ? 'Edit connection' : 'New connection'}</h2>
            <div className="grid">
              <label>Name<input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} disabled={list.some((c) => c.name === editing.name)} /></label>
              <label>Type<select value={editing.type ?? 'JDBC'} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label style={{ gridColumn: '1 / -1' }}>Description<input value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
              <label>VPC subnet<input className="mono" value={editing.subnetId ?? ''} onChange={(e) => setEditing({ ...editing, subnetId: e.target.value })} placeholder="subnet-…" /></label>
              <label>Security groups<input className="mono" value={(editing.securityGroups ?? []).join(', ')} onChange={(e) => setEditing({ ...editing, securityGroups: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="sg-…, sg-…" /></label>
            </div>
            <h2>Properties</h2>
            <div className="kv">
              {Object.entries(props).map(([k, v]) => (<>
                <input key={k + 'k'} className="mono" defaultValue={k} onBlur={(e) => { const n = { ...props }; delete n[k]; if (e.target.value) n[e.target.value] = v; setEditing({ ...editing, properties: n }) }} />
                <input key={k + 'v'} className="mono" defaultValue={v} type={/PASSWORD|SECRET/.test(k) ? 'password' : 'text'} onBlur={(e) => setEditing({ ...editing, properties: { ...props, [k]: e.target.value } })} />
                <button key={k + 'x'} className="quiet" onClick={() => { const n = { ...props }; delete n[k]; setEditing({ ...editing, properties: n }) }}><Icon name="x" size={12} /></button>
              </>))}
              <div className="row" style={{ gridColumn: '1 / -1' }}>
                <select value="" onChange={(e) => { if (e.target.value) setEditing({ ...editing, properties: { ...props, [e.target.value]: '' } }) }}>
                  <option value="">+ property…</option>
                  {(COMMON[editing.type ?? 'JDBC'] ?? []).filter((k) => !(k in props)).map((k) => <option key={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div className="row" style={{ marginTop: 14 }}><span className="fill" /><button onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={() => void save()}>Save connection</button></div>
          </>
        ) : cur ? (
          <>
            <div className="row" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>{cur.name}</h2><span className="pill">{cur.type}</span><span className="fill" />
              <button onClick={() => void test(cur.name)}><Icon name="activity" />Test</button>
              <button onClick={() => setEditing({ ...cur, properties: { ...cur.properties } })}><Icon name="edit" />Edit</button>
              <button className="quiet danger" onClick={() => void del(cur.name)}><Icon name="trash" /></button></div>
            {cur.description && <p className="dim">{cur.description}</p>}
            <div className="facts" style={{ padding: 0 }}>
              {cur.status && <div className="fact"><span className="eyebrow">Status</span><span className="v">{cur.status}</span></div>}
              <div className="fact"><span className="eyebrow">Created</span><span className="v">{when(cur.createdOn)}</span></div>
              <div className="fact"><span className="eyebrow">Updated</span><span className="v">{when(cur.lastUpdated)}</span></div>
              {cur.subnetId && <div className="fact"><span className="eyebrow">Subnet</span><span className="v">{cur.subnetId}</span></div>}
              {cur.availabilityZone && <div className="fact"><span className="eyebrow">AZ</span><span className="v">{cur.availabilityZone}</span></div>}
            </div>
            {cur.statusReason && <p style={{ color: 'var(--warn)' }}>{cur.statusReason}</p>}
            <h2>Properties</h2>
            <table className="mono small" style={{ borderCollapse: 'collapse' }}><tbody>
              {Object.entries(cur.properties).map(([k, v]) => <tr key={k}><td className="dim" style={{ paddingRight: 16, verticalAlign: 'top' }}>{k}</td><td style={{ wordBreak: 'break-all' }}>{v}</td></tr>)}
            </tbody></table>
            {cur.securityGroups?.length ? <p className="dim small">Security groups: {cur.securityGroups.join(', ')}</p> : null}
          </>
        ) : <EmptyState title="Pick a connection">Or create one. A job attaches connections on its Job details tab; a session takes them too.</EmptyState>}
      </div>
    </div>
  )
}

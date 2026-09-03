import { useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/stores/glue'
import { api, type Fault } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { Sheet } from '@/shell/Sheet'
import { confirm } from '@/shell/Confirm'
import { tell } from '@/shell/Toast'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useSurfaceReason } from '@/shell/useSurfaceReason'
import { when } from '@/shell/format'

export type Conn = {
  name: string; type: string; description?: string; status?: string; statusReason?: string
  createdOn?: string; lastUpdated?: string; properties: Record<string, string>
  subnetId?: string; securityGroups?: string[]; availabilityZone?: string; matchCriteria?: string[]
}

type Prop = { key: string; label: string; help?: string; secret?: boolean; bool?: boolean; placeholder?: string }

/**
 * The properties each connection type actually wants, as a form.
 *
 * Every type used to share one key/value bag with a "+ property…" dropdown, so the single most
 * important field — the JDBC URL — was a row in a grid of anonymous strings, and you had to know
 * the property names by heart.
 */
const FORMS: Record<string, Prop[]> = {
  JDBC: [
    { key: 'JDBC_CONNECTION_URL', label: 'JDBC URL', placeholder: 'jdbc:postgresql://host:5432/database' },
    { key: 'SECRET_ID', label: 'Secrets Manager secret', help: 'Preferred over a username and password stored here' },
    { key: 'USERNAME', label: 'Username' },
    { key: 'PASSWORD', label: 'Password', secret: true },
    { key: 'JDBC_ENFORCE_SSL', label: 'Enforce SSL', bool: true },
    { key: 'CUSTOM_JDBC_CERT', label: 'Custom certificate (S3)' },
  ],
  KAFKA: [
    { key: 'KAFKA_BOOTSTRAP_SERVERS', label: 'Bootstrap servers', placeholder: 'b-1.cluster:9094,b-2.cluster:9094' },
    { key: 'KAFKA_SSL_ENABLED', label: 'SSL', bool: true },
    { key: 'KAFKA_CUSTOM_CERT', label: 'Custom certificate (S3)' },
    { key: 'KAFKA_SASL_MECHANISM', label: 'SASL mechanism' },
    { key: 'KAFKA_SASL_SCRAM_SECRET_ID', label: 'SASL secret' },
  ],
  MONGODB: [
    { key: 'CONNECTION_URL', label: 'Connection URL', placeholder: 'mongodb://host:27017' },
    { key: 'SECRET_ID', label: 'Secrets Manager secret' },
    { key: 'USERNAME', label: 'Username' },
    { key: 'PASSWORD', label: 'Password', secret: true },
  ],
  SNOWFLAKE: [
    { key: 'HOST', label: 'Account host', placeholder: 'xy12345.eu-west-1.snowflakecomputing.com' },
    { key: 'WAREHOUSE', label: 'Warehouse' },
    { key: 'SECRET_ID', label: 'Secrets Manager secret' },
    { key: 'ROLE_ARN', label: 'Role ARN' },
  ],
  REDSHIFT: [
    { key: 'JDBC_CONNECTION_URL', label: 'JDBC URL', placeholder: 'jdbc:redshift://cluster:5439/dev' },
    { key: 'SECRET_ID', label: 'Secrets Manager secret' },
  ],
  NETWORK: [],
}
const isSecret = (k: string) => /PASSWORD|SECRET|TOKEN|CREDENTIAL/i.test(k)
const icon = (t: string) => (t === 'KAFKA' ? 'stream' : t === 'NETWORK' ? 'link' : t === 'MONGODB' ? 'database' : 'database')

/** Where a connection points, whatever the type calls that property. */
function endpoint(c: Conn): string | null {
  const p = c.properties ?? {}
  const raw = p.JDBC_CONNECTION_URL ?? p.CONNECTION_URL ?? p.KAFKA_BOOTSTRAP_SERVERS ?? p.HOST ?? null
  return raw || null
}
/** A secret id, or an inline password — the difference matters and should be visible. */
function auth(c: Conn): { label: string; tone: 'ok' | 'warn' | '' } {
  const p = c.properties ?? {}
  if (p.SECRET_ID || p.KAFKA_SASL_SCRAM_SECRET_ID) return { label: 'Secrets Manager', tone: 'ok' }
  if (p.PASSWORD) return { label: 'password stored on the connection', tone: 'warn' }
  return { label: 'none', tone: '' }
}

/** The Glue console's Connections page: what a job attaches to, created, edited, tested, deleted. */
export function Connections() {
  const account = useAccount()
  const [list, setList] = useState<Conn[] | null>(null)
  const [types, setTypes] = useState<string[]>([])
  const [fault, setFault] = useState<Fault | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<Conn> | null>(null)
  const [q, setQ] = useState('')
  const [tested, setTested] = useState<Record<string, { ok: boolean; note: string }>>({})

  const load = async () => {
    const r = await api.get<Conn[]>('/api/glue/connections/full', 'the connections')
    if (r.ok) { setList(r.value); setFault(null) } else setFault(r.fault)
  }
  useEffect(() => { void load(); void api.get<string[]>('/api/glue/connections/types', 'connection types').then((r) => { if (r.ok) setTypes(r.value) }) }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  const reason = useSurfaceReason('connections')
  if (reason) return reason
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading connections…" />

  const shown = q ? list.filter((c) => (c.name + ' ' + c.type).toLowerCase().includes(q.toLowerCase())) : list
  const cur = list.find((c) => c.name === sel)
  const del = async (name: string) => {
    if (!await confirm({ title: `Delete the connection "${name}"?`, danger: true, confirmLabel: 'Delete',
      body: 'Any job or session that names this connection will fail to run until it is recreated. Glue does not tell you which those are, so check before you delete.' })) return
    await tell('delete the connection', api.del(`/api/glue/connections/${encodeURIComponent(name)}`, 'deleting'), 'Connection deleted')
    setSel(null); void load()
  }
  const test = async (name: string) => {
    const r = await api.post<{ note: string }>(`/api/glue/connections/${encodeURIComponent(name)}/test`, {}, 'the test', 3 * 60_000)
    setTested({ ...tested, [name]: { ok: r.ok, note: r.ok ? r.value.note : `${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}` } })
  }

  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <div className="panel" style={{ width: 272, flex: 'none' }}>
        <div className="panel-head">
          <span className="eyebrow">Connections</span><span className="fill" />
          <button className="quiet" aria-label="Refresh" onClick={() => void load()}><Icon name="refresh" size={12} /></button>
        </div>
        <div style={{ padding: 'var(--s2) var(--s3)' }}>
          <button className="primary" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => { setEditing({ name: '', type: 'JDBC', properties: {} }); setSel(null) }}><Icon name="plus" />New connection</button>
          {list.length > 6 && <input style={{ width: '100%', marginTop: 'var(--s2)' }} placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter connections" />}
        </div>
        <div className="fill" style={{ overflow: 'auto', paddingBottom: 'var(--s2)' }}>
          {list.length === 0 && <div className="faint small" style={{ padding: 'var(--s3)' }}>None in this region.</div>}
          {list.length > 0 && shown.length === 0 && <div className="faint small" style={{ padding: 'var(--s3)' }}>Nothing matches “{q}”.</div>}
          {shown.map((c) => (
            <button key={c.name} className={'sess-row' + (c.name === sel ? ' on' : '')} onClick={() => setSel(c.name)} title={c.name}>
              <Icon name={icon(c.type)} size={15} style={{ color: 'var(--faint)' }} />
              <span className="col fill" style={{ gap: 2, minWidth: 0, alignItems: 'flex-start' }}>
                <span className="sess-name">{c.name}</span>
                <span className="faint micro">{c.type}{c.subnetId ? ' · VPC' : ''}</span>
              </span>
              {tested[c.name] && <span className={'dot'} style={{ color: tested[c.name]!.ok ? 'var(--add)' : 'var(--del)' }} />}
            </button>))}
        </div>
      </div>

      <div className="fill" style={{ minWidth: 0 }}>
        {cur
          ? <Detail c={cur} result={tested[cur.name]} onTest={() => void test(cur.name)} onEdit={() => setEditing({ ...cur, properties: { ...cur.properties } })} onDelete={() => void del(cur.name)} />
          : (
            <EmptyState title={list.length ? 'Pick a connection' : 'No connections in this region'}
              actions={<button className="primary" onClick={() => { setEditing({ name: '', type: 'JDBC', properties: {} }); setSel(null) }}><Icon name="plus" />New connection</button>}>
              A connection is how a job reaches something that is not public S3 — a database over JDBC,
              a Kafka cluster, or anything inside a VPC. A job attaches them under Job details; an
              interactive session takes them too.
            </EmptyState>)}
      </div>

      {editing && (
        <Editor conn={editing} types={types} exists={list.some((c) => c.name === editing.name)}
          onClose={() => setEditing(null)}
          onSaved={(name) => { setEditing(null); setSel(name); void load() }} />)}
    </div>
  )
}

function Detail({ c, result, onTest, onEdit, onDelete }: { c: Conn; result?: { ok: boolean; note: string }; onTest: () => void; onEdit: () => void; onDelete: () => void }) {
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const a = auth(c)
  const at = endpoint(c)
  const props = Object.entries(c.properties ?? {})
  const known = new Set((FORMS[c.type] ?? []).map((p) => p.key))
  const run = async () => { setBusy(true); await onTest(); setBusy(false) }
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="toolbar">
        <div className="subject"><span className="name">{c.name}</span><span className="pill">{c.type}</span>
          {c.status && <span className={'pill ' + (c.status === 'READY' ? 'ok' : c.status === 'FAILED' ? 'err' : 'warn')}>{c.status.toLowerCase()}</span>}
        </div>
        <span className="fill" />
        <button disabled={busy} onClick={() => void run()}><Icon name={busy ? 'spinner' : 'activity'} className={busy ? 'spin' : ''} />{busy ? 'Testing…' : 'Test'}</button>
        <button onClick={onEdit}><Icon name="edit" />Edit</button>
        <button className="quiet danger" aria-label={`Delete ${c.name}`} onClick={onDelete}><Icon name="trash" /></button>
      </div>

      <div className="fill details" style={{ overflow: 'auto', paddingTop: 'var(--s4)' }}>
        {result && (
          <div className={'insp-finding ' + (result.ok ? '' : 'warn')} style={{ marginBottom: 'var(--s4)' }}>
            <Icon name={result.ok ? 'ok' : 'warn'} size={13} />
            <span className="fill">{result.note}</span>
          </div>)}
        {c.description && <p className="dim" style={{ marginTop: 0 }}>{c.description}</p>}
        {c.statusReason && <div className="insp-finding warn" style={{ marginBottom: 'var(--s4)' }}><Icon name="warn" size={13} /><span className="fill">{c.statusReason}</span></div>}

        <div className="stats" style={{ padding: '0 0 var(--s4)' }}>
          {at && <div className="stat" style={{ maxWidth: 340 }}><span className="k">Points at</span><span className="v" title={at} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{at}</span></div>}
          <div className="stat"><span className="k">Credentials</span><span className="v" style={{ fontSize: 'var(--small)', color: a.tone === 'warn' ? 'var(--warn)' : undefined }}>{a.label}</span></div>
          <div className="stat"><span className="k">Network</span><span className="v" style={{ fontSize: 'var(--small)' }}>{c.subnetId ? 'in a VPC' : 'public'}</span></div>
          <div className="stat"><span className="k">Updated</span><span className="v" style={{ fontSize: 'var(--small)' }}>{when(c.lastUpdated ?? c.createdOn)}</span></div>
        </div>

        {(c.subnetId || c.securityGroups?.length) && (<>
          <h3>Network</h3>
          <div className="grid" style={{ marginBottom: 'var(--s5)' }}>
            <div className="fact"><span className="eyebrow">Subnet</span><span className="v">{c.subnetId ?? '—'}</span></div>
            <div className="fact"><span className="eyebrow">Availability zone</span><span className="v">{c.availabilityZone ?? '—'}</span></div>
            <div className="fact" style={{ gridColumn: '1 / -1' }}><span className="eyebrow">Security groups</span><span className="v">{c.securityGroups?.join(', ') || '—'}</span></div>
          </div>
        </>)}

        <div className="row" style={{ marginBottom: 'var(--s2)' }}>
          <h3 style={{ margin: 0 }}>Properties</h3>
          <span className="fill" />
          {props.some(([k]) => isSecret(k)) && (
            <button className="quiet micro" onClick={() => setReveal(!reveal)}>
              <Icon name={reveal ? 'x' : 'preview'} size={12} />{reveal ? 'Hide' : 'Reveal'} secrets
            </button>)}
        </div>
        {props.length === 0
          ? <p className="faint small">None. A NETWORK connection carries only its VPC placement.</p>
          : (
            <table className="conn-props"><tbody>
              {props.sort(([a1], [b1]) => Number(known.has(b1)) - Number(known.has(a1)) || a1.localeCompare(b1)).map(([k, v]) => (
                <tr key={k}>
                  <td className="mono dim">{k}</td>
                  {/* the old page printed PASSWORD and SECRET_ID straight onto the screen */}
                  <td className="mono">{isSecret(k) && !reveal ? <span className="faint">••••••••</span> : v}</td>
                </tr>))}
            </tbody></table>)}
      </div>
    </div>
  )
}

function Editor({ conn, types, exists, onClose, onSaved }: {
  conn: Partial<Conn>; types: string[]; exists: boolean; onClose: () => void; onSaved: (name: string) => void
}) {
  const [c, setC] = useState<Partial<Conn>>(conn)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [extra, setExtra] = useState('')
  const props = c.properties ?? {}
  const form = FORMS[c.type ?? 'JDBC'] ?? []
  const known = useMemo(() => new Set(form.map((p) => p.key)), [form])
  const others = Object.entries(props).filter(([k]) => !known.has(k))
  const setProp = (k: string, v: string | undefined) => {
    const next = { ...props }
    if (v === undefined || v === '') delete next[k]; else next[k] = v
    setC({ ...c, properties: next })
  }
  const save = async () => {
    if (!c.name?.trim()) { setErr('A connection needs a name.'); return }
    setBusy(true); setErr(null)
    const body = { name: c.name, type: c.type ?? 'JDBC', description: c.description, properties: props, subnetId: c.subnetId, securityGroups: c.securityGroups, availabilityZone: c.availabilityZone }
    const r = exists
      ? await api.put(`/api/glue/connections/${encodeURIComponent(c.name)}`, body, 'the connection')
      : await api.post('/api/glue/connections', body, 'the connection')
    setBusy(false)
    if (!r.ok) { setErr(`${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}`); return }
    onSaved(c.name)
  }
  return (
    <Sheet label={exists ? `Edit ${c.name}` : 'New connection'} width={620} onClose={onClose} dirty={!exists && !!c.name}>
      <h2>{exists ? `Edit ${c.name}` : 'New connection'}</h2>
      <div className="form" style={{ marginTop: 'var(--s3)' }}>
        <label>Name<input value={c.name ?? ''} disabled={exists} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="my-warehouse" /></label>
        <label>Type<select value={c.type ?? 'JDBC'} onChange={(e) => setC({ ...c, type: e.target.value })}>{(types.length ? types : Object.keys(FORMS)).map((t) => <option key={t}>{t}</option>)}</select></label>
        <label style={{ gridColumn: '1 / -1' }}>Description<input value={c.description ?? ''} onChange={(e) => setC({ ...c, description: e.target.value })} /></label>
      </div>

      {form.length > 0 && (<>
        <span className="eyebrow">{c.type} settings</span>
        <div className="form" style={{ marginTop: 6 }}>
          {form.map((p) => (
            <label key={p.key} style={p.bool ? undefined : { gridColumn: p.key.includes('URL') || p.key.includes('SERVERS') ? '1 / -1' : undefined }}>
              {p.label}
              {p.bool
                ? <span className="row" style={{ gap: 6, color: 'var(--text)' }}>
                    <input type="checkbox" checked={props[p.key] === 'true'} onChange={(e) => setProp(p.key, e.target.checked ? 'true' : undefined)} />
                    <span className="small">{props[p.key] === 'true' ? 'on' : 'off'}</span>
                  </span>
                : <input className="mono" type={p.secret ? 'password' : 'text'} value={props[p.key] ?? ''} placeholder={p.placeholder}
                    onChange={(e) => setProp(p.key, e.target.value)} />}
              {p.help && <span className="faint micro">{p.help}</span>}
            </label>))}
        </div>
      </>)}

      <span className="eyebrow" style={{ display: 'block', marginTop: 'var(--s4)' }}>Network</span>
      <div className="form" style={{ marginTop: 6 }}>
        <label>VPC subnet<input className="mono" value={c.subnetId ?? ''} onChange={(e) => setC({ ...c, subnetId: e.target.value || undefined })} placeholder="subnet-…" /></label>
        <label>Security groups<input className="mono" value={(c.securityGroups ?? []).join(', ')} onChange={(e) => setC({ ...c, securityGroups: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="sg-…, sg-…" /></label>
      </div>
      <span className="faint micro">A job only reaches a private database if the connection is placed in a subnet that can route to it.</span>

      <span className="eyebrow" style={{ display: 'block', marginTop: 'var(--s4)' }}>Other properties</span>
      <div className="kv" style={{ marginTop: 6 }}>
        {others.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <input className="mono" defaultValue={k} onBlur={(e) => { if (e.target.value !== k) { const n = { ...props }; delete n[k]; if (e.target.value) n[e.target.value] = v; setC({ ...c, properties: n }) } }} />
            <input className="mono" type={isSecret(k) ? 'password' : 'text'} defaultValue={v} onBlur={(e) => setProp(k, e.target.value)} />
            <button className="quiet" aria-label={`Remove ${k}`} onClick={() => setProp(k, undefined)}><Icon name="x" size={12} /></button>
          </div>))}
        <div className="row" style={{ gridColumn: '1 / -1' }}>
          <input className="mono fill" placeholder="PROPERTY_NAME" value={extra} onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && extra.trim()) { setProp(extra.trim(), ' '); setExtra('') } }} aria-label="Add a property" />
          <button className="quiet" disabled={!extra.trim()} onClick={() => { setProp(extra.trim(), ' '); setExtra('') }}><Icon name="plus" size={12} />add</button>
        </div>
      </div>

      {err && <div className="small" role="alert" style={{ color: 'var(--del)', marginTop: 'var(--s3)' }}>{err}</div>}
      <div className="row" style={{ marginTop: 'var(--s4)', justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !c.name?.trim()} onClick={() => void save()}>{busy ? 'Saving…' : exists ? 'Save changes' : 'Create connection'}</button>
      </div>
    </Sheet>
  )
}

import { useEffect, useState } from 'react'
import { useDag } from './store'
import { Inspector } from './Inspector'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { label } from './schema'

type Col = { Name: string; Type?: string }
type PreviewResult = { cached: boolean; error?: string; schema?: Col[]; rows?: Record<string, unknown>[]; count?: number; ms?: number }

/** Glue Studio's node panel: Properties · Output schema · Data preview. */
export function NodePanel({ job }: { job: string }) {
  const d = useDag((s) => s.jobs[job])
  const [tab, setTab] = useState<'props' | 'schema' | 'preview'>('props')
  const id = d?.selection.length === 1 ? d.selection[0] : undefined
  const node = id ? d?.nodes.find((n) => n.id === id) : undefined
  if (!d || !node || !id) return <div className="inspector faint" style={{ padding: 14 }}>{d?.selection.length ? `${d.selection.length} nodes selected` : 'Select a node to see its properties, output schema and a data preview.'}</div>
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row subtabs" style={{ padding: '0 10px', height: 34, borderBottom: '1px solid var(--line)', flex: 'none' }}>
        {(['props', 'schema', 'preview'] as const).map((t) => <button key={t} className={'tabbtn' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{t === 'props' ? 'Properties' : t === 'schema' ? 'Output schema' : 'Data preview'}</button>)}
      </div>
      <div className="fill" style={{ overflow: 'auto' }}>
        {tab === 'props' && <Inspector job={job} />}
        {tab === 'schema' && <SchemaPanel job={job} id={id} type={node.type} />}
        {tab === 'preview' && <PreviewPanel job={job} id={id} name={node.name} type={node.type} />}
      </div>
    </div>
  )
}

function SchemaPanel({ job, id, type }: { job: string; id: string; type: string }) {
  const d = useDag((s) => s.jobs[job])!
  const setField = useDag((s) => s.setField)
  const body = d.raw[id]?.[type] ?? {}
  const schemas = (body.OutputSchemas as { Columns?: Col[] }[] | undefined) ?? []
  const cols: Col[] = schemas[0]?.Columns ?? []
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const write = (next: Col[]) => setField(job, id, 'OutputSchemas', next.length ? [{ Columns: next }] : undefined)
  const infer = async () => {
    setBusy(true); setErr(null)
    const r = await api.post<PreviewResult>(`/api/jobs/${encodeURIComponent(job)}/preview/${encodeURIComponent(id)}?rows=5`, {}, 'schema inference')
    setBusy(false)
    if (!r.ok) { setErr(r.fault.why + (r.fault.fix ? ` — ${r.fault.fix}` : '')); return }
    if (r.value.error) { setErr(r.value.error); return }
    if (r.value.schema) write(r.value.schema)
  }
  return (
    <div className="inspector">
      <div className="insp-section row">
        <span className="dim small">{cols.length ? `${cols.length} columns` : 'No schema recorded on this node.'}</span>
        <span className="fill" />
        <button disabled={busy} onClick={() => void infer()} title="Run the node in the Glue container and record the columns it produces"><Icon name={busy ? 'spinner' : 'magic'} className={busy ? 'spin' : ''} />{busy ? 'Inferring…' : 'Infer schema'}</button>
      </div>
      {err && <div className="insp-section" style={{ color: 'var(--del)', whiteSpace: 'pre-wrap' }}>{err}</div>}
      <div className="insp-section">
        <div className="mini-head" style={{ gridTemplateColumns: '1fr 110px 22px' }}><span>column</span><span>type</span><span /></div>
        {cols.map((c, i) => (
          <div key={i} className="mini-row" style={{ gridTemplateColumns: '1fr 110px 22px' }}>
            <input className="mono" defaultValue={c.Name} onBlur={(e) => { if (e.target.value !== c.Name) write(cols.map((x, j) => (j === i ? { ...x, Name: e.target.value } : x))) }} />
            <input className="mono" defaultValue={c.Type ?? 'string'} list="glue-types" onBlur={(e) => { if (e.target.value !== c.Type) write(cols.map((x, j) => (j === i ? { ...x, Type: e.target.value } : x))) }} />
            <button className="quiet" onClick={() => write(cols.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
          </div>))}
        <datalist id="glue-types">{['string', 'int', 'long', 'double', 'float', 'boolean', 'timestamp', 'date', 'decimal(10,2)', 'array<string>', 'struct<>'].map((t) => <option key={t} value={t} />)}</datalist>
        <button className="quiet" style={{ marginTop: 6 }} onClick={() => write([...cols, { Name: `col${cols.length + 1}`, Type: 'string' }])}><Icon name="plus" />column</button>
      </div>
      <div className="insp-section faint small">{label(type)} · the schema is what downstream nodes and the scaffolded tests assume; inferring records what the code actually produces.</div>
    </div>
  )
}

function PreviewPanel({ job, id, name, type }: { job: string; id: string; name: string; type: string }) {
  const rev = useDag((s) => s.jobs[job]?.rev)
  const [res, setRes] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(50)
  useEffect(() => { setRes(null); void api.get<PreviewResult>(`/api/jobs/${encodeURIComponent(job)}/preview/${encodeURIComponent(id)}`, 'the cached preview').then((r) => { if (r.ok && r.value.cached) setRes(r.value) }) }, [job, id, rev])
  const run = async () => {
    setBusy(true)
    const r = await api.post<PreviewResult>(`/api/jobs/${encodeURIComponent(job)}/preview/${encodeURIComponent(id)}?rows=${rows}`, {}, 'the preview')
    setBusy(false)
    setRes(r.ok ? r.value : { cached: false, error: r.fault.why + (r.fault.fix ? ` — ${r.fault.fix}` : '') })
  }
  const stop = () => void api.post(`/api/jobs/${encodeURIComponent(job)}/preview/stop`, {}, 'stopping the preview')
  const cols = res?.schema?.map((c) => c.Name) ?? Object.keys(res?.rows?.[0] ?? {})
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="insp-section row" style={{ flex: 'none' }}>
        <select value={rows} onChange={(e) => setRows(Number(e.target.value))} style={{ width: 90 }}>{[10, 50, 100, 500].map((n) => <option key={n} value={n}>{n} rows</option>)}</select>
        {busy ? <button className="danger" onClick={stop}><Icon name="stop" />Stop</button> : <button className="primary" onClick={() => void run()}><Icon name="preview" />{res ? 'Refresh preview' : 'Preview data'}</button>}
        <span className="fill" />
        {res?.ms != null && <span className="faint fig">{(res.ms / 1000).toFixed(1)}s{type.endsWith('Target') ? ' · input of the target' : ''}</span>}
      </div>
      {busy && <div className="insp-section dim small"><span className="dot live" style={{ color: 'var(--accent)', marginRight: 6 }} />Running <b>{name}</b> and everything upstream in the Glue 5 container against your real data. First run pulls Spark up (~20s).</div>}
      {!busy && !res && <div className="insp-section dim small">Sample the rows this node produces, using the same code that will run in Glue. Reads from S3 with your profile; nothing is written.</div>}
      {res?.error && <pre className="err" style={{ margin: 12 }}>{res.error}</pre>}
      {res?.rows && (
        <div className="fill" style={{ overflow: 'auto' }}>
          <table className="preview">
            <thead><tr>{cols.map((c) => <th key={c}>{c}<span className="faint" style={{ fontWeight: 400, marginLeft: 6 }}>{res.schema?.find((s) => s.Name === c)?.Type}</span></th>)}</tr></thead>
            <tbody>{res.rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{fmt(r[c])}</td>)}</tr>)}</tbody>
          </table>
          {res.rows.length === 0 && <div className="faint small" style={{ padding: 12 }}>No rows.</div>}
        </div>)}
    </div>
  )
}

function fmt(v: unknown): string { if (v == null) return '∅'; if (typeof v === 'object') return JSON.stringify(v); return String(v) }

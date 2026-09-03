import { useEffect, useState } from 'react'
import { useDag } from './store'
import { Inspector } from './Inspector'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { Seg } from '@/shell/Seg'
import { useOps } from '@/shell/Ops'
import { label, carriesSchema } from './schema'
import { LocalData, useSampleStatus } from './Samples'
import { useEngine } from '@/stores/engine'

type Col = { Name: string; Type?: string; Children?: Col[] }
type PreviewResult = { cached: boolean; error?: string; schema?: Col[]; rows?: Record<string, unknown>[]; count?: number; ms?: number; source?: 'local' | 'aws'; engine?: boolean }

/**
 * The node inspector: Properties · Output schema · Local data.
 *
 * Data preview used to be a fourth tab in here, which meant the widest thing in the app — a table
 * of sample rows — was rendered inside a 340px column. It now opens in the pane under the canvas
 * (see AuthoringTab), which is as wide as the canvas is.
 */
export function NodePanel({ job }: { job: string }) {
  const d = useDag((s) => s.jobs[job])
  const [tab, setTab] = useState<'props' | 'schema' | 'local'>('props')
  const id = d?.selection.length === 1 ? d.selection[0] : undefined
  const node = id ? d?.nodes.find((n) => n.id === id) : undefined
  if (!d || !node || !id) return <div className="inspector faint" style={{ padding: 14 }}>{d?.selection.length ? `${d.selection.length} nodes selected` : 'Select a node to see its properties, output schema and a data preview.'}</div>
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="seg-bar">
        <Seg label="Node inspector" value={tab} onChange={setTab}
          options={[['props', 'Properties'], ['schema', 'Schema'], ['local', 'Local data']] as const} />
      </div>
      <div className="fill" style={{ overflow: 'auto' }}>
        {tab === 'props' && <Inspector job={job} />}
        {tab === 'schema' && <SchemaPanel job={job} id={id} type={node.type} />}
        {tab === 'local' && <LocalData job={job} />}
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
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const write = (next: Col[]) => setField(job, id, 'OutputSchemas', next.length ? [{ Columns: next }] : undefined)
  const infer = async () => {
    setBusy(true); setErr(null)
    const r = await api.post<PreviewResult>(`/api/jobs/${encodeURIComponent(job)}/preview/${encodeURIComponent(id)}?rows=5`, {}, 'schema inference', 15 * 60_000)
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
        <div className="mini-head" style={{ gridTemplateColumns: '1fr 110px 22px 22px' }}><span>column</span><span>type</span><span /><span /></div>
        <Rows cols={cols} path={[]} open={open} setOpen={setOpen} write={(next) => write(next)} />
        <datalist id="glue-types">{['string', 'int', 'long', 'double', 'float', 'boolean', 'timestamp', 'date', 'decimal(10,2)', 'array<string>', 'struct<>', 'array<struct<>>', 'map<string,string>'].map((t) => <option key={t} value={t} />)}</datalist>
        <button className="quiet" style={{ marginTop: 6 }} onClick={() => write([...cols, { Name: `col${cols.length + 1}`, Type: 'string' }])}><Icon name="plus" />column</button>
      </div>
      <div className="insp-section faint small">
        {label(type)} · the schema is what downstream nodes and the scaffolded tests assume; inferring records what the code actually produces.
        {!carriesSchema(type) && <> Glue does not accept a schema on this node type, so Keel keeps it locally to fill the column pickers and leaves it out of the deploy.</>}
      </div>
    </div>
  )
}

/** Columns, with `struct`/`array` children expanded in place — Glue's schemas nest. */
function Rows({ cols, path, open, setOpen, write }: { cols: Col[]; path: number[]; open: Record<string, boolean>; setOpen: (o: Record<string, boolean>) => void; write: (cols: Col[]) => void }) {
  const key = (i: number) => [...path, i].join('.')
  const edit = (i: number, patch: Partial<Col>) => write(cols.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  return (
    <>
      {cols.map((c, i) => {
        const nested = /struct|array|map/i.test(c.Type ?? '')
        const kids = c.Children ?? []
        const isOpen = open[key(i)] ?? false
        return (
          <div key={key(i)}>
            <div className="mini-row" style={{ gridTemplateColumns: '1fr 110px 22px 22px', paddingLeft: path.length * 12 }}>
              <span className="row" style={{ gap: 2, minWidth: 0 }}>
                {nested ? <button className="quiet" style={{ padding: 0, width: 14 }} onClick={() => setOpen({ ...open, [key(i)]: !isOpen })}><Icon name="chevron" size={11} style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} /></button> : <span style={{ width: 14 }} />}
                <input className="mono" defaultValue={c.Name} onBlur={(e) => { if (e.target.value !== c.Name) edit(i, { Name: e.target.value }) }} />
              </span>
              <input className="mono" defaultValue={c.Type ?? 'string'} list="glue-types" onBlur={(e) => { if (e.target.value !== c.Type) edit(i, { Type: e.target.value }) }} />
              <button className="quiet" aria-label="Add a child key" title="add a child key" style={{ visibility: nested ? 'visible' : 'hidden' }} onClick={() => { edit(i, { Children: [...kids, { Name: `field${kids.length + 1}`, Type: 'string' }] }); setOpen({ ...open, [key(i)]: true }) }}><Icon name="plus" size={11} /></button>
              <button className="quiet" aria-label={`Remove column ${c.Name}`} onClick={() => write(cols.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
            </div>
            {nested && isOpen && kids.length > 0 && <Rows cols={kids} path={[...path, i]} open={open} setOpen={setOpen} write={(next) => edit(i, { Children: next })} />}
          </div>)
      })}
    </>
  )
}

export function PreviewPanel({ job, id, name, type }: { job: string; id: string; name: string; type: string }) {
  const rev = useDag((s) => s.jobs[job]?.rev)
  const [res, setRes] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(50)
  const [hidden, setHidden] = useState<string[]>([])
  const [picker, setPicker] = useState(false)
  const [source, setSource] = useState<'auto' | 'local' | 'aws'>('auto')
  const { status } = useSampleStatus(job)
  useEffect(() => { setRes(null); void api.get<PreviewResult>(`/api/jobs/${encodeURIComponent(job)}/preview/${encodeURIComponent(id)}`, 'the cached preview').then((r) => { if (r.ok && r.value.cached) setRes(r.value) }) }, [job, id, rev])
  const stop = () => void api.post(`/api/jobs/${encodeURIComponent(job)}/preview/stop`, {}, 'stopping the preview')
  const run = async () => {
    setBusy(true)
    // A first preview pulls a 7 GB image before Spark even starts, so this one gets 15 minutes and a tray row.
    const op = useOps.getState().start(`Preview ${name}`, stop)
    const r = await api.post<PreviewResult>(`/api/jobs/${encodeURIComponent(job)}/preview/${encodeURIComponent(id)}?rows=${rows}&source=${source}`, {}, 'the preview', 15 * 60_000)
    useOps.getState().finish(op)
    setBusy(false)
    setRes(r.ok ? r.value : { cached: false, error: r.fault.why + (r.fault.fix ? ` — ${r.fault.fix}` : '') })
    void useEngine.getState().refresh()
  }
  const allCols = res?.schema?.map((c) => c.Name) ?? Object.keys(res?.rows?.[0] ?? {})
  const cols = allCols.filter((c) => !hidden.includes(c))
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="insp-section row" style={{ flex: 'none' }}>
        <select value={rows} onChange={(e) => setRows(Number(e.target.value))} style={{ width: 90 }}>{[10, 50, 100, 500].map((n) => <option key={n} value={n}>{n} rows</option>)}</select>
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} style={{ width: 130 }}
          title="Where the rows come from. Local reads the samples next to the job; AWS reads the real source with your profile.">
          <option value="auto">local if sampled</option>
          <option value="local">local samples</option>
          <option value="aws">the real source</option>
        </select>
        {busy ? <button className="danger" onClick={stop}><Icon name="stop" />Stop</button> : <button className="primary" onClick={() => void run()}><Icon name="preview" />{res ? 'Refresh preview' : 'Preview data'}</button>}
        <span className="fill" />
        {res?.source && <span className={'pill ' + (res.source === 'local' ? 'ok' : '')} title={res.source === 'local' ? 'read from samples/ — no AWS call' : 'read from the real source with your profile'}>{res.source === 'local' ? 'local' : 'aws'}</span>}
        {res?.ms != null && <span className="faint fig">{(res.ms / 1000).toFixed(1)}s{type.endsWith('Target') ? ' · input of the target' : ''}</span>}
      </div>
      {res?.rows && allCols.length > 0 && (
        <div className="insp-section" style={{ flex: 'none', paddingTop: 6, paddingBottom: 6 }}>
          <button className="quiet" onClick={() => setPicker(!picker)}><Icon name="schema" size={12} />Previewing {cols.length} of {allCols.length} fields</button>
          {picker && (
            <div style={{ maxHeight: 180, overflow: 'auto', marginTop: 6 }}>
              <label className="row" style={{ gap: 6, fontSize: 'var(--micro)', color: 'var(--dim)' }}><input type="checkbox" checked={hidden.length === 0} onChange={(e) => setHidden(e.target.checked ? [] : allCols.slice(1))} />all</label>
              {allCols.map((c) => <label key={c} className="row" style={{ gap: 6, fontSize: 'var(--small)' }}><input type="checkbox" checked={!hidden.includes(c)} onChange={() => setHidden(hidden.includes(c) ? hidden.filter((x) => x !== c) : [...hidden, c])} /><span className="mono">{c}</span></label>)}
            </div>)}
        </div>)}
      {busy && <div className="insp-section dim small"><span className="dot live" style={{ color: 'var(--accent)', marginRight: 6 }} />Running <b>{name}</b> and everything upstream in the Glue 5 container. The first one starts Spark (~20s); after that the engine stays warm and a preview is about a second.</div>}
      {!busy && !res && (
        <div className="insp-section dim small">
          The rows this node produces, from the same code that will run in Glue.
          {status?.ready ? ' Every source has a local sample, so this runs with no AWS at all.' : ' Sources without a sample are read from AWS with your profile; give them a sample under Local data to work offline.'}
        </div>)}
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

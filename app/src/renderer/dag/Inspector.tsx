import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { useDag } from './store'
import { fields, label, maxInputs, template, type Field } from './schema'
import { CATALOG } from './catalog'
import { S3Browser, CatalogPicker } from './Pickers'
import { useCustomTransforms } from './customTransforms'
import { useToast } from '@/shell/Toast'

export function Inspector({ job }: { job: string }) {
  const d = useDag((s) => s.jobs[job])
  const { setField, rename, disconnect, connect } = useDag()
  const id = d?.selection.length === 1 ? d.selection[0] : undefined
  const node = id ? d?.nodes.find((n) => n.id === id) : undefined
  const upstreamCols = (() => { // what the parents say they produce: OutputSchemas on the nearest ancestors that have one
    if (!d || !id) return [] as string[]
    const seen = new Set<string>(); const out: string[] = []
    const walk = (nid: string) => { if (seen.has(nid)) return; seen.add(nid); const n = d.nodes.find((x) => x.id === nid); if (!n) return
      const body = d.raw[nid]?.[n.type] ?? {}; const schemas = body.OutputSchemas as { Columns?: { Name: string }[] }[] | undefined
      if (schemas?.[0]?.Columns?.length) { for (const c of schemas[0].Columns) if (!out.includes(c.Name)) out.push(c.Name); return }
      n.inputs.forEach(walk) }
    const me = d.nodes.find((x) => x.id === id); me?.inputs.forEach(walk)
    return out })()
  if (!d || !node || !id) return <div className="inspector faint" style={{ padding: 12 }}>{d?.selection.length ? `${d.selection.length} nodes selected` : 'Select a node to edit it.'}</div>
  const body = d.raw[id]?.[node.type] ?? {}
  const schema = fields(node.type)
  const changeType = (t: string) => { // keep name, parents and schema; the rest starts from the template
    if (t === node.type) return
    const next = { ...template(t, node.name), Name: node.name } as Record<string, unknown>
    if (body.Inputs) next.Inputs = body.Inputs; if (body.OutputSchemas) next.OutputSchemas = body.OutputSchemas
    useDag.getState().replaceNode(job, id, t, next)
  }
  return (
    <div className="inspector">
      <div className="insp-section">
        <label>Name<Text value={node.name} onCommit={(v) => rename(job, id, v)} /></label>
        <label style={{ marginTop: 8 }}>Node type
          <select value={node.type} onChange={(e) => changeType(e.target.value)}>
            {CATALOG.map((f) => <optgroup key={f.title} label={f.title}>{f.types.map(([t, n]) => <option key={t} value={t}>{n}</option>)}</optgroup>)}
          </select>
        </label>
        <div className="row" style={{ marginTop: 6 }}><span className={`pill ${node.category}`}>{node.category}</span><span className="faint mono">{id}</span></div>
      </div>
      {node.category !== 'source' && (
        <div className="insp-section">
          <div className="insp-label">Node parents <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>· {maxInputs(node.type) === 8 ? 'many' : maxInputs(node.type)} max</span></div>
          {node.inputs.map((i) => { const n = d.nodes.find((x) => x.id === i); return (
            <div key={i} className="row" style={{ fontSize: 12, marginBottom: 2 }}><span className="fill">{n?.name ?? i}</span><button className="quiet" onClick={() => disconnect(job, i, id)} title="disconnect">✕</button></div>) })}
          {node.inputs.length < maxInputs(node.type) && (
            <select value="" onChange={(e) => { if (e.target.value) { const why = connect(job, e.target.value, id); if (why) useToast.getState().push({ kind: 'bad', title: 'Cannot connect these nodes', detail: why }) } }}>
              <option value="">+ add parent…</option>
              {d.nodes.filter((n) => n.id !== id && n.category !== 'target' && !node.inputs.includes(n.id)).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>)}
        </div>)}
      {node.type === 'DynamicTransform' && <DynamicParams job={job} id={id} body={body} />}
      {schema && /Catalog/.test(node.type) && (
        <div className="insp-section"><label className="insp-label">Data Catalog table</label>
          <CatalogPicker database={String(body.Database ?? '')} table={String(body.Table ?? '')} onChange={(db, t, cols) => { setField(job, id, 'Database', db); setField(job, id, 'Table', t); if (cols?.length && node.category === 'source') setField(job, id, 'OutputSchemas', [{ Columns: cols }]) }} />
        </div>)}
      {schema ? schema.filter((f) => !(/Catalog/.test(node.type) && (f.key === 'Database' || f.key === 'Table'))).map((f) => <FieldEditor key={f.key} f={f} value={body[f.key]} onCommit={(v) => setField(job, id, f.key, v)} nodes={d.nodes} inputs={node.inputs} columns={upstreamCols} />)
        : <div className="insp-section"><div className="insp-label">Keel has no form for {node.type}; edit the JSON</div></div>}
      <div className="insp-section">
        <details><summary className="faint">JSON</summary>
          <JsonEditor value={body} onCommit={(v) => { for (const k of Object.keys(body)) if (!(k in v)) setField(job, id, k, undefined); for (const [k, val] of Object.entries(v)) setField(job, id, k, val) }} />
        </details>
      </div>
    </div>
  )
}

function Text({ value, onCommit, mono = false, placeholder }: { value: string; onCommit: (v: string) => void; mono?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { if (v !== value) onCommit(v) }
  return <input className={mono ? 'mono' : ''} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}

function Lines({ value, onCommit, help }: { value: string[]; onCommit: (v: string[]) => void; help?: string }) {
  const [v, setV] = useState(value.join('\n'))
  useEffect(() => setV(value.join('\n')), [value])
  return <textarea className="mono" rows={Math.min(8, Math.max(2, v.split('\n').length))} value={v} placeholder={help} onChange={(e) => setV(e.target.value)}
    onBlur={() => { const next = v.split('\n').map((s) => s.trim()).filter(Boolean); if (JSON.stringify(next) !== JSON.stringify(value)) onCommit(next) }} />
}

function FieldEditor({ f, value, onCommit, nodes, inputs, columns }: { f: Field; value: unknown; onCommit: (v: unknown) => void; nodes: { id: string; name: string }[]; inputs: string[]; columns: string[] }) {
  const [browse, setBrowse] = useState(false)
  const s3 = f.key === 'Paths' || f.key === 'Path'
  let control: React.ReactNode
  switch (f.kind) {
    case 'string': control = <Text value={String(value ?? '')} onCommit={(v) => onCommit(v)} />; break
    case 'int': case 'number': control = <Text value={value == null ? '' : String(value)} onCommit={(v) => onCommit(v === '' ? undefined : Number(v))} />; break
    case 'columnPick': control = <ColumnPick value={Array.isArray(value) ? (value as unknown[]).map((p) => Array.isArray(p) ? p.join('.') : String(p)) : []} columns={columns} onCommit={(v) => onCommit(v.map((s) => s.split('.')))} />; break
    case 'nullChecks': { const v = (value ?? {}) as { IsEmpty?: boolean; IsNullString?: boolean; IsNegOne?: boolean }
      control = <div className="col" style={{ gap: 4 }}>{([['IsEmpty', 'Empty string'], ['IsNullString', 'The string "null"'], ['IsNegOne', 'The integer -1']] as const).map(([k, l]) => <label key={k} className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--text)', textTransform: 'none', letterSpacing: 0, fontSize: 12 }}><input type="checkbox" checked={!!v[k]} onChange={(e) => onCommit({ ...v, [k]: e.target.checked })} />{l}</label>)}</div>; break }
    case 'dqRuleset': control = <textarea className="mono" rows={8} defaultValue={String(value ?? '')} placeholder={'Rules = [\n    RowCount > 0,\n    IsComplete "id",\n    IsUnique "id"\n]'} onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value) }} />; break
    case 'bool': control = <input type="checkbox" checked={!!value} onChange={(e) => onCommit(e.target.checked)} />; break
    case 'enum': control = <select value={String(value ?? f.options?.[0] ?? '')} onChange={(e) => onCommit(e.target.value)}>{(f.options ?? []).map((o) => <option key={o} value={o}>{o || '(none)'}</option>)}</select>; break
    case 'stringList': control = <Lines value={Array.isArray(value) ? (value as string[]) : []} onCommit={(v) => onCommit(v)} help="one per line" />; break
    case 'pathList': control = <Lines value={Array.isArray(value) ? (value as unknown[]).map((p) => Array.isArray(p) ? p.join('.') : String(p)) : []} onCommit={(v) => onCommit(v.map((s) => s.split('.')))} help={f.help} />; break
    case 'sql': control = <textarea className="mono" rows={6} defaultValue={String(value ?? '')} onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value) }} />; break
    case 'code': control = <CodeMirror value={String(value ?? '')} height="220px" extensions={[python()]} theme={cmTheme()} basicSetup={{ lineNumbers: true, foldGutter: false }} onBlur={undefined} onChange={undefined}
      onCreateEditor={(view) => { view.dom.addEventListener('blur', () => { const v = view.state.doc.toString(); if (v !== value) onCommit(v) }, true) }} />; break
    case 'mappingTable': control = <MappingTable value={Array.isArray(value) ? (value as Mapping[]) : []} onCommit={onCommit} />; break
    case 'filterExprs': control = <FilterRows value={Array.isArray(value) ? (value as FilterRow[]) : []} onCommit={onCommit} />; break
    case 'joinCols': control = <JoinCols value={Array.isArray(value) ? (value as JoinCol[]) : []} onCommit={onCommit} inputs={inputs} nodes={nodes} />; break
    default: control = <JsonEditor value={value ?? null} onCommit={onCommit} />
  }
  return (
    <div className="insp-section">
      <div className="row" style={{ marginBottom: 6 }}><label className="insp-label" style={{ margin: 0 }}>{f.label}</label><span className="fill" />{s3 && <button className="quiet" style={{ padding: '0 6px', height: 20 }} onClick={() => setBrowse(true)}>Browse S3…</button>}</div>
      {control}
      {browse && <S3Browser initial={f.key === 'Paths' ? (Array.isArray(value) ? String((value as string[])[0] ?? '') : '') : String(value ?? '')} onClose={() => setBrowse(false)}
        onPick={(uri) => { setBrowse(false); onCommit(f.key === 'Paths' ? [...(Array.isArray(value) ? (value as string[]) : []).filter((p) => p !== uri), uri] : uri) }} />}
    </div>)
}

type Mapping = { ToKey?: string; FromPath?: string[]; FromType?: string; ToType?: string; Dropped?: boolean }
const TYPES = ['string', 'int', 'long', 'double', 'float', 'boolean', 'timestamp', 'date', 'decimal', 'binary']
function MappingTable({ value, onCommit }: { value: Mapping[]; onCommit: (v: Mapping[]) => void }) {
  const set = (i: number, m: Partial<Mapping>) => { const next = value.map((r, j) => (j === i ? { ...r, ...m } : r)); onCommit(next) }
  return (
    <div className="mini-table">
      <div className="mini-head" style={{ gridTemplateColumns: '1fr 62px 1fr 62px 18px 22px' }}><span>source key</span><span>type</span><span>target key</span><span>type</span><span title="drop">drop</span><span /></div>
      {value.map((m, i) => (
        <div key={i} className="mini-row" style={{ gridTemplateColumns: '1fr 62px 1fr 62px 18px 22px', opacity: m.Dropped ? .55 : 1 }}>
          <Text mono value={(m.FromPath ?? []).join('.')} onCommit={(v) => set(i, { FromPath: v.split('.') })} />
          <input className="mono" list="glue-map-types" defaultValue={m.FromType ?? 'string'} onBlur={(e) => { if (e.target.value !== m.FromType) set(i, { FromType: e.target.value }) }} />
          <Text mono value={m.ToKey ?? ''} onCommit={(v) => set(i, { ToKey: v })} />
          <input className="mono" list="glue-map-types" defaultValue={m.ToType ?? 'string'} onBlur={(e) => { if (e.target.value !== m.ToType) set(i, { ToType: e.target.value }) }} />
          <input type="checkbox" checked={!!m.Dropped} onChange={(e) => set(i, { Dropped: e.target.checked })} title="drop this field" />
          <button className="quiet" onClick={() => onCommit(value.filter((_, j) => j !== i))}>✕</button>
        </div>))}
      <datalist id="glue-map-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      <button className="quiet" onClick={() => onCommit([...value, { ToKey: '', FromPath: [''], FromType: 'string', ToType: 'string' }])}>+ mapping</button>
    </div>
  )
}

type FilterRow = { Operation?: string; Negated?: boolean; Values?: { Type: string; Value: string[] }[] }
const OPS = ['EQ', 'NE', 'LT', 'GT', 'LTE', 'GTE', 'REGEX', 'ISNULL', 'NOT_NULL', 'IN', 'BETWEEN', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'LIKE', 'ILIKE', 'ZERO_LENGTH']
function FilterRows({ value, onCommit }: { value: FilterRow[]; onCommit: (v: FilterRow[]) => void }) {
  const set = (i: number, r: Partial<FilterRow>) => onCommit(value.map((x, j) => (j === i ? { ...x, ...r } : x)))
  return (
    <div className="mini-table">
      <div className="mini-head"><span>column</span><span>op</span><span>value</span><span>not</span><span /></div>
      {value.map((r, i) => {
        const col = r.Values?.[0]?.Value?.[0] ?? ''; const val = r.Values?.[1]?.Value?.[0] ?? ''
        const withVals = (c: string, v: string) => ({ Values: [{ Type: 'COLUMNEXTRACTED', Value: [c] }, ...(v !== '' ? [{ Type: 'CONSTANT', Value: [v] }] : [])] })
        return (
          <div key={i} className="mini-row">
            <Text mono value={col} onCommit={(v) => set(i, withVals(v, val))} />
            <select value={r.Operation ?? 'EQ'} onChange={(e) => set(i, { Operation: e.target.value })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
            <Text mono value={val} onCommit={(v) => set(i, withVals(col, v))} />
            <input type="checkbox" checked={!!r.Negated} onChange={(e) => set(i, { Negated: e.target.checked })} />
            <button className="quiet" onClick={() => onCommit(value.filter((_, j) => j !== i))}>✕</button>
          </div>) })}
      <button className="quiet" onClick={() => onCommit([...value, { Operation: 'EQ', Negated: false, Values: [{ Type: 'COLUMNEXTRACTED', Value: [''] }, { Type: 'CONSTANT', Value: [''] }] }])}>+ condition</button>
    </div>
  )
}

type JoinCol = { From?: string; Keys?: string[][] }
function JoinCols({ value, onCommit, inputs, nodes }: { value: JoinCol[]; onCommit: (v: JoinCol[]) => void; inputs: string[]; nodes: { id: string; name: string }[] }) {
  const rows = inputs.map((from) => value.find((v) => v.From === from) ?? { From: from, Keys: [] })
  const set = (from: string, keys: string[]) => onCommit(inputs.map((f) => ({ From: f, Keys: f === from ? keys.map((k) => k.split('.')) : (rows.find((r) => r.From === f)?.Keys ?? []) })))
  if (inputs.length < 2) return <div className="faint">Connect two inputs first.</div>
  return (
    <div className="mini-table">
      {rows.map((r) => (
        <div key={r.From} className="row" style={{ gap: 6 }}>
          <span className="dim" style={{ width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.From}>{nodes.find((n) => n.id === r.From)?.name ?? r.From}</span>
          <Text mono value={(r.Keys ?? []).map((k) => k.join('.')).join(', ')} onCommit={(v) => set(r.From!, v.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="key, key2" />
        </div>))}
    </div>
  )
}

export function JsonEditor({ value, onCommit }: { value: unknown; onCommit: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2))
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setErr(null) }, [value])
  return (
    <div>
      <textarea className="mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row"><button onClick={() => { try { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('must be an object'); setErr(null); onCommit(v as Record<string, unknown>) } catch (e) { setErr((e as Error).message) } }}>Apply</button>{err && <span style={{ color: 'var(--err)', fontSize: 12 }}>{err}</span>}</div>
    </div>
  )
}

/** CodeMirror's theme follows the OS, like the rest of the window. */
export function cmTheme(): 'dark' | 'light' { return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }

/** A custom visual transform's own form, built from the JSON config beside it in the assets bucket. */
function DynamicParams({ job, id, body }: { job: string; id: string; body: Record<string, unknown> }) {
  const custom = useCustomTransforms()
  const setField = useDag((s) => s.setField)
  useEffect(() => { if (!custom.loaded) void custom.load() }, [custom])
  const fn = String(body.FunctionName ?? body.TransformName ?? '')
  const t = custom.list.find((x) => x.functionName === fn || x.name === fn)
  const params = (body.Parameters as { Name: string; Type?: string; Value?: string[]; ListType?: string }[] | undefined) ?? []
  const setParam = (name: string, value: string[], type = 'str') => {
    const next = params.filter((p) => p.Name !== name)
    if (value.length && value.some((v) => v !== '')) next.push({ Name: name, Type: type, Value: value })
    setField(job, id, 'Parameters', next)
  }
  if (!t) return (
    <div className="insp-section">
      <div className="insp-label">Custom transform</div>
      <div className="faint">{fn ? `No config for "${fn}" in the assets bucket; edit the parameters as JSON below.` : 'Set FunctionName and Path to one of the account\'s custom transforms.'}</div>
    </div>)
  return (
    <>
      <div className="insp-section"><div className="insp-label">Custom transform</div><div><b>{t.displayName}</b>{t.description && <div className="faint">{t.description}</div>}</div></div>
      {t.parameters.map((p) => {
        const cur = params.find((x) => x.Name === p.name)?.Value ?? []
        const opts = p.listOptions ?? []
        return (
          <div key={p.name} className="insp-section">
            <label className="insp-label">{p.displayName}{p.isOptional ? '' : ' *'}</label>
            {p.type === 'bool' ? <input type="checkbox" checked={cur[0] === 'true'} onChange={(e) => setParam(p.name, [String(e.target.checked)], 'str')} />
              : opts.length && p.type === 'list' ? <select multiple value={cur} onChange={(e) => setParam(p.name, Array.from(e.target.selectedOptions).map((o) => o.value), 'list')} style={{ height: 90 }}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
              : opts.length ? <select value={cur[0] ?? ''} onChange={(e) => setParam(p.name, [e.target.value])}><option value="">—</option>{opts.map((o) => <option key={o}>{o}</option>)}</select>
              : p.type === 'list' || p.listType === 'column' ? <Lines value={cur} onCommit={(v) => setParam(p.name, v, 'list')} help="one per line" />
              : <Text value={cur[0] ?? ''} onCommit={(v) => setParam(p.name, [v], p.type === 'int' || p.type === 'float' ? 'str' : 'str')} />}
            {p.description && <div className="faint" style={{ marginTop: 3 }}>{p.description}</div>}
          </div>)
      })}
    </>
  )
}

/** Glue Studio's field checklist: the upstream columns, with a free-text row for what the schema does not know yet. */
function ColumnPick({ value, columns, onCommit }: { value: string[]; columns: string[]; onCommit: (v: string[]) => void }) {
  const all = Array.from(new Set([...columns, ...value]))
  const [extra, setExtra] = useState('')
  const toggle = (c: string) => onCommit(value.includes(c) ? value.filter((x) => x !== c) : [...value, c])
  return (
    <div className="col" style={{ gap: 2 }}>
      {all.length === 0 && <span className="faint">No upstream schema yet — infer one on the parent, or type column names below.</span>}
      {all.length > 1 && <label className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--dim)', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}><input type="checkbox" checked={value.length === all.length} onChange={(e) => onCommit(e.target.checked ? all : [])} />all</label>}
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        {all.map((c) => <label key={c} className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--text)', textTransform: 'none', letterSpacing: 0, fontSize: 12, padding: '1px 0' }}><input type="checkbox" checked={value.includes(c)} onChange={() => toggle(c)} /><span className="mono">{c}</span>{!columns.includes(c) && <span className="faint">(not in schema)</span>}</label>)}
      </div>
      <div className="row"><input className="mono" placeholder="add a column…" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && extra.trim()) { onCommit([...value, extra.trim()]); setExtra('') } }} /></div>
    </div>
  )
}

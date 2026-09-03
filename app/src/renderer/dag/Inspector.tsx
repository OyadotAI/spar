import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { useDag } from './store'
import { fields, label, maxInputs, supported, template, type Field } from './schema'
import { CATALOG } from './catalog'
import { S3Browser, CatalogPicker } from './Pickers'
import { useCustomTransforms } from './customTransforms'
import { useLint, NO_FINDINGS } from './lint'
import { useToast } from '@/shell/Toast'
import { Sheet } from '@/shell/Sheet'
import { Icon } from '@/shell/Icon'
import {
  AggsTable, ColumnPick, ColumnCombo, EntityPick, FilterRows, Lines, MappingTable, NodePick,
  RenamePairs, RouteGroups, SqlAliases, Text,
  type Agg, type Alias, type Col, type FilterRow, type Mapping, type NodeRef, type RouteGroup,
} from './editors'

export function Inspector({ job }: { job: string }) {
  const d = useDag((s) => s.jobs[job])
  const { setField, rename, disconnect, connect } = useDag()
  const id = d?.selection.length === 1 ? d.selection[0] : undefined
  const node = id ? d?.nodes.find((n) => n.id === id) : undefined
  // what the parents say they produce, with types — the nearest ancestors that have an OutputSchema
  const upstreamCols: Col[] = (() => {
    if (!d || !id) return []
    const seen = new Set<string>(); const out: Col[] = []
    const walk = (nid: string) => { if (seen.has(nid)) return; seen.add(nid); const n = d.nodes.find((x) => x.id === nid); if (!n) return
      const body = d.raw[nid]?.[n.type] ?? {}; const schemas = body.OutputSchemas as { Columns?: { Name: string; Type?: string }[] }[] | undefined
      if (schemas?.[0]?.Columns?.length) { for (const c of schemas[0].Columns) if (!out.some((x) => x.name === c.Name)) out.push({ name: c.Name, type: c.Type }); return }
      n.inputs.forEach(walk) }
    const me = d.nodes.find((x) => x.id === id); me?.inputs.forEach(walk)
    return out })()
  const allFindings = useLint((s) => s.byJob[job]?.findings ?? NO_FINDINGS)
  const findings = useMemo(() => allFindings.filter((f) => f.node === id), [allFindings, id])
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
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`pill ${node.category}`}>{node.category}</span>
          {!supported(node.type) && <span className="pill" title="Keel deploys this node as-is; it has no form, no generated code and no local test">JSON only</span>}
          <span className="fill" /><span className="faint mono micro" title={id}>{id.slice(0, 8)}</span>
        </div>
      </div>
      {findings.length > 0 && (
        <div className="insp-section">
          {findings.map((f, i) => (
            <div key={i} className={'insp-finding ' + f.level}>
              <Icon name={f.level === 'warn' ? 'warn' : 'info'} size={12} />
              <span className="fill"><b>{f.message}</b><span className="dim"> {f.fix}</span></span>
            </div>))}
        </div>)}
      {node.category !== 'source' && (
        <div className="insp-section">
          <div className="insp-label">Node parents <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>· {maxInputs(node.type) === 8 ? 'many' : maxInputs(node.type)} max</span></div>
          {node.inputs.map((i) => { const n = d.nodes.find((x) => x.id === i); return (
            <div key={i} className="row" style={{ fontSize: 'var(--small)', marginBottom: 2 }}><span className="fill">{n?.name ?? i}</span><button className="quiet" onClick={() => disconnect(job, i, id)} title="disconnect">✕</button></div>) })}
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
      {schema ? schema.filter((f) => !(/Catalog/.test(node.type) && (f.key === 'Database' || f.key === 'Table'))).map((f) => (
        <FieldEditor key={f.key} f={f} value={body[f.key]} body={body} self={id}
          onCommit={(v) => setField(job, id, f.key, v)}
          onCommitMany={(patch) => { for (const [k, v] of Object.entries(patch)) setField(job, id, k, v) }}
          nodes={d.nodes} inputs={node.inputs} columns={upstreamCols} />))
        : (
          <div className="insp-section">
            <div className="insp-label">No form for this type yet</div>
            <div className="faint micro">Keel deploys <span className="mono">{node.type}</span> exactly as written below, but cannot generate its Python or scaffold a test. Edit it as JSON.</div>
          </div>)}
      <div className="insp-section">
        <details><summary className="faint">JSON</summary>
          <JsonEditor value={body} onCommit={(v) => { for (const k of Object.keys(body)) if (!(k in v)) setField(job, id, k, undefined); for (const [k, val] of Object.entries(v)) setField(job, id, k, val) }} />
        </details>
      </div>
    </div>
  )
}


/** The editors that never fit a 320px column; they get a wide sheet as well. */
const WIDE = new Set<Field['kind']>(['mappingTable', 'filterExprs', 'aggs', 'sql', 'code', 'dqRuleset'])

function FieldEditor({ f, value, body, self, onCommit, onCommitMany, nodes, inputs, columns }: {
  f: Field; value: unknown; body: Record<string, unknown>; self: string
  onCommit: (v: unknown) => void; onCommitMany: (patch: Record<string, unknown>) => void
  nodes: NodeRef[]; inputs: string[]; columns: Col[]
}) {
  const [browse, setBrowse] = useState(false)
  const [wide, setWide] = useState(false)
  const s3 = f.key === 'Paths' || f.key === 'Path'
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const build = (isWide: boolean): React.ReactNode => {
  let control: React.ReactNode
  switch (f.kind) {
    case 'string': control = <Text value={String(value ?? '')} onCommit={(v) => onCommit(v)} />; break
    case 'int': case 'number': control = <Text value={value == null ? '' : String(value)} onCommit={(v) => onCommit(v === '' ? undefined : Number(v))} />; break
    case 'columnPick': control = <ColumnPick value={arr<unknown>(value).map((p) => Array.isArray(p) ? p.join('.') : String(p))} columns={columns} onCommit={(v) => onCommit(v.map((s) => s.split('.')))} />; break
    case 'aggs': control = <AggsTable value={arr<Agg>(value)} columns={columns} onCommit={onCommit} />; break
    case 'sqlAliases': control = <SqlAliases value={arr<Alias>(value)} inputs={inputs} nodes={nodes} onCommit={onCommit} />; break
    case 'renamePair': control = <RenamePairs source={arr<string>(value)} target={arr<string>(body.TargetPath)} columns={columns}
      onCommit={(sp, tp) => onCommitMany({ SourcePath: sp, TargetPath: tp })} />; break
    case 'nodePick': control = <NodePick value={String(value ?? '')} nodes={nodes} self={self} onCommit={onCommit} />; break
    case 'entityPick': control = <EntityPick value={arr<string>(value)} onCommit={onCommit} />; break
    case 'routeGroups': control = <RouteGroups value={arr<RouteGroup>(value)} columns={columns} onCommit={onCommit} />; break
    case 'nullChecks': { const v = (value ?? {}) as { IsEmpty?: boolean; IsNullString?: boolean; IsNegOne?: boolean }
      control = <div className="col" style={{ gap: 4 }}>{([['IsEmpty', 'Empty string'], ['IsNullString', 'The string "null"'], ['IsNegOne', 'The integer -1']] as const).map(([k, l]) => <label key={k} className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--text)', textTransform: 'none', letterSpacing: 0, fontSize: 'var(--small)' }}><input type="checkbox" checked={!!v[k]} onChange={(e) => onCommit({ ...v, [k]: e.target.checked })} />{l}</label>)}</div>; break }
    case 'dqRuleset': control = <textarea className="mono" rows={8} defaultValue={String(value ?? '')} placeholder={'Rules = [\n    RowCount > 0,\n    IsComplete "id",\n    IsUnique "id"\n]'} onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value) }} />; break
    case 'bool': control = <input type="checkbox" checked={!!value} onChange={(e) => onCommit(e.target.checked)} />; break
    case 'enum': control = <select value={String(value ?? f.options?.[0] ?? '')} onChange={(e) => onCommit(e.target.value)}>{(f.options ?? []).map((o) => <option key={o} value={o}>{o || '(none)'}</option>)}</select>; break
    case 'stringList': control = <Lines value={Array.isArray(value) ? (value as string[]) : []} onCommit={(v) => onCommit(v)} help="one per line" />; break
    case 'pathList': control = <Lines value={Array.isArray(value) ? (value as unknown[]).map((p) => Array.isArray(p) ? p.join('.') : String(p)) : []} onCommit={(v) => onCommit(v.map((s) => s.split('.')))} help={f.help} />; break
    case 'sql': control = <textarea className="mono" rows={6} defaultValue={String(value ?? '')} onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value) }} />; break
    case 'code': control = <CodeMirror value={String(value ?? '')} height="220px" extensions={[python()]} theme={cmTheme()} basicSetup={{ lineNumbers: true, foldGutter: false }} onBlur={undefined} onChange={undefined}
      onCreateEditor={(view) => { view.dom.addEventListener('blur', () => { const v = view.state.doc.toString(); if (v !== value) onCommit(v) }, true) }} />; break
    case 'mappingTable': control = <MappingTable value={arr<Mapping>(value)} columns={columns} onCommit={onCommit} wide={isWide} />; break
    case 'filterExprs': control = <FilterRows value={arr<FilterRow>(value)} columns={columns} onCommit={onCommit} />; break
    case 'joinCols': control = <JoinCols value={arr<JoinCol>(value)} onCommit={onCommit} inputs={inputs} nodes={nodes} columns={columns} />; break
    default: control = <JsonEditor value={value ?? null} onCommit={onCommit} />
  }
  return control
  }
  return (
    <div className="insp-section">
      <div className="row" style={{ marginBottom: 6 }}>
        <label className="insp-label" style={{ margin: 0 }}>{f.label}</label>
        <span className="fill" />
        {s3 && <button className="quiet micro" onClick={() => setBrowse(true)}>Browse S3…</button>}
        {WIDE.has(f.kind) && <button className="quiet micro" title="Edit this with room to work" onClick={() => setWide(true)}><Icon name="fit" size={11} />Expand</button>}
      </div>
      {build(false)}
      {wide && (
        <Sheet label={f.label} width={940} onClose={() => setWide(false)}>
          <h2>{f.label}</h2>
          <div style={{ marginTop: 'var(--s3)' }}>{build(true)}</div>
          <div className="row" style={{ marginTop: 'var(--s4)', justifyContent: 'flex-end' }}><button className="primary" onClick={() => setWide(false)}>Done</button></div>
        </Sheet>)}
      {browse && <S3Browser initial={f.key === 'Paths' ? (Array.isArray(value) ? String((value as string[])[0] ?? '') : '') : String(value ?? '')} onClose={() => setBrowse(false)}
        onPick={(uri) => { setBrowse(false); onCommit(f.key === 'Paths' ? [...(Array.isArray(value) ? (value as string[]) : []).filter((p) => p !== uri), uri] : uri) }} />}
    </div>)
}type JoinCol = { From?: string; Keys?: string[][] }
/** One key list per side. Glue matches them by position, so the two rows must stay the same length. */
function JoinCols({ value, onCommit, inputs, nodes, columns }: { value: JoinCol[]; onCommit: (v: JoinCol[]) => void; inputs: string[]; nodes: NodeRef[]; columns: Col[] }) {
  const rows = inputs.map((from) => value.find((v) => v.From === from) ?? { From: from, Keys: [] })
  const set = (from: string, keys: string[]) => onCommit(inputs.map((f) => ({ From: f, Keys: f === from ? keys.map((k) => k.split('.')) : (rows.find((r) => r.From === f)?.Keys ?? []) })))
  if (inputs.length < 2) return <div className="faint micro">A join needs two parents. Connect them and the key lists appear here.</div>
  const lens = rows.map((r) => (r.Keys ?? []).length)
  return (
    <div className="maps">
      {rows.map((r) => (
        <div key={r.From} className="alias-row">
          <span className="dim small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.From}>{nodes.find((n) => n.id === r.From)?.name ?? r.From}</span>
          <Icon name="join" size={12} style={{ color: 'var(--faint)' }} />
          <Text mono value={(r.Keys ?? []).map((k) => k.join('.')).join(', ')} onCommit={(v) => set(r.From!, v.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="key, key2" />
        </div>))}
      {lens[0] !== lens[1] && lens.every((n) => n > 0) && (
        <div className="insp-finding warn"><Icon name="warn" size={12} />
          <span className="fill">Each side needs the same number of keys — {lens[0]} and {lens[1]} here. Glue pairs them by position.</span>
        </div>)}
      {columns.length > 0 && <span className="faint micro">Upstream: <span className="mono">{columns.slice(0, 6).map((c) => c.name).join(', ')}{columns.length > 6 ? '…' : ''}</span></span>}
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
      <div className="row"><button onClick={() => { try { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('must be an object'); setErr(null); onCommit(v as Record<string, unknown>) } catch (e) { setErr((e as Error).message) } }}>Apply</button>{err && <span style={{ color: 'var(--del)', fontSize: 'var(--small)' }}>{err}</span>}</div>
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

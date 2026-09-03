import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { api } from '@/api/client'

export type Col = { name: string; type?: string }
export type NodeRef = { id: string; name: string }

/** Glue's DynamicFrame types. Free text stays possible for decimal(10,2), array<…> and friends. */
export const GLUE_TYPES = ['string', 'long', 'int', 'short', 'byte', 'double', 'float', 'boolean', 'timestamp', 'date', 'decimal', 'binary', 'array', 'struct', 'map', 'choice']

export function Text({ value, onCommit, mono = false, placeholder, list }: { value: string; onCommit: (v: string) => void; mono?: boolean; placeholder?: string; list?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <input className={mono ? 'mono' : ''} value={v} list={list} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
    onBlur={() => { if (v !== value) onCommit(v) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}

export function Lines({ value, onCommit, help }: { value: string[]; onCommit: (v: string[]) => void; help?: string }) {
  const [v, setV] = useState(value.join('\n'))
  useEffect(() => setV(value.join('\n')), [value])
  return <textarea className="mono" rows={Math.min(8, Math.max(2, v.split('\n').length))} value={v} placeholder={help} onChange={(e) => setV(e.target.value)}
    onBlur={() => { const next = v.split('\n').map((s) => s.trim()).filter(Boolean); if (JSON.stringify(next) !== JSON.stringify(value)) onCommit(next) }} />
}

/**
 * A column name, with what the parent actually produces offered as you type.
 *
 * Every column in this inspector used to be a bare text box: you had to remember the upstream
 * schema and spell it right, and a typo showed up as a runtime failure in Glue rather than here.
 */
export function ColumnCombo({ value, columns, onCommit, placeholder }: { value: string; columns: Col[]; onCommit: (v: string) => void; placeholder?: string }) {
  const id = useMemo(() => 'cols-' + Math.random().toString(36).slice(2, 8), [])
  const known = columns.some((c) => c.name === value)
  return (
    <span className="combo">
      <Text mono value={value} onCommit={onCommit} placeholder={placeholder} list={id} />
      <datalist id={id}>{columns.map((c) => <option key={c.name} value={c.name}>{c.type ?? ''}</option>)}</datalist>
      {value && !known && columns.length > 0 && <Icon name="warn" size={11} style={{ color: 'var(--warn)' }} />}
    </span>
  )
}

function TypeSelect({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const custom = value && !GLUE_TYPES.includes(value)
  return (
    <select className="mono" value={custom ? '__custom' : value || 'string'} onChange={(e) => onCommit(e.target.value === '__custom' ? value : e.target.value)}>
      {GLUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      {custom && <option value="__custom">{value}</option>}
    </select>
  )
}

/* ---------------------------------------------------------------- mappings */

export type Mapping = { ToKey?: string; FromPath?: string[]; FromType?: string; ToType?: string; Dropped?: boolean }
const from = (m: Mapping) => (m.FromPath ?? []).join('.')

/**
 * Change Schema.
 *
 * The old grid was five inputs in a 340px column, so every value truncated to "custome" and
 * "doubl", and it started empty: you hand-typed every column of the parent's schema, twice, with
 * its type. Now it fills itself from the parent, it says which upstream columns are about to be
 * silently dropped, it can be searched, and it opens wide when there are more than a handful.
 */
export function MappingTable({ value, columns, onCommit, wide = false }: { value: Mapping[]; columns: Col[]; onCommit: (v: Mapping[]) => void; wide?: boolean }) {
  const [q, setQ] = useState('')
  const set = (i: number, m: Partial<Mapping>) => onCommit(value.map((r, j) => (j === i ? { ...r, ...m } : r)))
  const mapped = new Set(value.map(from).filter(Boolean))
  const missing = columns.filter((c) => !mapped.has(c.name))
  const rows = value.map((m, i) => ({ m, i })).filter(({ m }) => !q || from(m).toLowerCase().includes(q.toLowerCase()) || (m.ToKey ?? '').toLowerCase().includes(q.toLowerCase()))
  const fill = () => onCommit([...value, ...missing.map((c) => ({ FromPath: c.name.split('.'), FromType: c.type ?? 'string', ToKey: c.name, ToType: c.type ?? 'string' }))])
  const renameAll = (f: (s: string) => string) => onCommit(value.map((m) => ({ ...m, ToKey: f(m.ToKey || from(m)) })))
  const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase().replace(/^_|_$/g, '')

  return (
    <div className="maps">
      <div className="maps-bar">
        {value.length > 4 && (
          <input className="fill" placeholder="Filter columns" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter the mappings" />)}
        <span className="fill" />
        <span className="faint micro">{value.filter((m) => !m.Dropped).length} kept{value.some((m) => m.Dropped) ? ` · ${value.filter((m) => m.Dropped).length} dropped` : ''}</span>
        {value.length > 0 && <button className="quiet micro" title="Lower-case and underscore every target name" onClick={() => renameAll(snake)}>snake_case</button>}
      </div>

      {missing.length > 0 && (
        <div className="maps-note">
          <Icon name="warn" size={12} />
          <span className="fill">
            {mapped.size === 0
              ? <>The parent produces {columns.length} column{columns.length > 1 ? 's' : ''} and nothing is mapped yet.</>
              : <>{missing.length} upstream column{missing.length > 1 ? 's are' : ' is'} not mapped, so Glue will drop {missing.length > 1 ? 'them' : 'it'}: <span className="mono">{missing.slice(0, 4).map((c) => c.name).join(', ')}{missing.length > 4 ? '…' : ''}</span></>}
          </span>
          <button className="quiet micro" onClick={fill}><Icon name="plus" size={11} />Add {mapped.size === 0 ? 'all' : 'them'}</button>
        </div>)}
      {columns.length === 0 && (
        <div className="faint micro" style={{ padding: '2px 0 6px' }}>
          No upstream schema yet — infer one on the parent node (Schema tab) and this fills itself.
        </div>)}

      {rows.map(({ m, i }) => (
        <div key={i} className={'map-row' + (wide ? ' wide' : '') + (m.Dropped ? ' dropped' : '')}>
          {/* narrow stacks source over target, so each line says which one it is */}
          <span className="map-lbl">from</span>
          <ColumnCombo value={from(m)} columns={columns} onCommit={(v) => set(i, { FromPath: v.split('.') })} placeholder="source column" />
          <TypeSelect value={m.FromType ?? 'string'} onCommit={(v) => set(i, { FromType: v })} />
          <span className="map-arrow"><Icon name="mapping" size={12} /></span>
          <span className="map-lbl">to</span>
          <Text mono value={m.ToKey ?? ''} onCommit={(v) => set(i, { ToKey: v })} placeholder="target name" />
          <TypeSelect value={m.ToType ?? 'string'} onCommit={(v) => set(i, { ToType: v })} />
          <span className="map-acts">
            <button className={'quiet' + (m.Dropped ? ' on' : '')} title={m.Dropped ? 'Dropped — click to keep' : 'Kept — click to drop'}
              aria-label={m.Dropped ? `Keep ${from(m)}` : `Drop ${from(m)}`} onClick={() => set(i, { Dropped: !m.Dropped })}>
              <Icon name={m.Dropped ? 'drop' : 'check'} size={12} />
            </button>
            <button className="quiet" aria-label={`Remove the mapping for ${from(m)}`} onClick={() => onCommit(value.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
          </span>
        </div>))}
      {value.length > 0 && rows.length === 0 && <div className="faint micro" style={{ padding: '6px 0' }}>No mapping matches “{q}”.</div>}
      <button className="quiet" onClick={() => onCommit([...value, { FromPath: [''], FromType: 'string', ToKey: '', ToType: 'string' }])}><Icon name="plus" size={12} />mapping</button>
    </div>
  )
}

/* ----------------------------------------------------------------- filters */

export type FilterRow = { Operation?: string; Negated?: boolean; Values?: { Type: string; Value: string[] }[] }
/** Glue's operator ids, with what they mean. `EQ` on a button tells you nothing. */
export const OPS: [string, string, 'none' | 'one' | 'many'][] = [
  ['EQ', 'equals', 'one'], ['NE', 'does not equal', 'one'],
  ['LT', 'is less than', 'one'], ['LTE', 'is at most', 'one'], ['GT', 'is greater than', 'one'], ['GTE', 'is at least', 'one'],
  ['ISNULL', 'is null', 'none'], ['NOT_NULL', 'is not null', 'none'], ['ZERO_LENGTH', 'is empty', 'none'],
  ['IN', 'is one of', 'many'], ['BETWEEN', 'is between', 'many'],
  ['CONTAINS', 'contains', 'one'], ['STARTS_WITH', 'starts with', 'one'], ['ENDS_WITH', 'ends with', 'one'],
  ['LIKE', 'is like', 'one'], ['ILIKE', 'is like (any case)', 'one'], ['REGEX', 'matches regex', 'one'],
]

export function FilterRows({ value, columns, onCommit }: { value: FilterRow[]; columns: Col[]; onCommit: (v: FilterRow[]) => void }) {
  const set = (i: number, r: Partial<FilterRow>) => onCommit(value.map((x, j) => (j === i ? { ...x, ...r } : x)))
  return (
    <div className="maps">
      {value.map((r, i) => {
        const col = r.Values?.[0]?.Value?.[0] ?? ''
        const vals = r.Values?.[1]?.Value ?? []
        const arity = OPS.find(([o]) => o === (r.Operation ?? 'EQ'))?.[2] ?? 'one'
        const write = (c: string, v: string[]) => set(i, { Values: [{ Type: 'COLUMNEXTRACTED', Value: [c] }, ...(v.length ? [{ Type: 'CONSTANT', Value: v }] : [])] })
        return (
          <div key={i} className="filter-row">
            <ColumnCombo value={col} columns={columns} onCommit={(v) => write(v, vals)} placeholder="column" />
            <select value={r.Operation ?? 'EQ'} onChange={(e) => set(i, { Operation: e.target.value })}>
              {OPS.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
            </select>
            {arity === 'one' && <Text mono value={vals[0] ?? ''} onCommit={(v) => write(col, v === '' ? [] : [v])} placeholder="value" />}
            {arity === 'many' && <Text mono value={vals.join(', ')} onCommit={(v) => write(col, v.split(',').map((s) => s.trim()).filter(Boolean))} placeholder={r.Operation === 'BETWEEN' ? 'low, high' : 'a, b, c'} />}
            {arity === 'none' && <span className="faint micro">no value</span>}
            <label className="row micro dim" style={{ gap: 4 }} title="Negate this condition"><input type="checkbox" checked={!!r.Negated} onChange={(e) => set(i, { Negated: e.target.checked })} />not</label>
            <button className="quiet" aria-label="Remove this condition" onClick={() => onCommit(value.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
          </div>) })}
      <button className="quiet" onClick={() => onCommit([...value, { Operation: 'EQ', Negated: false, Values: [{ Type: 'COLUMNEXTRACTED', Value: [''] }] }])}><Icon name="plus" size={12} />condition</button>
    </div>
  )
}

/* -------------------------------------------------------------- aggregates */

export type Agg = { Column?: string[]; AggFunc?: string }
export const AGG_FUNCS = ['avg', 'count', 'countDistinct', 'first', 'last', 'max', 'min', 'sum', 'sumDistinct', 'stddev_samp', 'stddev_pop', 'var_samp', 'var_pop', 'skewness', 'kurtosis']

/** Aggregations were a raw JSON array: `[{Column:[..], AggFunc}]`, hand-typed. */
export function AggsTable({ value, columns, onCommit }: { value: Agg[]; columns: Col[]; onCommit: (v: Agg[]) => void }) {
  const set = (i: number, a: Partial<Agg>) => onCommit(value.map((x, j) => (j === i ? { ...x, ...a } : x)))
  return (
    <div className="maps">
      {value.map((a, i) => (
        <div key={i} className="agg-row">
          <select value={a.AggFunc ?? 'count'} onChange={(e) => set(i, { AggFunc: e.target.value })}>{AGG_FUNCS.map((f) => <option key={f}>{f}</option>)}</select>
          <span className="faint micro">of</span>
          <ColumnCombo value={(a.Column ?? []).join('.')} columns={columns} onCommit={(v) => set(i, { Column: v.split('.') })} placeholder="column" />
          <button className="quiet" aria-label="Remove this aggregation" onClick={() => onCommit(value.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
        </div>))}
      {value.length === 0 && <div className="faint micro" style={{ paddingBottom: 4 }}>No aggregation yet — a group-by with none of these produces only the group keys.</div>}
      <button className="quiet" onClick={() => onCommit([...value, { AggFunc: 'count', Column: [columns[0]?.name ?? ''] }])}><Icon name="plus" size={12} />aggregation</button>
    </div>
  )
}

/* ------------------------------------------------------------- SQL aliases */

export type Alias = { From?: string; Alias?: string }

/**
 * The names the SQL can use for each input frame. Without them the query cannot be written at all,
 * and they were edited as raw JSON — so this offers one per connected input and fills in a default.
 */
export function SqlAliases({ value, inputs, nodes, onCommit }: { value: Alias[]; inputs: string[]; nodes: NodeRef[]; onCommit: (v: Alias[]) => void }) {
  const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? id
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^([0-9])/, '_$1')
  if (!inputs.length) return <div className="faint micro">Connect an input first; each one gets a table name the SQL can select from.</div>
  const rows = inputs.map((id) => value.find((a) => a.From === id) ?? { From: id, Alias: '' })
  const set = (id: string, alias: string) => onCommit(inputs.map((i) => ({ From: i, Alias: i === id ? alias : (rows.find((r) => r.From === i)?.Alias ?? '') })).filter((a) => a.Alias))
  return (
    <div className="maps">
      {rows.map((r) => (
        <div key={r.From} className="alias-row">
          <span className="dim small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.From}>{name(r.From!)}</span>
          <Icon name="mapping" size={12} style={{ color: 'var(--faint)' }} />
          <Text mono value={r.Alias ?? ''} onCommit={(v) => set(r.From!, clean(v))} placeholder={clean(name(r.From!).toLowerCase())} />
        </div>))}
      <button className="quiet" onClick={() => onCommit(inputs.map((i) => ({ From: i, Alias: clean(name(i).toLowerCase()) })))}>
        <Icon name="magic" size={12} />Name them after the nodes
      </button>
    </div>
  )
}

/* ------------------------------------------------------------ rename pairs */

/** SourcePath and TargetPath are two parallel arrays that had to stay index-aligned by hand. */
export function RenamePairs({ source, target, columns, onCommit }: { source: string[]; target: string[]; columns: Col[]; onCommit: (s: string[], t: string[]) => void }) {
  const n = Math.max(source.length, target.length, 1)
  const rows = Array.from({ length: n }, (_, i) => ({ from: source[i] ?? '', to: target[i] ?? '' }))
  const set = (i: number, from: string, to: string) => {
    const next = rows.map((r, j) => (j === i ? { from, to } : r))
    onCommit(next.map((r) => r.from), next.map((r) => r.to))
  }
  return (
    <div className="maps">
      {rows.map((r, i) => (
        <div key={i} className="alias-row">
          <ColumnCombo value={r.from} columns={columns} onCommit={(v) => set(i, v, r.to)} placeholder="from" />
          <Icon name="mapping" size={12} style={{ color: 'var(--faint)' }} />
          <Text mono value={r.to} onCommit={(v) => set(i, r.from, v)} placeholder="to" />
        </div>))}
      <span className="faint micro">Glue's RenameField renames one column; extra rows are kept for the JSON but only the first is generated.</span>
    </div>
  )
}

/* ------------------------------------------------------------- small picks */

export function NodePick({ value, nodes, self, onCommit }: { value: string; nodes: NodeRef[]; self?: string; onCommit: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onCommit(e.target.value)}>
      <option value="">—</option>
      {nodes.filter((n) => n.id !== self).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
    </select>
  )
}

/** The account's managed + custom detection entities, rather than a free-text list to mistype. */
export function EntityPick({ value, onCommit }: { value: string[]; onCommit: (v: string[]) => void }) {
  const [all, setAll] = useState<string[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    void api.get<{ managed?: string[]; custom?: { name: string }[] }>('/api/glue/entities', 'the detection entities')
      .then((r) => setAll(r.ok ? [...(r.value.managed ?? []), ...(r.value.custom ?? []).map((c) => c.name)] : []))
  }, [])
  const list = (all ?? []).filter((e) => !q || e.toLowerCase().includes(q.toLowerCase()))
  const toggle = (e: string) => onCommit(value.includes(e) ? value.filter((x) => x !== e) : [...value, e])
  if (all === null) return <div className="faint micro">Reading the detection entities…</div>
  if (all.length === 0) return <Lines value={value} onCommit={onCommit} help="one per line" />
  return (
    <div className="col" style={{ gap: 4 }}>
      <input placeholder="Filter entities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter detection entities" />
      <div className="pick-list">
        {list.map((e) => (
          <label key={e} className="pick-row"><input type="checkbox" checked={value.includes(e)} onChange={() => toggle(e)} /><span className="mono">{e}</span></label>))}
        {list.length === 0 && <span className="faint micro">Nothing matches “{q}”.</span>}
      </div>
      {value.length > 0 && <span className="faint micro">{value.length} selected</span>}
    </div>
  )
}

/** Glue Studio's field checklist: the upstream columns, searchable, plus a row for what it misses. */
export function ColumnPick({ value, columns, onCommit }: { value: string[]; columns: Col[]; onCommit: (v: string[]) => void }) {
  const names = columns.map((c) => c.name)
  const all = Array.from(new Set([...names, ...value]))
  const [extra, setExtra] = useState('')
  const [q, setQ] = useState('')
  const shown = all.filter((c) => !q || c.toLowerCase().includes(q.toLowerCase()))
  const toggle = (c: string) => onCommit(value.includes(c) ? value.filter((x) => x !== c) : [...value, c])
  return (
    <div className="col" style={{ gap: 4 }}>
      {all.length === 0 && <span className="faint micro">No upstream schema yet — infer one on the parent, or type column names below.</span>}
      {all.length > 6 && <input placeholder="Filter columns" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter columns" />}
      {all.length > 1 && (
        <div className="row micro dim" style={{ gap: 10 }}>
          <button className="quiet micro" onClick={() => onCommit(all)}>all</button>
          <button className="quiet micro" onClick={() => onCommit([])}>none</button>
          <span className="fill" /><span>{value.length} of {all.length}</span>
        </div>)}
      <div className="pick-list">
        {shown.map((c) => (
          <label key={c} className="pick-row">
            <input type="checkbox" checked={value.includes(c)} onChange={() => toggle(c)} />
            <span className="mono fill">{c}</span>
            <span className="faint micro">{columns.find((x) => x.name === c)?.type ?? (names.includes(c) ? '' : 'not in schema')}</span>
          </label>))}
      </div>
      <input className="mono" placeholder="add a column…" value={extra} onChange={(e) => setExtra(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && extra.trim()) { onCommit([...value, extra.trim()]); setExtra('') } }} />
    </div>
  )
}

/* ------------------------------------------------------------ route groups */

export type RouteGroup = { GroupName?: string; LogicalOperator?: string; Filters?: FilterRow[] }

/**
 * Conditional Router: each group is a named output with its own conditions. It was raw JSON, which
 * is a hard way to write a branch — the group name becomes the output frame the next node selects.
 */
export function RouteGroups({ value, columns, onCommit }: { value: RouteGroup[]; columns: Col[]; onCommit: (v: RouteGroup[]) => void }) {
  const set = (i: number, g: Partial<RouteGroup>) => onCommit(value.map((x, j) => (j === i ? { ...x, ...g } : x)))
  return (
    <div className="maps">
      {value.map((g, i) => (
        <div key={i} className="route-group">
          <div className="row" style={{ gap: 6 }}>
            <Text mono value={g.GroupName ?? ''} onCommit={(v) => set(i, { GroupName: v.replace(/[^A-Za-z0-9_]+/g, '_') })} placeholder="output_group_1" />
            <select value={g.LogicalOperator ?? 'AND'} onChange={(e) => set(i, { LogicalOperator: e.target.value })}><option>AND</option><option>OR</option></select>
            <button className="quiet" aria-label={`Remove ${g.GroupName ?? 'this group'}`} onClick={() => onCommit(value.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
          </div>
          <FilterRows value={g.Filters ?? []} columns={columns} onCommit={(f) => set(i, { Filters: f })} />
        </div>))}
      <button className="quiet" onClick={() => onCommit([...value, { GroupName: `output_group_${value.length + 1}`, LogicalOperator: 'AND', Filters: [] }])}>
        <Icon name="plus" size={12} />output group
      </button>
    </div>
  )
}

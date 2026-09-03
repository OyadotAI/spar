import { useEffect, useMemo, useRef, useState } from 'react'
import { CATALOG, KEYWORDS } from './catalog'
import { supported, label, category } from './schema'
import { score } from './search'
import { useDag } from './store'
import { useCustomTransforms, dynamicTemplate } from './customTransforms'
import { Icon, nodeIcon } from '@/shell/Icon'

type Item = { key: string; type: string; name: string; group: string; category: 'source' | 'transform' | 'target'; custom?: boolean; hint?: string }

/**
 * Adding a node.
 *
 * Three things were wrong. Search was `includes()`, so one transposed letter — "cvs" — matched
 * nothing; when nothing matched the list simply vanished, with no line saying so; and an item only
 * responded to a double-click or a drag, so a single click did nothing at all. Now: ranked fuzzy
 * search over names, types and the words people actually use (see KEYWORDS), a click adds, and the
 * arrow keys walk the results.
 */
export function Palette({ job, onAdded, onPick }: { job: string; onAdded?: (id: string) => void; onPick?: (type: string, customName?: string) => void }) {
  const custom = useCustomTransforms()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!custom.loaded) void custom.load() }, [custom])

  const all: Item[] = useMemo(() => [
    ...custom.list.map((t) => ({ key: 'c:' + t.key, type: 'DynamicTransform', name: t.displayName || t.name, group: 'Custom visual transforms', category: 'transform' as const, custom: true, hint: t.description || `${t.functionName} · ${t.path}` })),
    ...CATALOG.flatMap((f) => f.types.map(([t, n]) => ({ key: t, type: t, name: n, group: f.title, category: f.category }))),
  ], [custom.list])

  const hits = useMemo(() => {
    if (!q.trim()) return all
    return all
      .map((i) => ({ i, s: score(q, i.name, i.type, i.custom ? [] : KEYWORDS[i.type]) }))
      .filter((x): x is { i: Item; s: number } => x.s != null)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.i)
  }, [q, all])
  const searching = q.trim().length > 0
  useEffect(() => { setAt(0) }, [q])

  const place = () => { const d = useDag.getState().get(job); const n = d.nodes.length; return { x: 80 + (n % 5) * 60, y: 80 + n * 30 } }
  const addItem = (i: Item) => {
    // the caller may want to place and wire it itself — see the "+" on a node's output
    if (onPick) { onPick(i.custom ? 'DynamicTransform' : i.type, i.custom ? i.name : undefined); return }
    if (i.custom) {
      const t = custom.list.find((x) => 'c:' + x.key === i.key)
      if (!t) return
      const id = useDag.getState().add(job, 'DynamicTransform', place())
      useDag.getState().replaceNode(job, id, 'DynamicTransform', dynamicTemplate(t, t.displayName || t.name))
      onAdded?.(id)
      return
    }
    onAdded?.(useDag.getState().add(job, i.type, place()))
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(hits.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))
      setAt(next)
      listRef.current?.querySelectorAll('.palette-item')[next]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && hits[at]) { e.preventDefault(); addItem(hits[at]!) }
  }

  let group = ''
  return (
    <div className="palette">
      <div className="palette-search">
        <Icon name="search" size={13} style={{ color: 'var(--faint)' }} />
        <input className="fill" placeholder="Find a node — try “dedupe”, “where”, “csv”" data-search aria-label="Find a node type"
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoFocus />
        {q && <button className="quiet" aria-label="Clear the search" onClick={() => setQ('')}><Icon name="x" size={12} /></button>}
      </div>
      {custom.error && <div className="faint micro" style={{ padding: '4px 6px' }}>Custom transforms: {custom.error}</div>}

      <div ref={listRef} className="palette-list">
        {hits.length === 0 && (
          <div className="palette-empty">
            <b>No node matches “{q}”</b>
            <span className="dim">Try what it does rather than what it is called — <i>dedupe</i>, <i>where</i>, <i>group by</i>, <i>mask</i>, <i>write</i>.</span>
          </div>)}
        {hits.map((i, n) => {
          const head = !searching && i.group !== group ? (group = i.group) : null
          return (
            <div key={i.key}>
              {head && <div className="palette-head">{head}</div>}
              <button className={`palette-item ${i.category}${n === at ? ' on' : ''}`} draggable
                onDragStart={(e) => { e.dataTransfer.setData(i.custom ? 'application/keel-custom' : 'application/keel-node', i.custom ? i.name : i.type); e.dataTransfer.effectAllowed = 'move' }}
                onClick={() => addItem(i)} onMouseEnter={() => setAt(n)}
                title={i.hint ?? (supported(i.type) ? 'Click to add, or drag onto the canvas' : 'Keel deploys this type but cannot generate local code or tests for it yet')}>
                <Icon name={i.custom ? 'magic' : nodeIcon(i.type)} size={14} style={{ color: 'var(--dim)' }} />
                <span className="fill" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{i.custom ? i.name : label(i.type)}</span>
                {searching && <span className="faint micro palette-group">{i.category}</span>}
                {!i.custom && !supported(i.type) && <span className="pill micro" title="Keel deploys this node as-is but has no form, no generated code and no local test for it">JSON</span>}
              </button>
            </div>) })}
      </div>
      <div className="palette-foot faint micro">
        {hits.length} of {all.length} · click to add, or drag onto the canvas
      </div>
    </div>
  )
}

/** Unused re-export kept so the canvas drop handler and the palette agree on categories. */
export { category }

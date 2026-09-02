import { useEffect, useState } from 'react'
import { CATALOG } from './catalog'
import { supported, label } from './schema'
import { useDag } from './store'
import { useCustomTransforms, dynamicTemplate } from './customTransforms'
import { Icon, nodeIcon } from '@/shell/Icon'

export function Palette({ job }: { job: string }) {
  const add = useDag((s) => s.add)
  const custom = useCustomTransforms()
  const [q, setQ] = useState('')
  useEffect(() => { if (!custom.loaded) void custom.load() }, [custom])
  const addCustom = (name: string) => {
    const t = custom.list.find((x) => x.name === name || x.displayName === name); if (!t) return
    const d = useDag.getState().get(job); const n = d.nodes.length
    const id = useDag.getState().add(job, 'DynamicTransform', { x: 80 + (n % 5) * 60, y: 80 + n * 30 })
    const body = dynamicTemplate(t, t.displayName || t.name)
    useDag.getState().replaceNode(job, id, 'DynamicTransform', body)
  }
  const addAtCentre = (type: string) => { const d = useDag.getState().get(job); const n = d.nodes.length; add(job, type, { x: 80 + (n % 5) * 60, y: 80 + n * 30 }) }
  const needle = q.trim().toLowerCase()
  return (
    <div className="palette">
      <div style={{ position: 'relative', margin: '6px 0 4px' }}>
        <Icon name="search" size={12} style={{ position: 'absolute', left: 7, top: 7, color: 'var(--faint)' }} />
        <input placeholder="Find a node" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', paddingLeft: 24, fontSize: 'var(--small)' }} />
      </div>
      {custom.list.length > 0 && (() => {
        const items = custom.list.filter((t) => !needle || t.displayName.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle))
        if (!items.length) return null
        return (
          <div>
            <div className="palette-head">Custom visual transforms</div>
            {items.map((t) => (
              <div key={t.key} className="palette-item transform" draggable onDragStart={(e) => { e.dataTransfer.setData('application/keel-custom', t.name); e.dataTransfer.effectAllowed = 'move' }}
                onDoubleClick={() => addCustom(t.name)} title={t.description || `${t.functionName} · ${t.path}`}>
                <Icon name="magic" size={14} style={{ color: 'var(--dim)' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.displayName}</span>
              </div>))}
          </div>)
      })()}
      {custom.error && <div className="faint" style={{ padding: '6px 4px', fontSize: 11 }}>Custom transforms: {custom.error}</div>}
      {CATALOG.map((f) => {
        const types = f.types.filter(([t, n]) => !needle || t.toLowerCase().includes(needle) || n.toLowerCase().includes(needle))
        if (!types.length) return null
        return (
          <div key={f.title}>
            <div className="palette-head">{f.title}</div>
            {types.map(([t]) => (
              <div key={t} className={`palette-item ${f.category}`} draggable onDragStart={(e) => { e.dataTransfer.setData('application/keel-node', t); e.dataTransfer.effectAllowed = 'move' }}
                onDoubleClick={() => addAtCentre(t)} title={supported(t) ? 'drag onto the canvas, or double-click' : 'Keel deploys this type but cannot generate local code or tests for it yet'}>
                <Icon name={nodeIcon(t)} size={14} style={{ color: 'var(--dim)' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(t)}</span>
                {!supported(t) && <span className="faint" title="JSON only" style={{ marginLeft: 'auto', fontSize: 10 }}>{'{}'}</span>}
              </div>))}
          </div>)
      })}
    </div>
  )
}

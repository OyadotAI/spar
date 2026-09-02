import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, useReactFlow, type Node, type Edge, type Connection, type NodeChange, type OnConnect, type IsValidConnection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useDag, type Pos } from './store'
import { KeelNode, type KeelNodeData } from './KeelNode'
import { NODE_W, NODE_H } from './layout'
import { maxInputs } from './schema'
import { Icon } from '@/shell/Icon'

const nodeTypes = { keel: KeelNode }

export function DagEditor({ job, toolbarOffset = 8 }: { job: string; toolbarOffset?: number }) {
  return <ReactFlowProvider><Canvas job={job} toolbarOffset={toolbarOffset} /></ReactFlowProvider>
}

function Canvas({ job, toolbarOffset }: { job: string; toolbarOffset: number }) {
  const d = useDag((s) => s.jobs[job])
  const { select, move, connect, remove, add, undo, redo, relayout } = useDag()
  const rf = useReactFlow()
  const [toast, setToast] = useState<string | null>(null)
  const dragging = useRef<Record<string, Pos>>({})
  const nodes = useMemo<Node<KeelNodeData>[]>(() => (d?.nodes ?? []).map((n) => ({
    id: n.id, type: 'keel', position: d?.layout[n.id] ?? { x: 0, y: 0 }, width: NODE_W, height: NODE_H,
    selected: d?.selection.includes(n.id), data: { name: n.name, type: n.type, category: n.category, inputs: n.inputs.length },
  })), [d?.nodes, d?.layout, d?.selection])
  const edges = useMemo<Edge[]>(() => (d?.edges ?? []).map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, animated: !!d?.selection.some((s) => s === e.from || s === e.to) })), [d?.edges, d?.selection])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const sel = new Set(d?.selection ?? [])
    let selChanged = false
    for (const c of changes) {
      if (c.type === 'position' && c.position) { dragging.current[c.id] = { x: Math.max(0, Math.round(c.position.x)), y: Math.max(0, Math.round(c.position.y)) }; if (!c.dragging) { move(job, dragging.current); dragging.current = {} } }
      else if (c.type === 'select') { if (c.selected) sel.add(c.id); else sel.delete(c.id); selChanged = true }
      else if (c.type === 'remove') remove(job, [c.id])
    }
    if (selChanged) select(job, [...sel])
  }, [d?.selection, job, move, remove, select])
  const onConnect: OnConnect = useCallback((c: Connection) => { if (c.source && c.target) { const why = connect(job, c.source, c.target); if (why) flash(why) } }, [job, connect])
  const isValid: IsValidConnection = useCallback((c) => {
    if (!c.source || !c.target || c.source === c.target) return false
    const t = d?.nodes.find((n) => n.id === c.target); const s = d?.nodes.find((n) => n.id === c.source)
    return !!t && !!s && t.category !== 'source' && s.category !== 'target'
  }, [d?.nodes])
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/keel-node'); if (!type) return
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    add(job, type, { x: Math.max(0, Math.round(p.x - NODE_W / 2)), y: Math.max(0, Math.round(p.y - NODE_H / 2)) })
  }, [rf, add, job])
  useEffect(() => {
    const off = window.keel.onMenu((cmd) => {
      if (cmd === 'undo') undo(job); else if (cmd === 'redo') redo(job)
      else if (cmd === 'zoom-in') void rf.zoomIn(); else if (cmd === 'zoom-out') void rf.zoomOut(); else if (cmd === 'zoom-fit') void rf.fitView({ padding: 0.2 })
      else if (cmd === 'auto-layout') { relayout(job); setTimeout(() => void rf.fitView({ padding: 0.2 }), 50) }
    })
    return off
  }, [job, rf, undo, redo, relayout])
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) redo(job); else undo(job) }
    else if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); select(job, (d?.nodes ?? []).map((n) => n.id)) }
  }
  // fitView at mount sees no nodes (they load async); fit once when they first arrive
  const fitted = useRef(false)
  useEffect(() => { if (!fitted.current && nodes.length > 0) { fitted.current = true; setTimeout(() => void rf.fitView({ padding: 0.2 }), 30) } }, [nodes.length, rf])
  const sel = d?.selection ?? []
  return (
    <div style={{ height: '100%', position: 'relative' }} onKeyDown={onKey} tabIndex={0}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onConnect={onConnect} isValidConnection={isValid}
        onEdgesDelete={(es) => es.forEach((e) => useDag.getState().disconnect(job, e.source, e.target))}
        onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.2} maxZoom={3} deleteKeyCode={['Backspace', 'Delete']} multiSelectionKeyCode={['Meta', 'Shift']} selectionOnDrag panOnScroll
        proOptions={{ hideAttribution: true }} colorMode="system">
        <Background gap={20} />
        <Controls showInteractive={false} />
        {nodes.length >= 8 && <MiniMap pannable zoomable nodeStrokeWidth={2} />}
      </ReactFlow>
      <div className="canvas-toolbar row" style={{ left: toolbarOffset }}>
        <button className="quiet" onClick={() => { relayout(job); setTimeout(() => void rf.fitView({ padding: 0.2 }), 50) }} title="⌘⇧L"><Icon name="layout" />Auto-layout</button>
        <button className="quiet" onClick={() => void rf.fitView({ padding: 0.2 })} title="⌘0"><Icon name="fit" />Fit</button>
        {sel.length > 0 && <button className="quiet danger" onClick={() => remove(job, sel)}><Icon name="trash" />Delete {sel.length > 1 ? `${sel.length} nodes` : ''}</button>}
        {sel.length === 1 && (() => { const n = d?.nodes.find((x) => x.id === sel[0]); return n && n.inputs.length > 0 && maxInputs(n.type) > 0 ? <span className="faint">{n.inputs.length}/{maxInputs(n.type)} inputs</span> : null })()}
      </div>
      {d?.conflict && <div className="canvas-banner"><span>{d.conflict}</span><button onClick={() => void useDag.getState().load(job)}>Reload</button></div>}
      {toast && <div className="canvas-toast">{toast}</div>}
      {d && d.nodes.length === 0 && <div className="canvas-empty">Drag a node from the palette, or describe the pipeline to the agent on the right.</div>}
    </div>
  )
}

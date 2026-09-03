import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, applyNodeChanges, Background, Controls, MarkerType, MiniMap, ReactFlowProvider, useReactFlow, useStore, type Node, type Edge, type Connection, type NodeChange, type OnConnect, type IsValidConnection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useLint, NO_FINDINGS } from './lint'
import { useDag, type Pos } from './store'
import { KeelNode, type KeelNodeData } from './KeelNode'
import { NODE_W, NODE_H } from './layout'
import { maxInputs } from './schema'
import { lineage, edgeId } from './lineage'
import { Palette } from './Palette'
import { useCustomTransforms, dynamicTemplate } from './customTransforms'
import { Icon } from '@/shell/Icon'

const nodeTypes = { keel: KeelNode }
/** The zoom below which a node card stops being readable. Opening below this helps nobody. */
const READABLE = 0.62

export function DagEditor({ job, toolbarOffset = 8 }: { job: string; toolbarOffset?: number }) {
  return <ReactFlowProvider><Canvas job={job} toolbarOffset={toolbarOffset} /></ReactFlowProvider>
}

function Canvas({ job, toolbarOffset }: { job: string; toolbarOffset: number }) {
  const d = useDag((s) => s.jobs[job])
  const { select, move, connect, remove, add, undo, redo, relayout } = useDag()
  const rf = useReactFlow()
  const [toast, setToast] = useState<string | null>(null)
  const problems = useLint((s) => s.byJob[job]?.findings ?? NO_FINDINGS)
  const [showProblems, setShowProblems] = useState(false)
  useEffect(() => { if (d?.loaded) void useLint.getState().check(job, d.rev) }, [job, d?.rev, d?.loaded])
  const dragging = useRef<Record<string, Pos>>({})
  // where a "+" on a node's output opened the palette, and at which screen point
  const [addFrom, setAddFrom] = useState<{ id: string; at: { x: number; y: number } } | null>(null)
  const onAddFrom = useCallback((id: string, at: { x: number; y: number }) => setAddFrom({ id, at }), [])

  // anchor the graph on the selection: its ancestors and descendants stay lit, the rest recedes
  const focus = useMemo(() => lineage(d?.edges ?? [], d?.selection ?? []), [d?.edges, d?.selection])
  const columnsOf = useCallback((id: string, type: string) => {
    const schemas = d?.raw[id]?.[type]?.OutputSchemas as { Columns?: unknown[] }[] | undefined
    return schemas?.[0]?.Columns?.length
  }, [d?.raw])

  const built = useMemo<Node<KeelNodeData>[]>(() => (d?.nodes ?? []).map((n) => ({
    id: n.id, type: 'keel', position: d?.layout[n.id] ?? { x: 0, y: 0 }, width: NODE_W, height: NODE_H,
    selected: d?.selection.includes(n.id),
    data: {
      name: n.name, type: n.type, category: n.category,
      inputs: n.inputs.length, maxInputs: maxInputs(n.type), columns: columnsOf(n.id, n.type),
      problems: problems.filter((f) => f.node === n.id),
      dim: focus.nodes.size > 0 && !focus.nodes.has(n.id),
      onAddFrom,
    },
  })), [d?.nodes, d?.layout, d?.selection, problems, focus, columnsOf, onAddFrom])

  /**
   * React Flow is controlled here, so it renders exactly the positions we hand it. Drag deltas
   * used to go into a ref and the committed layout was only written on drag *end* — which meant
   * every render during a drag handed the node back its old position. That is the stutter.
   *
   * The positions live in local state during a drag and are re-synced from the store afterwards;
   * the store still only sees the finished move, so one drag is still one undo step.
   */
  const [view, setView] = useState<Node<KeelNodeData>[]>(built)
  const isDragging = useRef(false)
  useEffect(() => { if (!isDragging.current) setView(built) }, [built])

  const edges = useMemo<Edge[]>(() => (d?.edges ?? []).map((e) => {
    const id = edgeId(e)
    const lit = focus.edges.has(id)
    return {
      id, source: e.from, target: e.to, type: 'smoothstep',
      className: focus.nodes.size > 0 ? (lit ? 'lit' : 'dim') : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }
  }), [d?.edges, focus])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setView((ns) => applyNodeChanges(changes, ns) as Node<KeelNodeData>[])
    const sel = new Set(d?.selection ?? [])
    let selChanged = false
    let ended = false
    for (const c of changes) {
      if (c.type === 'position') {
        if (c.dragging) isDragging.current = true
        else ended = true
        if (c.position) dragging.current[c.id] = { x: Math.max(0, Math.round(c.position.x)), y: Math.max(0, Math.round(c.position.y)) }
      } else if (c.type === 'select') { if (c.selected) sel.add(c.id); else sel.delete(c.id); selChanged = true }
      else if (c.type === 'remove') remove(job, [c.id])
    }
    if (ended) {
      isDragging.current = false
      if (Object.keys(dragging.current).length) { move(job, dragging.current); dragging.current = {} }
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
  /** Place the new node one rank to the right of its parent, then wire it up. */
  const addAfter = useCallback((parent: string, type: string, custom?: { name: string }) => {
    const st = useDag.getState()
    const at = st.get(job).layout[parent] ?? { x: 0, y: 0 }
    const spot = { x: Math.round(at.x + NODE_W + 90), y: Math.max(0, Math.round(at.y)) }
    const id = st.add(job, type, spot)
    if (custom) {
      const t = useCustomTransforms.getState().list.find((x) => x.name === custom.name || x.displayName === custom.name)
      if (t) st.replaceNode(job, id, 'DynamicTransform', dynamicTemplate(t, t.displayName || t.name))
    }
    const why = st.connect(job, parent, id)
    if (why) flash(why)
    st.select(job, [id])
    setAddFrom(null)
  }, [job])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/keel-node')
    const customName = e.dataTransfer.getData('application/keel-custom')
    if (!type && !customName) return
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const at = { x: Math.max(0, Math.round(p.x - NODE_W / 2)), y: Math.max(0, Math.round(p.y - NODE_H / 2)) }
    if (customName) {
      const t = useCustomTransforms.getState().list.find((x) => x.name === customName); if (!t) return
      const id = add(job, 'DynamicTransform', at)
      useDag.getState().replaceNode(job, id, 'DynamicTransform', dynamicTemplate(t, t.displayName || t.name))
      return
    }
    add(job, type, at)
  }, [rf, add, job])
  // the Canvas menu is greyed out unless a canvas is actually on screen
  useEffect(() => { window.keel.setCanvasOpen(true); return () => window.keel.setCanvasOpen(false) }, [])
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
    else if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); duplicate() }
    else if (e.key === 'Escape' && (d?.selection.length ?? 0) > 0) { e.preventDefault(); select(job, []) }
  }
  // fitView at mount sees no nodes (they load async) and, since the split panes size themselves
  // from a ResizeObserver, it can also see a box that is about to change. Fit once, when both the
  // nodes and a settled box are actually there — a timer here fits to whatever happens to exist.
  const fitted = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el || fitted.current || built.length === 0) return
    let raf = 0
    const tryFit = () => {
      if (fitted.current || el.clientWidth < 80 || el.clientHeight < 80) return
      fitted.current = true
      // fitView resizes things; doing that inside the observer callback re-enters it
      raf = requestAnimationFrame(async () => {
        await rf.fitView({ padding: 0.2 })
        // fitViewOptions.minZoom is not honoured here, so clamp it ourselves: a long pipeline
        // fitted into a 500px pane lands near 30%, where no card is legible.
        if (rf.getZoom() >= READABLE) return
        // Too wide to fit and stay readable, so open at the *start* of the pipeline rather than
        // centred on it — centring cuts off both ends and hides where the data comes from.
        const ns = rf.getNodes()
        if (!ns.length) { await rf.zoomTo(READABLE); return }
        const minX = Math.min(...ns.map((n) => n.position.x))
        const ys = ns.map((n) => n.position.y + (n.measured?.height ?? NODE_H) / 2)
        const midY = (Math.min(...ys) + Math.max(...ys)) / 2
        rf.setViewport({ zoom: READABLE, x: 48 - minX * READABLE, y: el.clientHeight / 2 - midY * READABLE })
      })
    }
    const ro = new ResizeObserver(tryFit)
    ro.observe(el)
    tryFit()
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [built.length, rf])
  const sel = d?.selection ?? []
  const zoom = useStore((s) => s.transform[2])
  const duplicate = useCallback(() => {
    const st = useDag.getState(); const g = st.get(job)
    const id = g.selection[0]; if (!id) return
    const n = g.nodes.find((x) => x.id === id); if (!n) return
    const at = g.layout[id] ?? { x: 0, y: 0 }
    const copy = st.add(job, n.type, { x: at.x + 40, y: at.y + NODE_H + 40 })
    const body = { ...(g.raw[id]?.[n.type] ?? {}), Name: `${n.name} copy`, Inputs: [] }
    st.replaceNode(job, copy, n.type, body)
    st.select(job, [copy])
  }, [job])
  return (
    <div ref={box} style={{ height: '100%', position: 'relative' }} onKeyDown={onKey} tabIndex={0}>
      <ReactFlow nodes={view} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onConnect={onConnect} isValidConnection={isValid}
        onEdgesDelete={(es) => es.forEach((e) => useDag.getState().disconnect(job, e.source, e.target))}
        onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        minZoom={0.15} maxZoom={3} deleteKeyCode={['Backspace', 'Delete']} multiSelectionKeyCode={['Meta', 'Shift']}
        panOnDrag panOnScroll selectionKeyCode="Shift" nodeDragThreshold={2} elevateNodesOnSelect
        proOptions={{ hideAttribution: true }} colorMode="system">
        <Background gap={22} size={1} />
        {built.length >= 6 && <MiniMap pannable zoomable nodeStrokeWidth={2} ariaLabel="Graph overview" />}
      </ReactFlow>

      {/* view controls: what you do TO the canvas, kept apart from what you do to a node */}
      <div className="canvas-toolbar row" style={{ left: toolbarOffset }}>
        <button className="quiet" onClick={() => { relayout(job); setTimeout(() => void rf.fitView({ padding: 0.25 }).then(() => rf.getZoom() < READABLE && rf.zoomTo(READABLE)), 60) }} title="Lay the graph out left to right (⌘⇧L)"><Icon name="layout" />Tidy</button>
        <button className="quiet" onClick={() => void rf.fitView({ padding: 0.25 })} title="Fit the whole graph (⌘0)"><Icon name="fit" />Fit</button>
        <span className="canvas-sep" />
        <button className="quiet" aria-label="Zoom out" title="Zoom out (⌘−)" onClick={() => void rf.zoomOut()}><Icon name="minus" size={13} /></button>
        <button className="quiet zoom-pct" title="Reset to 100%" onClick={() => void rf.zoomTo(1)}>{Math.round(zoom * 100)}%</button>
        <button className="quiet" aria-label="Zoom in" title="Zoom in (⌘=)" onClick={() => void rf.zoomIn()}><Icon name="plus" size={13} /></button>
        {problems.length > 0 && <>
          <span className="canvas-sep" />
          <button className={'quiet' + (showProblems ? ' on' : '')} onClick={() => setShowProblems(!showProblems)}
            title="Traps this DAG holds that no error message will name">
            <Icon name={problems.some((p) => p.level === 'warn') ? 'warn' : 'info'} />{problems.length} problem{problems.length > 1 ? 's' : ''}
          </button></>}
      </div>

      {/* selection actions ride with the selection, not with the view controls */}
      {sel.length > 0 && (
        <div className="canvas-selbar row">
          <span className="small">{sel.length === 1 ? (d?.nodes.find((n) => n.id === sel[0])?.name ?? '1 node') : `${sel.length} nodes`}</span>
          <span className="canvas-sep" />
          {sel.length === 1 && <button className="quiet" title="Centre the canvas on it" onClick={() => void rf.fitView({ padding: 0.6, nodes: [{ id: sel[0]! }] })}><Icon name="fit" size={12} />Focus</button>}
          {sel.length === 1 && <button className="quiet" title="Duplicate it (⌘D)" onClick={() => duplicate()}><Icon name="copy" size={12} />Duplicate</button>}
          <button className="quiet danger" onClick={() => remove(job, sel)}><Icon name="trash" size={12} />Delete</button>
          <button className="quiet" aria-label="Clear the selection" title="Clear the selection (Esc)" onClick={() => select(job, [])}><Icon name="x" size={12} /></button>
        </div>)}

      {/* the palette, opened from a node's output — it adds AND connects */}
      {addFrom && (
        <>
          <div className="canvas-scrim" onClick={() => setAddFrom(null)} />
          <div className="popover canvas-add" style={{ width: 250, maxHeight: '72%' }}>
            <div className="panel-head"><span className="eyebrow">After {d?.nodes.find((n) => n.id === addFrom.id)?.name}</span><span className="fill" />
              <button className="quiet" aria-label="Close" onClick={() => setAddFrom(null)}><Icon name="x" size={12} /></button></div>
            <Palette job={job} onPick={(type, customName) => addAfter(addFrom.id, type, customName ? { name: customName } : undefined)} />
          </div>
        </>)}
      {showProblems && problems.length > 0 && (
        <div className="problems">
          {problems.map((f, i) => (
            <div key={f.rule + i} className="row" style={{ gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
              <Icon name={f.level === 'warn' ? 'warn' : 'info'} size={13} style={{ color: f.level === 'warn' ? 'var(--warn)' : 'var(--faint)', marginTop: 2 }} />
              <div className="fill">
                <div>{f.message}</div>
                <div className="dim small" style={{ marginTop: 2 }}>{f.fix}</div>
              </div>
              {f.node && <button className="quiet" onClick={() => select(job, [f.node!])}>Show</button>}
            </div>))}
        </div>)}
      {d?.conflict && <div className="canvas-banner"><span>{d.conflict}</span><button onClick={() => void useDag.getState().load(job)}>Reload</button></div>}
      {toast && <div className="canvas-toast">{toast}</div>}
      {d && d.nodes.length === 0 && (
        <div className="canvas-empty">
          <b>No nodes yet</b>
          <span>Add a source with <b>Add node</b>, then extend it with the <b>+</b> on the right of each card.<br />Or describe the pipeline to the agent and let it draw one.</span>
        </div>)}
    </div>
  )
}

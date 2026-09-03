import { useEffect, useRef, useState } from 'react'
import { useDag } from '@/dag/store'
import { DagEditor } from '@/dag/DagEditor'
import { Palette } from '@/dag/Palette'
import { NodePanel, PreviewPanel } from '@/dag/NodePanel'
import { useAuthoring } from './store'
import { CodePane } from './CodePane'
import { TestsPane } from './TestsPane'
import { LocalRunPane } from './LocalRunPane'
import { SplitPane } from '@/shell/SplitPane'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { ChatRail } from '@/chat/ChatRail'
import { Seg } from '@/shell/Seg'
import { DiffView } from '@/shell/DiffView'
import { useEscape } from '@/shell/useEscape'
import { useGlue } from '@/stores/glue'
import { useLanes } from '@/stores/lanes'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'

type Pane = 'code' | 'tests' | 'local' | 'preview' | 'diff'

export function AuthoringTab({ job }: { job: string }) {
  const d = useDag((s) => s.jobs[job])
  const a = useAuthoring((s) => s.jobs[job])
  const { load } = useDag()
  const { refresh } = useAuthoring()
  const glueJob = useGlue((s) => s.jobs.find((j) => j.name === job))
  const importIt = async () => { await api.post(`/api/jobs/${encodeURIComponent(job)}/import`, {}, `importing ${job}`); await api.post(`/api/jobs/${encodeURIComponent(job)}/lane`, {}, 'the lane'); await load(job); await refresh(job) }
  const createDraft = async () => { await api.post(`/api/jobs/${encodeURIComponent(job)}/lane`, {}, 'the lane'); await api.put(`/api/jobs/${encodeURIComponent(job)}/dag`, { dag: {}, layout: {} }, 'the empty DAG'); await load(job); await refresh(job) }
  const [pane, setPane] = useState<Pane>('code')
  const [palette, setPalette] = useState(false)
  const [chat, setChat] = useState(() => { try { return localStorage.getItem('authoring.chat.open') !== '0' } catch { return true } })
  const showChat = (v: boolean) => { setChat(v); try { localStorage.setItem('authoring.chat.open', v ? '1' : '0') } catch { /* ignore */ } }
  const addBtn = useRef<HTMLButtonElement>(null)
  useEscape(palette, () => { setPalette(false); addBtn.current?.focus() })
  useEffect(() => { if (!d?.loaded) void load(job); if (!a?.loaded) void refresh(job) }, [job, d?.loaded, a?.loaded, load, refresh])
  const selected = d?.selection.length === 1 ? d.selection[0] : undefined
  const range = selected ? a?.ranges[selected] : undefined
  const selNode = selected ? d?.nodes.find((n) => n.id === selected) : undefined
  const testNode = selNode ? snakeName(selNode.name) : undefined
  // Preview only means something with a node selected; fall back rather than show an empty pane.
  const shown: Pane = pane === 'preview' && !selNode ? 'code' : pane

  const canvas = (
    <div style={{ position: 'relative', height: '100%', minWidth: 0 }}>
      <button ref={addBtn} className="primary" style={{ position: 'absolute', top: 8, left: 8, zIndex: 9 }}
        aria-expanded={palette} onClick={() => setPalette(!palette)} title="Sources, transforms and targets"><Icon name="plus" />Add node</button>
      {!chat && (
        <button className="quiet canvas-chat-open" onClick={() => showChat(true)} title="Show the agent">
          <Icon name="debug" size={13} />Agent
        </button>)}
      {palette && (
        /* a popover, not a column: the palette costs the canvas no width */
        <div className="popover" style={{ top: 44, left: 8, width: 236, maxHeight: 'calc(100% - 56px)' }}>
          <div className="panel-head"><span className="eyebrow">Add node</span><span className="fill" />
            <button className="quiet" aria-label="Close the node palette" onClick={() => { setPalette(false); addBtn.current?.focus() }}><Icon name="x" size={12} /></button></div>
          {/* adding closes the popover and selects the new node, so its properties are right there */}
          <Palette job={job} onAdded={(id) => { setPalette(false); useDag.getState().select(job, [id]) }} />
        </div>)}
      <DagEditor job={job} toolbarOffset={112} />
    </div>)

  const middle = (
    <SplitPane vertical storageKey="authoring.code" initial={0.66} min={260} minB={150}
      a={selected
        // the canvas keeps a 360px floor; below that the inspector overlays instead of squeezing it
        ? <SplitPane storageKey="authoring.inspector" initial={0.72} min={360} minB={320} canOverlay
            a={canvas} b={<div className="panel" style={{ height: '100%', borderRight: 'none', borderLeft: '1px solid var(--line)' }}><NodePanel job={job} /></div>} />
        : canvas}
      b={<div className="col" style={{ height: '100%' }}>
        <div className="seg-bar">
          <Seg label="Generated output" value={shown} onChange={setPane}
            options={([['code', 'Code'], ['tests', 'Tests'], ['local', 'Local run'], ['diff', 'Changes'], ...(selNode ? [['preview', 'Data preview'] as const] : [])] as const)} />
          <span className="faint small">{selNode ? selNode.name : 'whole pipeline'}</span>
          <span className="fill" />
        </div>
        <div className="fill" style={{ minHeight: 0 }}>
          {shown === 'code'
            ? (a?.script ? <CodePane code={a.script} range={range} /> : <EmptyState title="No job.py yet">Add nodes and press Generate, or let the agent build it.</EmptyState>)
            : shown === 'tests' ? <TestsPane job={job} node={testNode} />
            : shown === 'diff' ? <DiffView job={job} />
            : shown === 'preview' && selNode ? <PreviewPanel job={job} id={selNode.id} name={selNode.name} type={selNode.type} />
            : <LocalRunPane job={job} />}
        </div>
      </div>} />
  )

  if (d?.failure && !d.imported) return (
    <EmptyState title={glueJob ? `${job} is not imported yet` : `${job} does not exist here`}
      actions={<>
        {glueJob && <button className="primary" onClick={() => void importIt()}>Import from AWS</button>}
        <button onClick={() => void createDraft()}>Start an empty draft</button>
        <button className="quiet" onClick={() => useLanes.getState().close(job)}>Close tab</button>
      </>}>
      {glueJob ? 'Bring its definition and DAG into this project on its own branch, then edit it here.' : 'It is neither a Glue job in this account nor a folder in this project.'}
    </EmptyState>)
  if (d?.failure) return <FaultState fault={d.failure} retry={() => void load(job)} />
  if (!chat) return middle
  return (
    <SplitPane storageKey="authoring.chat" initial={0.74} min={520} minB={320}
      a={middle}
      b={<div className="col" style={{ height: '100%' }}>
        <div className="row" style={{ padding: '4px 6px 0', justifyContent: 'flex-end' }}>
          <button className="quiet micro" onClick={() => showChat(false)} title="Give the canvas the space">
            <Icon name="chevron" size={12} />Hide agent
          </button>
        </div>
        <div className="fill" style={{ minHeight: 0 }}>
          <ChatRail job={job} mode="author" placeholder="Describe the pipeline…" composerOnTop />
        </div>
      </div>} />
  )
}

/** Same rule as the daemon's Dag.snake, so the tests pane can find test_<node>.py. */
export function snakeName(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!s || /^[0-9]/.test(s)) s = 'n_' + s
  const reserved = new Set(['false', 'none', 'true', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'main', 'spark', 'sc', 'job', 'args', 'gluecontext', 're', 'f', 'sys', 'dynamicframe', 'dynamicframecollection'])
  if (reserved.has(s)) s += '_'
  return s
}

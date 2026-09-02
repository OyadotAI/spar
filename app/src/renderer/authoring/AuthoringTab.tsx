import { useEffect, useState } from 'react'
import { useDag } from '@/dag/store'
import { DagEditor } from '@/dag/DagEditor'
import { Palette } from '@/dag/Palette'
import { NodePanel } from '@/dag/NodePanel'
import { useAuthoring } from './store'
import { CodePane } from './CodePane'
import { TestsPane } from './TestsPane'
import { LocalRunPane } from './LocalRunPane'
import { SplitPane } from '@/shell/SplitPane'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { ChatRail } from '@/chat/ChatRail'
import { useGlue } from '@/stores/glue'
import { useLanes } from '@/stores/lanes'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'

export function AuthoringTab({ job }: { job: string }) {
  const d = useDag((s) => s.jobs[job])
  const a = useAuthoring((s) => s.jobs[job])
  const { load } = useDag()
  const { refresh } = useAuthoring()
  const glueJob = useGlue((s) => s.jobs.find((j) => j.name === job))
  const importIt = async () => { await api.post(`/api/jobs/${encodeURIComponent(job)}/import`, {}, `importing ${job}`); await api.post(`/api/jobs/${encodeURIComponent(job)}/lane`, {}, 'the lane'); await load(job); await refresh(job) }
  const createDraft = async () => { await api.post(`/api/jobs/${encodeURIComponent(job)}/lane`, {}, 'the lane'); await api.put(`/api/jobs/${encodeURIComponent(job)}/dag`, { dag: {}, layout: {} }, 'the empty DAG'); await load(job); await refresh(job) }
  const [pane, setPane] = useState<'code' | 'tests' | 'local'>('code')
  const [palette, setPalette] = useState(false)
  useEffect(() => { if (!d?.loaded) void load(job); if (!a?.loaded) void refresh(job) }, [job, d?.loaded, a?.loaded, load, refresh])
  const selected = d?.selection.length === 1 ? d.selection[0] : undefined
  const snake = selected && a?.ranges ? undefined : undefined
  void snake
  const range = selected ? a?.ranges[selected] : undefined
  const selNode = selected ? d?.nodes.find((n) => n.id === selected) : undefined
  const testNode = selNode ? snakeName(selNode.name) : undefined
  const middle = (
    <SplitPane vertical storageKey="authoring.code" initial={Math.max(300, window.innerHeight * 0.5)} min={200} minB={160}
      a={<div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch', position: 'relative' }}>
        {palette && <div className="panel" style={{ width: 220, flex: 'none', overflow: 'auto' }}>
          <div className="panel-head"><span className="eyebrow">Add node</span><span className="fill" /><button className="quiet" onClick={() => setPalette(false)}><Icon name="x" size={12} /></button></div>
          <Palette job={job} /></div>}
        <div className="fill" style={{ position: 'relative' }}>
          {!palette && <button className="primary" style={{ position: 'absolute', top: 8, left: 8, zIndex: 6 }} onClick={() => setPalette(true)} title="Sources, transforms and targets"><Icon name="plus" />Add node</button>}
          <DagEditor job={job} toolbarOffset={palette ? 8 : 112} />
        </div>
        {selected && <div className="panel" style={{ width: 340, flex: 'none', borderRight: 'none', borderLeft: '1px solid var(--line)' }}><NodePanel job={job} /></div>}
      </div>}
      b={<div className="col" style={{ height: '100%' }}>
        <div className="row subtabs" style={{ borderBottom: '1px solid var(--line)', padding: '0 12px', height: 30, background: 'var(--surface)' }}>
          <button className={'tabbtn' + (pane === 'code' ? ' on' : '')} onClick={() => setPane('code')}>Code</button>
          <button className={'tabbtn' + (pane === 'tests' ? ' on' : '')} onClick={() => setPane('tests')}>Tests</button>
          <button className={'tabbtn' + (pane === 'local' ? ' on' : '')} onClick={() => setPane('local')} title="Run the whole pipeline here, against local samples">Local run</button>
          <span className="faint small">{selNode ? selNode.name : 'whole pipeline'}</span>
          <span className="fill" />
          {a?.message && <span className="dim" style={{ fontSize: 12 }}>{a.message}</span>}
          <button className="quiet" disabled={!!a?.busy || !d?.nodes.length} onClick={() => void useAuthoring.getState().generate(job)} title="dag.json → job.py + test scaffolds"><Icon name="refresh" />{a?.busy === 'generating' ? 'Generating…' : 'Generate'}</button>
        </div>
        <div className="fill" style={{ minHeight: 0 }}>
          {pane === 'code'
            ? (a?.script ? <CodePane code={a.script} range={range} /> : <div className="faint" style={{ padding: 12 }}>No job.py yet. Add nodes and press Generate, or let the agent build it.</div>)
            : pane === 'tests' ? <TestsPane job={job} node={testNode} />
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
  return (
    <SplitPane storageKey="authoring.chat" initial={Math.max(600, window.innerWidth - 440)} min={480} minB={320}
      a={middle}
      b={<ChatRail job={job} mode="author" placeholder="Describe the pipeline…" composerOnTop />} />
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

import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useAuthoring } from '@/authoring/store'
import { useDag } from '@/dag/store'
import { CodePane } from '@/authoring/CodePane'
import { ChatRail } from '@/chat/ChatRail'
import { DiffView } from '@/shell/DiffView'
import { SplitPane } from '@/shell/SplitPane'
import { Seg } from '@/shell/Seg'
import { EmptyState } from '@/shell/EmptyState'
import { Icon } from '@/shell/Icon'

/**
 * The generated script, with the agent beside it.
 *
 * This tab used to be a read-only file. The agent that can actually change the script lived only
 * on the Visual tab, so the one screen showing the code had no way to act on it — and no way to
 * see what a turn had done. Both are here now: ask on the right, review the diff on the left.
 */
export function ScriptTab({ job }: { job: string }) {
  const a = useAuthoring((s) => s.jobs[job])
  const d = useDag((s) => s.jobs[job])
  const { refresh } = useAuthoring()
  const [remote, setRemote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pane, setPane] = useState<'code' | 'diff'>('code')
  useEffect(() => { if (!a?.loaded) void refresh(job) }, [job, a?.loaded, refresh])
  const local = a?.script
  const pull = async () => {
    setBusy(true)
    const r = await api.post<{ written: string[] }>(`/api/jobs/${encodeURIComponent(job)}/import?overwrite=true`, {}, 'importing the script')
    setBusy(false)
    if (r.ok) { setRemote(null); await refresh(job) }
  }

  const left = local ? (
    <div className="col" style={{ height: '100%' }}>
      <div className="seg-bar">
        <Seg label="Script view" value={pane} onChange={setPane} options={[['code', 'Code'], ['diff', 'Changes']] as const} />
        <span className="mono dim micro">jobs/{job}/job.py</span>
        <span className="faint micro">· generated from dag.json{d?.nodes.length ? ` (${d.nodes.length} nodes)` : ''}</span>
        <span className="fill" />
        <button className="quiet" onClick={() => void navigator.clipboard.writeText(local)}><Icon name="copy" />Copy</button>
        <button className="quiet" onClick={() => void window.keel.saveText(`${job}.py`, local)}><Icon name="download" />Save as…</button>
      </div>
      <div className="fill" style={{ minHeight: 0 }}>
        {pane === 'code'
          ? <CodePane code={local} />
          : <DiffView job={job} empty="Nothing has changed since the last commit. Ask the agent on the right to edit the pipeline and its work shows up here." />}
      </div>
    </div>
  ) : (
    <EmptyState title="No local script yet" actions={<button className="primary" disabled={busy} onClick={() => void pull()}><Icon name="download" />{busy ? 'Importing…' : 'Import from AWS'}</button>}>
      {remote ?? 'Import the job to bring its script (and DAG, if it has one) into this project. A visual job regenerates job.py from dag.json.'}
    </EmptyState>)

  return (
    <SplitPane storageKey="script.chat" initial={0.72} min={420} minB={320}
      a={left}
      b={<ChatRail job={job} mode="author" placeholder="Ask for a change to this pipeline…" />} />
  )
}

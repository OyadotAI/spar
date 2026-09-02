import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useAuthoring } from '@/authoring/store'
import { useDag } from '@/dag/store'
import { CodePane } from '@/authoring/CodePane'
import { EmptyState } from '@/shell/EmptyState'
import { Icon } from '@/shell/Icon'

/** Glue Studio's Script tab: the generated job.py for a local job, or the deployed script from S3 for one that only lives in AWS. */
export function ScriptTab({ job }: { job: string }) {
  const a = useAuthoring((s) => s.jobs[job])
  const d = useDag((s) => s.jobs[job])
  const { refresh } = useAuthoring()
  const [remote, setRemote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!a?.loaded) void refresh(job) }, [job, a?.loaded, refresh])
  const local = a?.script
  const pull = async () => {
    setBusy(true)
    const r = await api.post<{ written: string[] }>(`/api/jobs/${encodeURIComponent(job)}/import?overwrite=true`, {}, 'importing the script')
    setBusy(false)
    if (r.ok) { setRemote(null); await refresh(job) }
  }
  if (local) return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row subtabs" style={{ padding: '0 12px', height: 32, borderBottom: '1px solid var(--line)', background: 'var(--surface)', flex: 'none' }}>
        <span className="mono dim small">jobs/{job}/job.py</span><span className="faint small">· generated from dag.json{d?.nodes.length ? ` (${d.nodes.length} nodes)` : ''}</span>
        <span className="fill" />
        <button className="quiet" onClick={() => void navigator.clipboard.writeText(local)}><Icon name="copy" />Copy</button>
        <button className="quiet" onClick={() => void window.keel.saveText(`${job}.py`, local)}><Icon name="download" />Save as…</button>
      </div>
      <div className="fill"><CodePane code={local} /></div>
    </div>)
  return (
    <EmptyState title="No local script yet" actions={<button className="primary" disabled={busy} onClick={() => void pull()}><Icon name="download" />{busy ? 'Importing…' : 'Import from AWS'}</button>}>
      {remote ?? 'Import the job to bring its script (and DAG, if it has one) into this project. A visual job regenerates job.py from dag.json.'}
    </EmptyState>)
}

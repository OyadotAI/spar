import { useEffect, useState } from 'react'
import { api, type Fault } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useChat } from '@/stores/chat'
import { useLanes } from '@/stores/lanes'
import type { UpgradeReply } from '@/wire/types'

const TONE: Record<string, string> = { error: 'var(--del)', warn: 'var(--warn)', info: 'var(--dim)', ok: 'var(--add)' }
const ICON: Record<string, string> = { error: 'bad', warn: 'warn', info: 'info', ok: 'ok' }

/** Keel's upgrade analysis: the migration rules applied to this job, and an agent turn that fixes them. */
export function UpgradeTab({ job }: { job: string }) {
  const [u, setU] = useState<UpgradeReply | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const send = useChat((s) => s.send)
  const setTab = useLanes((s) => s.setTab)
  const load = async () => { const r = await api.get<UpgradeReply>(`/api/jobs/${encodeURIComponent(job)}/upgrade`, 'the upgrade analysis'); if (r.ok) { setU(r.value); setFault(null) } else setFault(r.fault) }
  useEffect(() => { void load() }, [job]) // eslint-disable-line react-hooks/exhaustive-deps
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!u) return <EmptyState title="Analysing…" />
  const ask = () => { send(job, 'author', u.prompt, undefined, 'acceptEdits'); setTab(job, 'authoring') }
  return (
    <div className="details" style={{ overflow: 'auto', height: '100%', maxWidth: 900 }}>
      <div className="row" style={{ marginBottom: 8 }}><h1 style={{ margin: 0 }}>Upgrade analysis</h1><span className="fill" />
        <button className="quiet" onClick={() => void load()}><Icon name="refresh" />Re-analyse</button>
        <button className="primary" onClick={ask}><Icon name="magic" />Ask the agent to upgrade it</button></div>
      <div className="facts" style={{ padding: 0, marginBottom: 12 }}>
        <div className="fact"><span className="eyebrow">Glue version</span><span className="v">{u.glueVersion || '—'} → {u.target}</span></div>
        <div className="fact"><span className="eyebrow">Worker</span><span className="v">{u.workerType || '—'}</span></div>
        <div className="fact"><span className="eyebrow">Errors</span><span className="v" style={{ color: u.counts.error ? 'var(--del)' : undefined }}>{u.counts.error ?? 0}</span></div>
        <div className="fact"><span className="eyebrow">Warnings</span><span className="v" style={{ color: u.counts.warn ? 'var(--warn)' : undefined }}>{u.counts.warn ?? 0}</span></div>
        <div className="fact"><span className="eyebrow">Notes</span><span className="v">{u.counts.info ?? 0}</span></div>
      </div>
      {!u.hasScript && <p className="dim">No script to read — import the job first, or generate one from the DAG.</p>}
      {u.findings.map((f, i) => (
        <div key={i} className="card row" style={{ padding: '10px 14px', marginBottom: 6, alignItems: 'flex-start' }}>
          <Icon name={ICON[f.severity] ?? 'info'} style={{ color: TONE[f.severity], marginTop: 2 }} />
          <div className="fill">
            <div className="row" style={{ gap: 8 }}><b>{f.title}</b>{f.file && f.line ? <span className="faint mono small">{f.file.replace(/^s3:\/\/[^/]+\//, '')}:{f.line}</span> : null}</div>
            <div className="dim small">{f.detail}</div>
          </div>
        </div>))}
      <p className="faint small" style={{ marginTop: 16 }}>{u.note}</p>
    </div>
  )
}

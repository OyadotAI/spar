import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { onEvent } from '@/events'
import { Icon } from './Icon'
import { prompt } from './Prompt'
import { tell } from './Toast'

type Git = { branch?: string; head?: string; dirty: { status: string; path: string }[] }
const cache = new Map<string, Git>()

function useGit(job: string): [Git | null, () => Promise<void>] {
  const [g, setG] = useState<Git | null>(cache.get(job) ?? null)
  const load = async () => { const r = await api.get<Git>(`/api/jobs/${encodeURIComponent(job)}/git`, 'git status'); if (r.ok) { cache.set(job, r.value); setG(r.value) } }
  useEffect(() => { void load(); return onEvent((k, d) => { if ((k === 'git.changed' && (d as { lane?: string })?.lane === job) || k === 'connected' || (k === 'job.changed' && (d as { name?: string })?.name === job)) void load() }) }, [job]) // eslint-disable-line react-hooks/exhaustive-deps
  return [g, load]
}

/** One line about the job's lane: its branch, what is uncommitted, and a Commit button. */
export function GitBar({ job }: { job: string }) {
  const [g, load] = useGit(job)
  const [busy, setBusy] = useState(false)
  if (!g?.branch) return null
  const commit = async () => {
    const message = await prompt({ title: `Commit ${g.dirty.length} change${g.dirty.length > 1 ? 's' : ''}`, body: `On ${g.branch}. Everything uncommitted in this job's worktree.`, value: `keel: ${job}`, confirmLabel: 'Commit' })
    if (message === null) return
    setBusy(true)
    await tell('commit', api.post<{ commit: string | null }>(`/api/jobs/${encodeURIComponent(job)}/commit`, { message }, 'the commit'), 'Committed')
    setBusy(false); void load()
  }
  return (
    <span className="row dim small" style={{ gap: 6, marginLeft: 8 }} title={g.dirty.map((d) => `${d.status} ${d.path}`).join('\n')}>
      <Icon name="git" size={12} style={{ color: 'var(--faint)' }} /><span>{g.branch}</span>
      {g.head && <span className="fig faint">{g.head}</span>}
      {g.dirty.length > 0 ? <><span className="fig" style={{ color: 'var(--warn)' }}>{g.dirty.length} changed</span><button className="quiet" disabled={busy} onClick={() => void commit()}>Commit</button></> : <span className="faint">clean</span>}
    </span>
  )
}

export function ChangesPanel({ job }: { job: string }) {
  const [g] = useGit(job)
  if (!g) return <div className="faint small" style={{ padding: 12 }}>Reading…</div>
  if (!g.dirty.length) return <div className="faint small" style={{ padding: 12 }}>Nothing uncommitted on {g.branch}.</div>
  return <div style={{ padding: '4px 0' }}>{g.dirty.map((d) => (
    <div key={d.path} className="panel-row" title={d.path}>
      <span className="fig" style={{ width: 18, color: d.status.includes('?') ? 'var(--add)' : d.status.includes('D') ? 'var(--del)' : 'var(--warn)' }}>{d.status || 'M'}</span>
      <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.path.replace(/^jobs\/[^/]+\//, '')}</span>
    </div>))}</div>
}

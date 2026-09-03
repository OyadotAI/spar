import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { onEvent } from '@/events'
import { Icon } from './Icon'
import { prompt } from './Prompt'
import { tell } from './Toast'
import { EmptyState } from './EmptyState'
import { DiffView } from './DiffView'

type Git = { branch?: string; head?: string; dirty: { status: string; path: string }[] }
const cache = new Map<string, Git>()

function useGit(job: string): [Git | null, () => Promise<void>] {
  const [g, setG] = useState<Git | null>(cache.get(job) ?? null)
  const load = async () => { const r = await api.get<Git>(`/api/jobs/${encodeURIComponent(job)}/git`, 'git status'); if (r.ok) { cache.set(job, r.value); setG(r.value) } }
  useEffect(() => { void load(); return onEvent((k, d) => { if ((k === 'git.changed' && (d as { lane?: string })?.lane === job) || k === 'connected' || (k === 'job.changed' && (d as { name?: string })?.name === job)) void load() }) }, [job]) // eslint-disable-line react-hooks/exhaustive-deps
  return [g, load]
}

/**
 * One control, not four. The branch and the uncommitted count used to sit in the middle of the
 * action bar as separate elements with a Commit button wedged between navigation and actions;
 * now it is a single pill that opens the Changes section, where committing belongs.
 */
export function GitPill({ job, onOpen }: { job: string; onOpen: () => void }) {
  const [g] = useGit(job)
  if (!g?.branch) return null
  const n = g.dirty.length
  return (
    <button className={'pill' + (n ? ' warn' : '')} onClick={onOpen}
      title={n ? `${n} uncommitted in this job's worktree — open Changes` : `${g.branch} is clean`}>
      <Icon name="git" size={11} />{g.branch}{n > 0 && <> · {n}</>}
    </button>
  )
}

/** The Changes section: what is uncommitted on this job's branch, and the one button that commits it. */
export function ChangesPanel({ job }: { job: string }) {
  const [g, load] = useGit(job)
  const [busy, setBusy] = useState(false)
  if (!g) return <EmptyState title="Reading the worktree…" />
  const commit = async () => {
    const message = await prompt({ title: `Commit ${g.dirty.length} change${g.dirty.length > 1 ? 's' : ''}`, body: `On ${g.branch}. Everything uncommitted in this job's worktree.`, value: `keel: ${job}`, confirmLabel: 'Commit' })
    if (message === null) return
    setBusy(true)
    await tell('commit', api.post<{ commit: string | null }>(`/api/jobs/${encodeURIComponent(job)}/commit`, { message }, 'the commit'), 'Committed')
    setBusy(false); void load()
  }
  if (!g.dirty.length) return <EmptyState title="Nothing uncommitted">Everything in this job's worktree is committed on <code>{g.branch}</code>.</EmptyState>
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="seg-bar">
        <span className="eyebrow">{g.dirty.length} uncommitted on {g.branch}</span>
        <span className="fill" />
        <button className="primary" disabled={busy} onClick={() => void commit()}><Icon name="commit" />{busy ? 'Committing…' : 'Commit'}</button>
      </div>
      <div className="fill" style={{ minHeight: 0 }}><DiffView job={job} /></div>
    </div>
  )
}

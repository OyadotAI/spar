import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { onEvent } from '@/events'
import { Icon } from './Icon'
import { EmptyState } from './EmptyState'
import { parseDiff, totals, type FileDiff } from './diff'

const STATUS: Record<FileDiff['status'], string> = { added: 'new', deleted: 'deleted', renamed: 'renamed', modified: 'changed' }

/**
 * What the agent changed, in review form.
 *
 * The agent edits files in the job's worktree and commits at the end of a turn, but until now the
 * only sign of that was a count of dirty paths in a pill. This is the diff itself — so a turn can
 * be read before it is kept, which is the whole point of running the agent on a branch.
 */
export function DiffView({ job, path, empty }: { job: string; path?: string; empty?: string }) {
  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await api.get<{ diff: string }>(`/api/jobs/${encodeURIComponent(job)}/diff${path ? `?path=${encodeURIComponent(path)}` : ''}`, 'the diff')
    if (r.ok) { setFiles(parseDiff(r.value.diff)); setErr(null) } else { setFiles([]); setErr(r.fault.why) }
  }, [job, path])
  // a turn ends by writing files and committing; both land as events
  useEffect(() => {
    void load()
    return onEvent((k, d) => {
      if (k === 'git.changed' && (d as { lane?: string })?.lane === job) void load()
      else if (k === 'job.changed' && (d as { name?: string })?.name === job) void load()
    })
  }, [job, load])

  if (files === null) return <EmptyState title="Reading the diff…" />
  if (err) return <EmptyState title="Could not read the diff">{err}</EmptyState>
  if (files.length === 0) {
    return (
      <EmptyState title="Nothing uncommitted">
        {empty ?? 'When the agent edits this job, every change it makes shows up here before it is committed.'}
      </EmptyState>)
  }
  const t = totals(files)
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="seg-bar">
        <span className="eyebrow">{files.length} file{files.length > 1 ? 's' : ''}</span>
        <span className="diff-stat"><span className="add">+{t.adds}</span> <span className="del">−{t.dels}</span></span>
        <span className="fill" />
        <button className="quiet micro" onClick={() => void load()}><Icon name="refresh" size={12} />Refresh</button>
      </div>
      <div className="fill diff-scroll">
        {files.map((f) => <FileBlock key={f.path} f={f} />)}
      </div>
    </div>
  )
}

function FileBlock({ f }: { f: FileDiff }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="diff-file">
      <button className="diff-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chevron" size={12} style={{ transform: open ? 'rotate(90deg)' : undefined, color: 'var(--faint)' }} />
        <span className="mono fill" title={f.old && f.old !== f.path ? `was ${f.old}` : f.path}>{f.path}</span>
        <span className={'pill micro ' + (f.status === 'added' ? 'ok' : f.status === 'deleted' ? 'err' : '')}>{STATUS[f.status]}</span>
        <span className="diff-stat"><span className="add">+{f.adds}</span> <span className="del">−{f.dels}</span></span>
      </button>
      {open && (f.binary
        ? <div className="faint small" style={{ padding: 'var(--s2) var(--s3)' }}>Binary file — not shown.</div>
        : <table className="diff"><tbody>
            {f.lines.map((l, i) => (
              <tr key={i} className={l.kind}>
                {l.kind === 'hunk'
                  ? <td className="diff-hunk" colSpan={3}>{l.text || '…'}</td>
                  : <>
                      <td className="diff-n">{l.a ?? ''}</td>
                      <td className="diff-n">{l.b ?? ''}</td>
                      <td className="diff-t"><span className="diff-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>{l.text || ' '}</td>
                    </>}
              </tr>))}
          </tbody></table>)}
    </div>
  )
}

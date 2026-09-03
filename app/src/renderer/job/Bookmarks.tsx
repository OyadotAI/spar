import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { confirm } from '@/shell/Confirm'
import { tell } from '@/shell/Toast'

type Cloud = { none?: boolean; version?: number; run?: number; attempt?: number; runId?: string; bookmark?: string }
type Local = { simulated: boolean; empty: boolean; state: Record<string, string[] | string> }

/**
 * The bookmark, made legible.
 *
 * "AWS Glue job bookmarking details are not available for customers", so what Glue does hand back —
 * a version, a run number and an opaque cursor — is all there is, and it is shown as-is rather than
 * interpreted into something that sounds more certain than it is. The local simulation sits beside
 * it, labelled, and the reset says what reprocessing means before it happens.
 */
export function Bookmarks({ job, enabled }: { job: string; enabled: boolean }) {
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [local, setLocal] = useState<Local | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const [c, l] = await Promise.all([
      api.get<Cloud>(`/api/glue/jobs/${encodeURIComponent(job)}/bookmark`, 'the bookmark'),
      api.get<Local>(`/api/jobs/${encodeURIComponent(job)}/bookmark/local`, 'the local bookmark'),
    ])
    if (c.ok) { setCloud(c.value); setErr(null) } else setErr(c.fault.why)
    if (l.ok) setLocal(l.value)
  }, [job])
  useEffect(() => { void load() }, [load])
  const reset = async () => {
    const ok = await confirm({
      title: `Reset the bookmark for ${job}?`,
      danger: true,
      typeToConfirm: job,
      confirmLabel: 'Reset the bookmark',
      body: 'The next run reprocesses everything the job has ever read. On an append-only target that duplicates rows, '
        + 'and on a large source it can cost considerably more than a normal run. Glue keeps no undo for this.',
    })
    if (!ok) return
    await tell('reset the bookmark', api.post(`/api/glue/jobs/${encodeURIComponent(job)}/bookmark/reset`, {}, 'the reset'), 'Bookmark reset')
    void load()
  }
  const localFiles = Object.entries(local?.state ?? {}).filter(([k]) => k !== 'updated')
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <b>Job bookmark</b>
        <span className={'pill ' + (enabled ? 'ok' : '')}>{enabled ? 'on' : 'off'}</span>
        <span className="fill" />
        <button className="quiet" onClick={() => void load()}><Icon name="refresh" size={12} /></button>
        <button className="quiet danger" onClick={() => void reset()}><Icon name="trash" size={12} />Reset</button>
      </div>
      {err && <div className="dim small">Could not read it: {err}</div>}
      {cloud?.none && <div className="dim small">Glue has no bookmark for this job yet. The first bookmarked run creates one.</div>}
      {cloud && !cloud.none && (
        <div className="dim small">
          Version <span className="fig">{cloud.version}</span> · run <span className="fig">{cloud.run}</span>
          {cloud.attempt != null ? <> · attempt <span className="fig">{cloud.attempt}</span></> : null}
          {cloud.runId ? <> · last moved by <span className="mono">{cloud.runId.slice(3, 15)}…</span></> : null}
          <div className="faint">Glue does not publish what the cursor means; this is everything it returns.</div>
        </div>)}
      <div className="dim small">
        <b>Local simulation</b> — {local?.empty !== false
          ? 'nothing consumed yet. A local run with “simulate bookmarks” on records the files it reads.'
          : `${localFiles.length} source${localFiles.length > 1 ? 's' : ''} recorded; those files are skipped on the next local run.`}
        <div className="faint">SparData’s own, kept in .spar/bookmarks. It never touches the bookmark above.</div>
      </div>
    </div>
  )
}

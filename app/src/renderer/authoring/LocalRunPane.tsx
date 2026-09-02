import { useState } from 'react'
import { useAuthoring } from './store'
import { useDag, NO_NODES } from '@/dag/store'
import { Icon } from '@/shell/Icon'
import { api } from '@/api/client'
import { tell } from '@/shell/Toast'
import { confirm } from '@/shell/Confirm'
import { useSampleStatus } from '@/dag/Samples'

/**
 * The pipeline, run here, on samples. Rows per node, files written, and — said plainly — what a
 * local run cannot exercise, so nobody mistakes a green local run for a green cloud run.
 */
export function LocalRunPane({ job }: { job: string }) {
  const a = useAuthoring((s) => s.jobs[job])
  const nodes = useDag((s) => s.jobs[job]?.nodes ?? NO_NODES)
  const { status, refresh } = useSampleStatus(job)
  const [bookmarks, setBookmarks] = useState(false)
  const r = a?.localResult
  const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? id
  const openSparkUi = async () => {
    const v = await tell('open the local Spark UI', api.post<{ url: string }>('/api/engine/sparkui', {}, 'the Spark UI', 3 * 60_000))
    if (v) window.keel.openExternal(v.url)
  }
  const resetBookmark = async () => {
    if (!await confirm({ title: 'Reset the simulated bookmark?', confirmLabel: 'Reset', body: 'The next local run reads every sample again. This is Keel’s own simulation and never touches the bookmark in Glue.' })) return
    await tell('reset the local bookmark', api.del(`/api/jobs/${encodeURIComponent(job)}/bookmark/local`, 'the reset'), 'Local bookmark reset')
  }
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row" style={{ padding: '0 12px', height: 32, borderBottom: '1px solid var(--line)', fontSize: 12, background: 'var(--surface)' }}>
        <span className="dim">{status?.ready ? 'reads samples/ — no AWS' : 'needs a sample for every source'}</span>
        <label className="row" style={{ gap: 5 }} title="Skip what an earlier local run already read. A simulation of Glue's bookmark, not the real one.">
          <input type="checkbox" checked={bookmarks} onChange={(e) => setBookmarks(e.target.checked)} />simulate bookmarks
        </label>
        {bookmarks && <button className="quiet" onClick={() => void resetBookmark()}><Icon name="bookmark" size={12} />Reset</button>}
        <span className="fill" />
        {r?.status === 'passed' && <button className="quiet" onClick={() => void openSparkUi()} title="Spark's own history server, on this run's event log. No AWS, no --enable-spark-ui."><Icon name="activity" size={12} />Spark UI</button>}
        {r && <span className={'pill ' + (r.status === 'passed' ? 'ok' : 'err')}>{r.status === 'passed' ? 'ran' : 'failed'}{r.ms != null ? ` · ${(r.ms / 1000).toFixed(1)}s` : ''}</span>}
        <button className="primary" disabled={a?.localRunning || !status?.ready}
          onClick={() => { void refresh(); useAuthoring.getState().runLocal(job, bookmarks) }}>
          <Icon name={a?.localRunning ? 'spinner' : 'play'} className={a?.localRunning ? 'spin' : ''} />{a?.localRunning ? 'Running…' : 'Run locally'}</button>
      </div>
      <div className="fill" style={{ overflow: 'auto' }}>
        {!r && !a?.localRunning && (
          <div className="dim small" style={{ padding: 12 }}>
            Runs every node here, in AWS&rsquo;s own Glue image, against the samples next to the job. Nothing is read
            from AWS and nothing is written to it. {status?.ready ? '' : 'Give each source a sample under Local data first.'}
          </div>)}
        {r?.nodes && r.nodes.length > 0 && (
          <table className="preview" style={{ margin: '8px 0' }}>
            <thead><tr><th>node</th><th>rows</th><th>columns</th></tr></thead>
            <tbody>{r.nodes.map((n) => <tr key={n.node}><td>{name(n.node)}</td><td className="fig">{n.rows}</td><td className="fig">{n.columns}</td></tr>)}</tbody>
          </table>)}
        {r?.written && r.written.length > 0 && (
          <div style={{ padding: '4px 12px', fontSize: 12 }}>
            <span className="eyebrow">Wrote</span>
            {r.written.map((w) => <div key={w.node} className="row" style={{ gap: 6 }}><Icon name="s3out" size={12} /><span className="mono">{w.path}</span><span className="faint fig">{w.rows} rows · {w.format}</span></div>)}
          </div>)}
        {r?.bookmarksSimulated && r.bookmark && (
          <div style={{ padding: '4px 12px', fontSize: 12 }}>
            <span className="eyebrow">Simulated bookmark</span>
            <div className="dim">Files this run consumed are recorded here and skipped next time. Glue&rsquo;s own bookmark is untouched.</div>
          </div>)}
        {r?.notCovered && r.notCovered.length > 0 && (
          <div style={{ padding: '4px 12px', fontSize: 12 }}>
            <span className="eyebrow">Not covered locally</span>
            {r.notCovered.map((t) => <div key={t} className="row" style={{ gap: 6, color: 'var(--warn)' }}><Icon name="warn" size={12} />{t}</div>)}
          </div>)}
        {r?.message && <pre className="err" style={{ margin: 12, whiteSpace: 'pre-wrap' }}>{r.message}</pre>}
        {(a?.localOutput.length ?? 0) > 0 && (
          <pre className="mono" style={{ margin: 0, padding: 8, background: 'var(--bg-sunken)', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{a!.localOutput.join('\n')}</pre>)}
      </div>
    </div>
  )
}

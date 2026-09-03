import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { tell, useToast } from '@/shell/Toast'
import { useOps } from '@/shell/Ops'
import { ago } from '@/shell/format'
import { useEngine } from '@/stores/engine'

export type Sample = { path: string; format: string; rows: number; captured: string; kind: string; from?: string }
export type Source = { node: string; name: string; type: string; sample?: Sample; ready: boolean }
export type SampleStatus = { sources: Source[]; ready: boolean; committed: boolean }

export function useSampleStatus(job: string) {
  const [status, setStatus] = useState<SampleStatus | null>(null)
  const refresh = useCallback(async () => {
    const r = await api.get<SampleStatus>(`/api/jobs/${encodeURIComponent(job)}/samples`, 'the local samples')
    if (r.ok) setStatus(r.value)
  }, [job])
  useEffect(() => { void refresh() }, [refresh])
  return { status, setStatus, refresh }
}

/**
 * What this job reads when it runs here. A source's `transformation_ctx` is its node id, so a
 * captured file can stand in for a catalog table, a JDBC query or an S3 prefix without emulating
 * any of them — which is what makes the whole loop work on a plane.
 */
export function LocalData({ job }: { job: string }) {
  const { status, setStatus, refresh } = useSampleStatus(job)
  const engine = useEngine((s) => s.status)
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (node: string, what: string, p: Promise<{ ok: true; value: { status: SampleStatus } } | { ok: false; fault: { what: string; why: string; fix?: string } }>) => {
    setBusy(node + what)
    const op = useOps.getState().start(`${what} for ${node}`)
    const v = await tell(what, p).finally(() => { useOps.getState().finish(op); setBusy(null) })
    if (v) { setStatus(v.status); useToast.getState().done(`${node}: ${what} done`) }
  }
  const capture = (node: string) => act(node, 'capture the real rows',
    api.post<{ status: SampleStatus }>(`/api/jobs/${encodeURIComponent(job)}/samples/${encodeURIComponent(node)}/capture?rows=200`, {}, 'the capture', 15 * 60_000))
  const synth = (node: string) => act(node, 'generate synthetic rows',
    api.post<{ status: SampleStatus }>(`/api/jobs/${encodeURIComponent(job)}/samples/${encodeURIComponent(node)}/synthetic?rows=20`, {}, 'the synthetic sample', 60_000))
  const clear = (node: string) => act(node, 'clear the sample',
    api.del<{ status: SampleStatus }>(`/api/jobs/${encodeURIComponent(job)}/samples/${encodeURIComponent(node)}`, 'clearing the sample'))
  const setCommitted = async (commit: boolean) => {
    const v = await tell('change what git sees', api.post<{ status: SampleStatus }>(`/api/jobs/${encodeURIComponent(job)}/samples/commit?commit=${commit}`, {}, 'the change'))
    if (v) setStatus(v.status)
  }
  if (!status) return <div className="insp-section faint small">Reading the local samples…</div>
  return (
    <div className="inspector">
      <div className="insp-section row">
        <span className={'pill ' + (status.ready ? 'ok' : 'warn')}>{status.ready ? 'runs offline' : 'needs data'}</span>
        <span className="dim small fill">{status.ready ? 'Every source has a local sample. Previews, tests and local runs need no AWS.' : 'Sources without a sample fall back to the real thing, which needs a profile.'}</span>
        <button className="quiet" onClick={() => void refresh()}><Icon name="refresh" size={12} /></button>
      </div>
      {status.sources.length === 0 && <div className="insp-section faint small">This job has no sources yet.</div>}
      {status.sources.map((s) => (
        <div key={s.node} className="insp-section col" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <Icon name={s.ready ? 'ok' : 'warn'} size={13} style={{ color: s.ready ? 'var(--add)' : 'var(--warn)' }} />
            <b className="fill">{s.name}</b>
            <span className="faint small">{s.type}</span>
          </div>
          <div className="dim small">
            {s.sample
              ? <>{s.sample.kind === 'captured' ? 'Captured' : 'Synthetic'} · <span className="fig">{s.sample.rows}</span> rows · {ago(s.sample.captured)}{s.sample.from ? ` · from ${s.sample.from}` : ''}</>
              : 'No local sample.'}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="quiet" disabled={!!busy} onClick={() => void capture(s.node)} title="Read the real source once and keep the rows here">
              <Icon name={busy === s.node + 'capture the real rows' ? 'spinner' : 'download'} size={12} className={busy === s.node + 'capture the real rows' ? 'spin' : ''} />Capture
            </button>
            <button className="quiet" disabled={!!busy} onClick={() => void synth(s.node)} title="Invent rows from this node's declared schema — no AWS at all">
              <Icon name="magic" size={12} />Synthetic
            </button>
            {s.sample && <button className="quiet" disabled={!!busy} onClick={() => void clear(s.node)}><Icon name="trash" size={12} />Clear</button>}
          </div>
        </div>))}
      <div className="insp-section col" style={{ gap: 6 }}>
        <label className="row" style={{ gap: 6, fontSize: 'var(--small)' }}>
          <input type="checkbox" checked={status.committed} onChange={(e) => void setCommitted(e.target.checked)} />
          Commit these fixtures
        </label>
        <span className="faint small">{status.committed
          ? 'samples/ is tracked by git. Captured rows are real data — make sure that is what you want.'
          : 'samples/ is gitignored, so captured rows stay on this machine.'}</span>
      </div>
      <div className="insp-section row" style={{ gap: 8 }}>
        <span className="dim small fill">Local engine {engine?.up ? 'is warm' : 'is not running'}.</span>
        {engine?.up
          ? <button className="quiet" onClick={() => void useEngine.getState().stop()}><Icon name="stop" size={12} />Stop</button>
          : <button className="quiet" onClick={() => void useEngine.getState().start()}><Icon name="play" size={12} />Warm it up</button>}
      </div>
    </div>
  )
}

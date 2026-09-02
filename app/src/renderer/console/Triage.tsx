import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'

type Match = { id: string; cause: string; fix: string; evidence: string; confidence: number }
type Reply = { matches: Match[]; note: string; logs?: LogWhere }
export type LogWhere = { continuous: boolean; glueVersion?: string; rows: { what: string; group: string; detail: string }[]; note?: string }

/**
 * What the failure actually was, before anyone opens a log.
 *
 * Glue's messages routinely name the wrong subsystem — the write reports an empty schema the read
 * caused, a NullPointerException is a missing Lake Formation grant. Each rule here says what it
 * really is and quotes the line that proves it, so the claim can be checked rather than believed.
 */
export function TriagePanel({ job, run }: { job: string; run: string }) {
  const [r, setR] = useState<Reply | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  useEffect(() => {
    setR(null); setErr(null)
    void api.get<Reply>(`/api/glue/jobs/${encodeURIComponent(job)}/runs/${encodeURIComponent(run)}/triage`, 'the diagnosis')
      .then((x) => { if (x.ok) setR(x.value); else setErr(x.fault.why) })
  }, [job, run])
  if (err) return <div className="dim small" style={{ padding: '0 14px 8px' }}>Could not diagnose this run: {err}</div>
  if (!r) return <div className="dim small" style={{ padding: '0 14px 8px' }}>Reading the logs…</div>
  if (r.matches.length === 0) return <div className="dim small" style={{ padding: '0 14px 8px' }}>{r.note}</div>
  const top = r.matches[0]!
  return (
    <div className="triage">
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="wrench" size={15} style={{ color: 'var(--accent)', marginTop: 1 }} />
        <div className="fill">
          <div style={{ fontWeight: 600 }}>{top.cause}</div>
          <div className="dim" style={{ marginTop: 3 }}>{top.fix}</div>
          <pre className="evidence">{top.evidence}</pre>
        </div>
        {r.matches.length > 1 && <button className="quiet" onClick={() => setOpen(!open)}>{open ? 'fewer' : `${r.matches.length - 1} more`}</button>}
      </div>
      {open && r.matches.slice(1).map((m) => (
        <div key={m.id} className="row" style={{ gap: 8, alignItems: 'flex-start', marginTop: 8, opacity: 0.85 }}>
          <Icon name="info" size={13} style={{ color: 'var(--faint)', marginTop: 2 }} />
          <div className="fill">
            <div>{m.cause}</div>
            <div className="dim" style={{ marginTop: 2 }}>{m.fix}</div>
            <pre className="evidence">{m.evidence}</pre>
          </div>
        </div>))}
    </div>
  )
}

/** Where this job's own log lines go, computed from its flags rather than recited from the docs. */
export function LogWhereNote({ job }: { job: string }) {
  const [w, setW] = useState<LogWhere | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { void api.get<LogWhere>(`/api/glue/jobs/${encodeURIComponent(job)}/logs/where`, 'the log destinations').then((r) => { if (r.ok) setW(r.value) }) }, [job])
  if (!w) return null
  return (
    <>
      <button className="quiet" onClick={() => setOpen(!open)} title="Which group each kind of output lands in, for this job's flags">
        <Icon name="info" size={12} />Where do my prints go?
      </button>
      {open && (
        <div className="triage" style={{ position: 'absolute', right: 10, top: 34, zIndex: 8, width: 460 }}>
          {w.rows.map((row) => (
            <div key={row.what} style={{ marginBottom: 6 }}>
              <div><b>{row.what}</b> → <span className="mono">{row.group}</span></div>
              <div className="dim small">{row.detail}</div>
            </div>))}
          {w.note && <div className="small" style={{ color: 'var(--warn)' }}>{w.note}</div>}
          <div className="faint small">{w.continuous ? 'Continuous logging is on for this job.' : 'Continuous logging is off, so stdout arrives when the run ends.'}</div>
        </div>)}
    </>
  )
}

import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { TimeChart } from '@/shell/Chart'
import { tell } from '@/shell/Toast'
import { useJob } from '@/stores/job'
import { useLanes } from '@/stores/lanes'
import { useAuthoring } from '@/authoring/store'
import { RunSheet } from '@/console/RunSheet'
import type { Insights, MetricsReply } from '@/wire/types'
import { RolePrompt } from './RolePrompt'
import { EnableFlag } from './EnableFlag'

/** Glue Studio's Metrics tab for a run, drawn from CloudWatch's Glue namespace. */
export function MetricsPane({ job, run }: { job: string; run: string }) {
  const [m, setM] = useState<MetricsReply | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const load = async () => {
    setBusy(true); setErr(null)
    const r = await api.get<MetricsReply>(`/api/glue/jobs/${encodeURIComponent(job)}/runs/${encodeURIComponent(run)}/metrics`, 'the run metrics')
    setBusy(false)
    if (r.ok) setM(r.value); else setErr(r.fault.why)
  }
  useEffect(() => { setM(null); void load() }, [job, run]) // eslint-disable-line react-hooks/exhaustive-deps
  if (busy && !m) return <div className="faint small" style={{ padding: 14 }}>Reading CloudWatch…</div>
  if (err) return <div style={{ overflow: 'auto', height: '100%' }}><div className="small" style={{ padding: 14, color: 'var(--del)' }}>{err}</div><RolePrompt job={job} need="metrics" /></div>
  if (!m) return <div className="faint small" style={{ padding: 14 }}>No metrics yet.</div>
  if (!m.any) return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="faint small" style={{ padding: 14, maxWidth: 70 * 8 }}>{m.note}</div>
      <EnableFlag job={job} what="metrics" onDone={() => void load()} />
      <RolePrompt job={job} need="metrics" />
    </div>)
  const groups = Array.from(new Set(m.series.filter((s) => s.points.length).map((s) => s.group)))
  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      <div className="row" style={{ marginBottom: 10 }}><span className="faint small">one point every {m.period}s</span><span className="fill" /><button className="quiet" onClick={() => void load()}><Icon name="refresh" size={12} />Refresh</button></div>
      {groups.map((g) => {
        const series = m.series.filter((s) => s.group === g && s.points.length)
        if (!series.length) return null
        const unit = series[0]!.unit
        const same = series.every((s) => s.unit === unit)
        return <div key={g} style={{ marginBottom: 12 }}>
          {same && series.length <= 2
            ? <TimeChart title={g} unit={unit} series={series.map((s) => ({ label: s.label, points: s.points }))} />
            : <div className="chart-grid">{series.map((s) => <TimeChart key={s.id} title={s.label} unit={s.unit} series={[{ label: s.label, points: s.points }]} />)}</div>}
        </div>
      })}
    </div>
  )
}

/** Glue's job-insights streams: the consolidated root cause and its rule-based guidance. */
export function InsightsPane({ job, run }: { job: string; run: string }) {
  const [i, setI] = useState<Insights | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setI(null); setBusy(true)
    void api.get<Insights>(`/api/glue/jobs/${encodeURIComponent(job)}/runs/${encodeURIComponent(run)}/insights`, 'the run insights').then((r) => { setBusy(false); if (r.ok) setI(r.value) })
  }, [job, run])
  if (busy) return <div className="faint small" style={{ padding: 14 }}>Reading insights…</div>
  if (!i) return <div className="faint small" style={{ padding: 14, maxWidth: 70 * 8 }}>Insights could not be read. They live in CloudWatch, so this needs an AWS profile and a role that can write logs.</div>
  const block = (title: string, lines: Insights['rootCause']) => !lines?.length ? null : (
    <div style={{ marginBottom: 12 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{title}</div>
      <pre className="mono" style={{ margin: 0, padding: '8px 12px', background: 'var(--well)', border: '1px solid var(--line)', borderRadius: 'var(--r)', whiteSpace: 'pre-wrap', fontSize: 'var(--micro)' }}>
        {lines.map((l) => l.message).join('')}
      </pre>
    </div>)
  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      {block('Root cause', i.rootCause)}
      {block('Guidance', i.guidance)}
      {!i.rootCause?.length && !i.guidance?.length && <>
        <div className="faint small" style={{ maxWidth: 70 * 8 }}>{i.note}</div>
        <EnableFlag job={job} what="insights" />
        <RolePrompt job={job} need="logs" />
      </>}
    </div>
  )
}

/** A Spark history server in the Glue container, reading this run's event logs from S3. */
export function SparkUiPane({ job, run }: { job: string; run: string }) {
  const [status, setStatus] = useState<{ running: boolean; url?: string | null; run?: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const startJob = useJob((s) => s.start)

  const load = async () => { const r = await api.get<{ running: boolean; url?: string | null; run?: string | null }>('/api/glue/sparkui', 'the Spark UI'); if (r.ok) setStatus(r.value) }
  useEffect(() => { void load() }, [])
  const start = async () => {
    setBusy(true); setErr(null); setNote(null)
    // The daemon answers once the server is actually serving, so the browser opens on a fact
    // rather than on a timer. The history server needs about twenty seconds to bind and parse.
    const r = await api.post<{ url: string; note: string }>(`/api/glue/jobs/${encodeURIComponent(job)}/runs/${encodeURIComponent(run)}/sparkui`, {}, 'the Spark UI', 3 * 60_000)
    setBusy(false)
    if (!r.ok) { setErr(`${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}`); return }
    setNote(r.value.note); await load()
    window.keel.openExternal(r.value.url)
  }
  const stop = async () => { await api.post('/api/glue/sparkui/stop', {}, 'stopping'); await load() }
  const mine = status?.running && status.run === run

  const isNoLogs = err && /this run wrote no spark event logs/i.test(err)
  const openLocalSparkUi = async () => {
    const v = await tell('open the local Spark UI', api.post<{ url: string }>('/api/engine/sparkui', {}, 'the Spark UI', 3 * 60_000))
    if (v) window.keel.openExternal(v.url)
  }
  const runLocally = () => {
    useLanes.getState().setTab(job, 'authoring')
    void useAuthoring.getState().runLocal(job, false)
  }

  return (
    <div style={{ padding: 14, overflow: 'auto', height: '100%' }}>
      <p className="dim" style={{ marginTop: 0, maxWidth: 68 * 8 }}>
        Keel starts Spark&apos;s own history server in the Glue 5 container, pointed at this run&apos;s event logs in S3, and opens it in your browser. It needs the run to have had <code>Spark UI (event logs)</code> on with a logs path set.
      </p>
      <div className="row">
        {mine ? (
          <>
            <button className="primary" onClick={() => void window.keel.openExternal(status!.url!)}><Icon name="external" />Open Spark UI</button>
            <button onClick={() => void stop()}><Icon name="stop" />Stop server</button>
            <span className="mono small dim">{status!.url}</span>
          </>
        ) : (
          <button className="primary" disabled={busy} onClick={() => void start()}>
            <Icon name={busy ? 'spinner' : 'play'} className={busy ? 'spin' : ''} />{busy ? 'Starting…' : 'Start Spark UI for this run'}
          </button>
        )}
      </div>
      {busy && <p className="dim small">Starting the history server and parsing this run&apos;s event log. It opens when it is actually serving — about twenty seconds.</p>}
      {status?.running && !mine && <p className="dim small">A history server is already running for run {status.run}. Starting it here replaces it.</p>}
      {note && <p className="dim small">{note}</p>}
      
      {isNoLogs ? (
        <div className="card" style={{ padding: 'var(--s3)', margin: 'var(--s3) 0', border: '1px solid var(--warn)', background: 'var(--warn-bg)', maxWidth: 600 }}>
          <div className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--warn)', marginBottom: 4 }}>
            <Icon name="warn" size={14} />Spark event logs not found for this run
          </div>
          <p className="small dim" style={{ margin: '0 0 var(--s2) 0', color: 'var(--text)' }}>
            Spark UI is enabled on the job definition now, but was off when this specific run started. Start a new run to capture event logs in S3, or run locally to get a Spark UI immediately with no S3 setup.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="primary" onClick={() => setSheet(true)}>
              <Icon name="play" />Start new run in AWS
            </button>
            <button onClick={runLocally}>
              <Icon name="route" />Run locally on samples
            </button>
            <button className="quiet" onClick={() => void openLocalSparkUi()}>
              <Icon name="activity" />Local Spark UI
            </button>
          </div>
        </div>
      ) : err ? (
        <p className="small" style={{ color: 'var(--del)', whiteSpace: 'pre-wrap' }}>{err}</p>
      ) : null}

      {err && !isNoLogs && /event log|spark-ui|logs path/i.test(err) && <EnableFlag job={job} what="sparkui" />}
      
      {sheet && (
        <RunSheet
          initial={{}}
          onClose={() => setSheet(false)}
          onRun={(args) => {
            setSheet(false)
            void startJob(job, args ?? {})
          }}
        />
      )}
    </div>
  )
}

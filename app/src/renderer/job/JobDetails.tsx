import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useGlue } from '@/stores/glue'
import { useDag } from '@/dag/store'
import { Icon } from '@/shell/Icon'
import { EmptyState } from '@/shell/EmptyState'

type Def = Record<string, unknown> & { Command?: { Name?: string; ScriptLocation?: string; PythonVersion?: string }; DefaultArguments?: Record<string, string>; NonOverridableArguments?: Record<string, string>; Connections?: { Connections?: string[] }; ExecutionProperty?: { MaxConcurrentRuns?: number }; NotificationProperty?: { NotifyDelayAfter?: number } }

const WORKERS = ['G.1X', 'G.2X', 'G.4X', 'G.8X', 'G.12X', 'G.16X', 'R.1X', 'R.2X', 'R.4X', 'R.8X', 'G.025X', 'Z.2X']
const VERSIONS = ['5.0', '4.0', '3.0', '2.0']

/**
 * Glue Studio's "Job details" tab: every property of the job definition, edited either on the local
 * job.json (a draft, or a job with a local folder) or straight on the AWS definition.
 */
export function JobDetails({ job }: { job: string }) {
  const glueJob = useGlue((s) => s.jobs.find((j) => j.name === job))
  const dagState = useDag((s) => s.jobs[job])
  const local = !!dagState?.imported
  const [def, setDef] = useState<Def | null>(null)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    if (local) { const r = await api.get<{ job?: Def | null }>(`/api/jobs/${encodeURIComponent(job)}`, 'the job'); if (r.ok) setDef(r.value.job ?? {}) }
    else { const r = await api.get<Def>(`/api/glue/jobs/${encodeURIComponent(job)}`, 'the job definition'); if (r.ok) setDef(r.value) }
    setDirty(false)
  }
  useEffect(() => { void load() }, [job, local]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!def) return <EmptyState title="Reading job details…" />
  const set = (patch: Partial<Def>) => { setDef({ ...def, ...patch }); setDirty(true) }
  const args = def.DefaultArguments ?? {}
  const arg = (k: string) => args[k]
  const setArg = (k: string, v: string | undefined) => { const next = { ...args }; if (v === undefined || v === '') delete next[k]; else next[k] = v; set({ DefaultArguments: next }) }
  const bool = (k: string) => arg(k) === 'true'
  const save = async () => {
    setBusy(true); setMsg(null)
    const r = local ? await api.put(`/api/jobs/${encodeURIComponent(job)}/job`, def, 'job.json') : await api.put(`/api/glue/jobs/${encodeURIComponent(job)}/details`, def, 'the job definition')
    setBusy(false)
    if (r.ok) { setDirty(false); setMsg(local ? 'Saved to job.json — deploy to push it to AWS.' : 'Saved to AWS.') } else setMsg(r.fault.why)
  }
  const num = (v: unknown) => (v == null ? '' : String(v))
  return (
    <div className="details" style={{ overflow: 'auto', height: '100%' }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Job details</h2>
        <span className="pill">{local ? 'editing job.json (local)' : 'editing the AWS definition'}</span>
        <span className="fill" />
        {msg && <span className="small dim">{msg}</span>}
        <button className="quiet" onClick={() => void load()} disabled={busy}>Reset</button>
        <button className="primary" onClick={() => void save()} disabled={!dirty || busy}><Icon name="check" />{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="grid">
        <label>Name<input value={job} disabled /></label>
        <label>IAM role<input value={String(def.Role ?? '')} onChange={(e) => set({ Role: e.target.value })} placeholder="arn:aws:iam::…:role/…" className="mono" /></label>
        <label className="one" style={{ gridColumn: '1 / -1' }}>Description<input value={String(def.Description ?? '')} onChange={(e) => set({ Description: e.target.value })} /></label>
        <label>Type<select value={def.Command?.Name ?? 'glueetl'} onChange={(e) => set({ Command: { ...def.Command, Name: e.target.value } })}><option value="glueetl">Spark</option><option value="gluestreaming">Spark streaming</option><option value="pythonshell">Python shell</option><option value="glueray">Ray</option></select></label>
        <label>Glue version<select value={String(def.GlueVersion ?? '5.0')} onChange={(e) => set({ GlueVersion: e.target.value })}>{VERSIONS.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Language<select value={def.Command?.PythonVersion === '3' || !def.Command?.PythonVersion ? 'python' : 'scala'} onChange={(e) => set({ Command: { ...def.Command, PythonVersion: e.target.value === 'python' ? '3' : undefined }, DefaultArguments: { ...args, '--job-language': e.target.value } })}><option value="python">Python 3</option><option value="scala">Scala</option></select></label>
        <label>Worker type<select value={String(def.WorkerType ?? 'G.1X')} onChange={(e) => set({ WorkerType: e.target.value })}>{WORKERS.map((w) => <option key={w}>{w}</option>)}</select></label>
        <label>Requested number of workers<input type="number" min={2} value={num(def.NumberOfWorkers)} onChange={(e) => set({ NumberOfWorkers: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label>Execution class<select value={String(def.ExecutionClass ?? 'STANDARD')} onChange={(e) => set({ ExecutionClass: e.target.value })}><option>STANDARD</option><option>FLEX</option></select></label>
        <label>Job timeout (minutes)<input type="number" min={1} value={num(def.Timeout)} onChange={(e) => set({ Timeout: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label>Number of retries<input type="number" min={0} max={10} value={num(def.MaxRetries)} onChange={(e) => set({ MaxRetries: e.target.value ? Number(e.target.value) : 0 })} /></label>
        <label>Max concurrency<input type="number" min={1} value={num(def.ExecutionProperty?.MaxConcurrentRuns)} onChange={(e) => set({ ExecutionProperty: { MaxConcurrentRuns: e.target.value ? Number(e.target.value) : 1 } })} /></label>
        <label>Job run queuing<select value={def.JobRunQueuingEnabled ? 'yes' : 'no'} onChange={(e) => set({ JobRunQueuingEnabled: e.target.value === 'yes' })}><option value="no">Off</option><option value="yes">On</option></select></label>
      </div>
      <h2>Options</h2>
      <div className="grid">
        <Toggle label="Automatically scale the number of workers" on={bool('--enable-auto-scaling')} set={(v) => setArg('--enable-auto-scaling', v ? 'true' : undefined)} />
        <Toggle label="Job bookmark" on={arg('--job-bookmark-option') !== 'job-bookmark-disable'} set={(v) => setArg('--job-bookmark-option', v ? 'job-bookmark-enable' : 'job-bookmark-disable')} />
        <Toggle label="Continuous logging" on={bool('--enable-continuous-cloudwatch-log')} set={(v) => setArg('--enable-continuous-cloudwatch-log', v ? 'true' : undefined)} />
        <Toggle label="Job metrics" on={bool('--enable-metrics')} set={(v) => setArg('--enable-metrics', v ? 'true' : undefined)} />
        <Toggle label="Observability metrics" on={bool('--enable-observability-metrics')} set={(v) => setArg('--enable-observability-metrics', v ? 'true' : undefined)} />
        <Toggle label="Spark UI (event logs)" on={bool('--enable-spark-ui')} set={(v) => setArg('--enable-spark-ui', v ? 'true' : undefined)} />
        <Toggle label="Job insights" on={bool('--enable-job-insights')} set={(v) => setArg('--enable-job-insights', v ? 'true' : undefined)} />
        <Toggle label="Use Data Catalog as the Hive metastore" on={bool('--enable-glue-datacatalog')} set={(v) => setArg('--enable-glue-datacatalog', v ? 'true' : undefined)} />
      </div>
      <h2>Advanced properties</h2>
      <div className="grid">
        <label style={{ gridColumn: '1 / -1' }}>Script path<input className="mono" value={def.Command?.ScriptLocation ?? ''} onChange={(e) => set({ Command: { ...def.Command, ScriptLocation: e.target.value } })} placeholder="s3://bucket/scripts/job.py (Keel fills this on deploy)" /></label>
        <label>Temporary path<input className="mono" value={arg('--TempDir') ?? ''} onChange={(e) => setArg('--TempDir', e.target.value)} placeholder="s3://…/temporary/" /></label>
        <label>Spark UI logs path<input className="mono" value={arg('--spark-event-logs-path') ?? ''} onChange={(e) => setArg('--spark-event-logs-path', e.target.value)} placeholder="s3://…/sparkHistoryLogs/" /></label>
        <label>Python library path<input className="mono" value={arg('--extra-py-files') ?? ''} onChange={(e) => setArg('--extra-py-files', e.target.value)} placeholder="s3://…/lib.zip,…" /></label>
        <label>Dependent JARs path<input className="mono" value={arg('--extra-jars') ?? ''} onChange={(e) => setArg('--extra-jars', e.target.value)} /></label>
        <label>Referenced files path<input className="mono" value={arg('--extra-files') ?? ''} onChange={(e) => setArg('--extra-files', e.target.value)} /></label>
        <label>Additional Python modules<input className="mono" value={arg('--additional-python-modules') ?? ''} onChange={(e) => setArg('--additional-python-modules', e.target.value)} placeholder="pandas==2.2.0,…" /></label>
        <label>Security configuration<input value={String(def.SecurityConfiguration ?? '')} onChange={(e) => set({ SecurityConfiguration: e.target.value || undefined })} /></label>
        <label>Connections<input value={(def.Connections?.Connections ?? []).join(', ')} onChange={(e) => set({ Connections: { Connections: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} placeholder="conn-a, conn-b" /></label>
        <label>Delay notification (minutes)<input type="number" min={1} value={num(def.NotificationProperty?.NotifyDelayAfter)} onChange={(e) => set({ NotificationProperty: e.target.value ? { NotifyDelayAfter: Number(e.target.value) } : undefined })} /></label>
      </div>
      <h2>Job parameters</h2>
      <p className="dim small" style={{ margin: '0 0 8px' }}>Passed to every run as <code>--key value</code>. The toggles above live here too.</p>
      <KV value={args} onChange={(v) => set({ DefaultArguments: v })} />
      <h2>Non-overridable parameters</h2>
      <KV value={def.NonOverridableArguments ?? {}} onChange={(v) => set({ NonOverridableArguments: Object.keys(v).length ? v : undefined })} />
      {glueJob && <p className="faint small" style={{ marginTop: 16 }}>In AWS since {String(glueJob.lastModifiedOn ?? '').slice(0, 19).replace('T', ' ')} · {glueJob.jobMode ?? 'SCRIPT'} · created by the console or API.</p>}
    </div>
  )
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: 'var(--text)' }}><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{label}</label>
}

function KV({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const rows = Object.entries(value)
  return (
    <div className="kv">
      {rows.map(([k, v]) => (<>
        <input key={k + '.k'} className="mono" defaultValue={k} onBlur={(e) => { if (e.target.value !== k) { const n = { ...value }; delete n[k]; if (e.target.value) n[e.target.value] = v; onChange(n) } }} />
        <input key={k + '.v'} className="mono" defaultValue={v} onBlur={(e) => { if (e.target.value !== v) onChange({ ...value, [k]: e.target.value }) }} />
        <button key={k + '.x'} className="quiet" onClick={() => { const n = { ...value }; delete n[k]; onChange(n) }}><Icon name="x" size={12} /></button>
      </>))}
      <button className="quiet" style={{ gridColumn: '1 / -1', justifySelf: 'start' }} onClick={() => onChange({ ...value, [`--param${rows.length + 1}`]: '' })}><Icon name="plus" />parameter</button>
    </div>
  )
}

import { useEffect, useMemo, useState, Fragment } from 'react'
import { Bookmarks } from './Bookmarks'
import { api } from '@/api/client'
import { useGlue, useAccount } from '@/stores/glue'
import { useDag } from '@/dag/store'
import { Icon } from '@/shell/Icon'
import { confirm } from '@/shell/Confirm'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useSurfaceReason } from '@/shell/useSurfaceReason'
import { Seg } from '@/shell/Seg'
import { tell } from '@/shell/Toast'
import { dpu, money, RATE } from '@/sessions/model'
import type { Fault } from '@/api/client'

type Def = Record<string, unknown> & { Command?: { Name?: string; ScriptLocation?: string; PythonVersion?: string }; DefaultArguments?: Record<string, string>; NonOverridableArguments?: Record<string, string>; Connections?: { Connections?: string[] }; ExecutionProperty?: { MaxConcurrentRuns?: number }; NotificationProperty?: { NotifyDelayAfter?: number } }

const WORKERS = ['G.1X', 'G.2X', 'G.4X', 'G.8X', 'G.12X', 'G.16X', 'R.1X', 'R.2X', 'R.4X', 'R.8X', 'G.025X', 'Z.2X']
const VERSIONS = ['5.0', '4.0', '3.0', '2.0']

type Section = 'basics' | 'capacity' | 'options' | 'paths' | 'params'
const SECTIONS = [['basics', 'Basics'], ['capacity', 'Capacity'], ['options', 'Options'], ['paths', 'Paths & libraries'], ['params', 'Parameters']] as const

/** Which top-level keys and which job parameters differ from what was loaded. */
function changedKeys(base: Def, now: Def): string[] {
  const out: string[] = []
  const keys = new Set([...Object.keys(base), ...Object.keys(now)])
  for (const k of keys) {
    if (k === 'DefaultArguments' || k === 'NonOverridableArguments') continue
    if (JSON.stringify(base[k]) !== JSON.stringify(now[k])) out.push(k)
  }
  for (const bag of ['DefaultArguments', 'NonOverridableArguments'] as const) {
    const a = (base[bag] ?? {}) as Record<string, string>, b = (now[bag] ?? {}) as Record<string, string>
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push(`${bag}.${k}`)
  }
  return out
}

/**
 * Every property of the job definition, edited either on the local job.json (a draft, or a job
 * with a local folder) or straight on the AWS definition.
 *
 * It was one flat scroll of forty controls under four headings, with Save pinned at the top where
 * it scrolled out of sight — so you edited at the bottom and could not see whether anything was
 * unsaved, or what Save was about to write to. Now: one section at a time, an action bar that
 * stays put and counts what you changed, and the capacity section prices the machine.
 */
export function JobDetails({ job }: { job: string }) {
  const account = useAccount()
  const glueJob = useGlue((s) => s.jobs.find((j) => j.name === job))
  const dagState = useDag((s) => s.jobs[job])
  const local = !!dagState?.imported
  const [def, setDef] = useState<Def | null>(null)
  const [base, setBase] = useState<Def | null>(null)
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<Fault | null>(null)
  const [section, setSection] = useState<Section>('basics')
  const load = async () => {
    // both branches used to drop the failure, so a job with no job.json sat on "Reading…" for ever
    setFault(null)
    const r = local
      ? await api.get<{ job?: Def | null }>(`/api/jobs/${encodeURIComponent(job)}`, 'the job')
      : await api.get<Def>(`/api/glue/jobs/${encodeURIComponent(job)}`, 'the job definition')
    if (!r.ok) setFault(r.fault)
    else {
      const v = local ? ((r.value as { job?: Def | null }).job ?? {}) : (r.value as Def)
      setDef(v); setBase(structuredClone(v))
    }
  }
  useEffect(() => { void load() }, [job, local, account]) // eslint-disable-line react-hooks/exhaustive-deps
  const reason = useSurfaceReason('job details')
  if (!local && reason) return reason
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!def) return <EmptyState title="Reading job details…" />
  const set = (patch: Partial<Def>) => setDef({ ...def, ...patch })
  const args = def.DefaultArguments ?? {}
  const arg = (k: string) => args[k]
  const setArg = (k: string, v: string | undefined) => { const next = { ...args }; if (v === undefined || v === '') delete next[k]; else next[k] = v; set({ DefaultArguments: next }) }
  const bool = (k: string) => arg(k) === 'true'
  const save = async () => {
    // a local job.json is a file on this machine; the other branch overwrites the live definition
    if (!local && !await confirm({
      title: `Save ${job} to AWS?`,
      confirmLabel: 'Save to AWS',
      body: 'This job has no local folder, so Save writes these settings straight to the Glue job definition in your account. Import it first if you would rather review the change on a branch.',
    })) return
    setBusy(true)
    const ok = await tell('save the job details',
      local ? api.put(`/api/jobs/${encodeURIComponent(job)}/job`, def, 'job.json') : api.put(`/api/glue/jobs/${encodeURIComponent(job)}/details`, def, 'the job definition'),
      local ? 'Saved to job.json — deploy to push it to AWS' : 'Saved to AWS')
    setBusy(false)
    if (ok !== undefined) setBase(structuredClone(def))
  }
  const num = (v: unknown) => (v == null ? '' : String(v))
  const changed = base ? changedKeys(base, def) : []
  const units = dpu(String(def.WorkerType ?? 'G.1X'), Number(def.NumberOfWorkers ?? 2))
  const flex = def.ExecutionClass === 'FLEX'
  const reset = async () => {
    if (changed.length && !await confirm({ title: 'Discard your changes?', confirmLabel: 'Discard', danger: true,
      body: `${changed.length} setting${changed.length > 1 ? 's have' : ' has'} been edited and not saved. Reloading takes the definition back to what is stored.` })) return
    void load()
  }

  return (
    <div className="col" style={{ height: '100%' }}>
      {/* stays put: with forty controls below, Save must not scroll away */}
      <div className="detail-bar">
        <div className="row" style={{ gap: 'var(--s2)', minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>Job details</h2>
          <span className={'pill ' + (local ? '' : 'warn')} title={local
            ? 'Save writes jobs/' + job + '/job.json on this branch. Deploy pushes it to AWS.'
            : 'This job has no local folder, so Save writes straight to the Glue job definition in your account.'}>
            <Icon name={local ? 'files' : 'deploy'} size={11} />{local ? 'writes job.json' : 'writes to AWS'}
          </span>
        </div>
        <span className="fill" />
        {changed.length > 0 && <span className="small" style={{ color: 'var(--warn)' }} title={changed.join('\n')}>{changed.length} unsaved</span>}
        <button className="quiet" onClick={() => void reset()} disabled={busy || !changed.length}>Reset</button>
        <button className="primary" onClick={() => void save()} disabled={!changed.length || busy}><Icon name="check" />{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="detail-bar sub">
        <Seg label="Settings section" value={section} onChange={setSection} options={SECTIONS} />
      </div>

      <div className="fill details" style={{ overflow: 'auto', paddingTop: 'var(--s4)' }}>
        {section === 'basics' && (
          <div className="grid">
            <label>Name<input value={job} disabled /></label>
            <label>IAM role<input value={String(def.Role ?? '')} onChange={(e) => set({ Role: e.target.value })} placeholder="arn:aws:iam::…:role/…" className="mono" /></label>
            <label style={{ gridColumn: '1 / -1' }}>Description<input value={String(def.Description ?? '')} onChange={(e) => set({ Description: e.target.value })} /></label>
            <label>Type<select value={def.Command?.Name ?? 'glueetl'} onChange={(e) => set({ Command: { ...def.Command, Name: e.target.value } })}><option value="glueetl">Spark</option><option value="gluestreaming">Spark streaming</option><option value="pythonshell">Python shell</option><option value="glueray">Ray</option></select></label>
            <label>Glue version<select value={String(def.GlueVersion ?? '5.0')} onChange={(e) => set({ GlueVersion: e.target.value })}>{VERSIONS.map((v) => <option key={v}>{v}</option>)}</select></label>
            <label>Language<select value={def.Command?.PythonVersion === '3' || !def.Command?.PythonVersion ? 'python' : 'scala'} onChange={(e) => set({ Command: { ...def.Command, PythonVersion: e.target.value === 'python' ? '3' : undefined }, DefaultArguments: { ...args, '--job-language': e.target.value } })}><option value="python">Python 3</option><option value="scala">Scala</option></select></label>
            <label>Security configuration<input value={String(def.SecurityConfiguration ?? '')} onChange={(e) => set({ SecurityConfiguration: e.target.value || undefined })} /></label>
            <label style={{ gridColumn: '1 / -1' }}>Connections <span className="faint micro">— for a VPC or a JDBC source</span>
              <input value={(def.Connections?.Connections ?? []).join(', ')} onChange={(e) => set({ Connections: { Connections: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} placeholder="conn-a, conn-b" /></label>
          </div>)}

        {section === 'capacity' && (<>
          <div className="grid">
            <label>Worker type<select value={String(def.WorkerType ?? 'G.1X')} onChange={(e) => set({ WorkerType: e.target.value })}>{WORKERS.map((w) => <option key={w}>{w}</option>)}</select></label>
            <label>Requested number of workers<input type="number" min={2} value={num(def.NumberOfWorkers)} onChange={(e) => set({ NumberOfWorkers: e.target.value ? Number(e.target.value) : undefined })} /></label>
            <label>Execution class<select value={String(def.ExecutionClass ?? 'STANDARD')} onChange={(e) => set({ ExecutionClass: e.target.value })}><option>STANDARD</option><option>FLEX</option></select></label>
            <label>Job timeout (minutes)<input type="number" min={1} value={num(def.Timeout)} onChange={(e) => set({ Timeout: e.target.value ? Number(e.target.value) : undefined })} /></label>
            <label>Number of retries<input type="number" min={0} max={10} value={num(def.MaxRetries)} onChange={(e) => set({ MaxRetries: e.target.value ? Number(e.target.value) : 0 })} /></label>
            <label>Max concurrency<input type="number" min={1} value={num(def.ExecutionProperty?.MaxConcurrentRuns)} onChange={(e) => set({ ExecutionProperty: { MaxConcurrentRuns: e.target.value ? Number(e.target.value) : 1 } })} /></label>
            <label>Job run queuing<select value={def.JobRunQueuingEnabled ? 'yes' : 'no'} onChange={(e) => set({ JobRunQueuingEnabled: e.target.value === 'yes' })}><option value="no">Off</option><option value="yes">On</option></select></label>
            <label>Delay notification (minutes)<input type="number" min={1} value={num(def.NotificationProperty?.NotifyDelayAfter)} onChange={(e) => set({ NotificationProperty: e.target.value ? { NotifyDelayAfter: Number(e.target.value) } : undefined })} /></label>
          </div>
          {/* what these three numbers actually cost, the same arithmetic the sessions page uses */}
          <div className="cost-note" style={{ background: 'var(--info-bg)', color: 'var(--dim)' }}>
            <Icon name="dollar" size={14} />
            <div className="fill">
              <b style={{ color: 'var(--text)' }}>{units} DPU · ≈ {money(units * RATE)} per hour of run time</b>
              <div className="micro" style={{ marginTop: 2 }}>
                {String(def.WorkerType ?? 'G.1X')} × {Number(def.NumberOfWorkers ?? 2)}, at Glue&rsquo;s standard ${RATE}/DPU-hour; your region may differ.
                {flex
                  ? ' FLEX bills at a lower rate on spare capacity, and starts when there is some — good for a job with no deadline.'
                  : ' A timeout of ' + (num(def.Timeout) || '2880') + ' minutes caps a runaway run at about ' + money(units * RATE * (Number(def.Timeout ?? 2880) / 60)) + '.'}
              </div>
            </div>
          </div>
        </>)}

        {section === 'options' && (<>
          <div className="grid">
            <Toggle label="Automatically scale the number of workers" on={bool('--enable-auto-scaling')} set={(v) => setArg('--enable-auto-scaling', v ? 'true' : undefined)} />
            <Toggle label="Job bookmark" on={arg('--job-bookmark-option') !== 'job-bookmark-disable'} set={(v) => setArg('--job-bookmark-option', v ? 'job-bookmark-enable' : 'job-bookmark-disable')} />
            <Toggle label="Continuous logging" on={bool('--enable-continuous-cloudwatch-log')} set={(v) => setArg('--enable-continuous-cloudwatch-log', v ? 'true' : undefined)}
              note={String(def.GlueVersion ?? '') >= '5.0' ? 'Glue 5.0 removed continuous logging; this flag does nothing here.' : undefined} />
            <Toggle label="Job metrics" on={bool('--enable-metrics')} set={(v) => setArg('--enable-metrics', v ? 'true' : undefined)}
              note={bool('--enable-metrics') ? undefined : 'The Metrics tab is empty without this. The job role also needs cloudwatch:PutMetricData.'} />
            <Toggle label="Observability metrics" on={bool('--enable-observability-metrics')} set={(v) => setArg('--enable-observability-metrics', v ? 'true' : undefined)} />
            <Toggle label="Spark UI (event logs)" on={bool('--enable-spark-ui')} set={(v) => setArg('--enable-spark-ui', v ? 'true' : undefined)}
              note={bool('--enable-spark-ui') && !arg('--spark-event-logs-path') ? 'Also needs a Spark UI logs path, under Paths & libraries.' : undefined} />
            <Toggle label="Job insights" on={bool('--enable-job-insights')} set={(v) => setArg('--enable-job-insights', v ? 'true' : undefined)} />
            <Toggle label="Use Data Catalog as the Hive metastore" on={bool('--enable-glue-datacatalog')} set={(v) => setArg('--enable-glue-datacatalog', v ? 'true' : undefined)} />
          </div>
          <div className="card" style={{ margin: 'var(--s4) 0' }}>
            <Bookmarks job={job} enabled={arg('--job-bookmark-option') !== 'job-bookmark-disable'} />
          </div>
        </>)}

        {section === 'paths' && (
          <div className="grid">
            <label style={{ gridColumn: '1 / -1' }}>Script path<input className="mono" value={def.Command?.ScriptLocation ?? ''} onChange={(e) => set({ Command: { ...def.Command, ScriptLocation: e.target.value } })} placeholder="s3://bucket/scripts/job.py (Keel fills this on deploy)" /></label>
            <label>Temporary path<input className="mono" value={arg('--TempDir') ?? ''} onChange={(e) => setArg('--TempDir', e.target.value)} placeholder="s3://…/temporary/" /></label>
            <label>Spark UI logs path<input className="mono" value={arg('--spark-event-logs-path') ?? ''} onChange={(e) => setArg('--spark-event-logs-path', e.target.value)} placeholder="s3://…/sparkHistoryLogs/" /></label>
            <label>Python library path<input className="mono" value={arg('--extra-py-files') ?? ''} onChange={(e) => setArg('--extra-py-files', e.target.value)} placeholder="s3://…/lib.zip,…" /></label>
            <label>Dependent JARs path<input className="mono" value={arg('--extra-jars') ?? ''} onChange={(e) => setArg('--extra-jars', e.target.value)} /></label>
            <label>Referenced files path<input className="mono" value={arg('--extra-files') ?? ''} onChange={(e) => setArg('--extra-files', e.target.value)} /></label>
            <label>Additional Python modules<input className="mono" value={arg('--additional-python-modules') ?? ''} onChange={(e) => setArg('--additional-python-modules', e.target.value)} placeholder="pandas==2.2.0,…" /></label>
          </div>)}

        {section === 'params' && (<>
          <h3>Job parameters</h3>
          <p className="dim small" style={{ margin: '0 0 var(--s2)' }}>Passed to every run as <code>--key value</code>. The toggles under Options live here too.</p>
          <KV value={args} onChange={(v) => set({ DefaultArguments: v })} />
          <h3 style={{ marginTop: 'var(--s5)' }}>Non-overridable parameters</h3>
          <p className="dim small" style={{ margin: '0 0 var(--s2)' }}>These cannot be replaced by a run&rsquo;s own arguments.</p>
          <KV value={def.NonOverridableArguments ?? {}} onChange={(v) => set({ NonOverridableArguments: Object.keys(v).length ? v : undefined })} />
        </>)}

        {glueJob && <p className="faint small" style={{ marginTop: 'var(--s5)' }}>In AWS since {String(glueJob.lastModifiedOn ?? '').slice(0, 19).replace('T', ' ')} · {glueJob.jobMode ?? 'SCRIPT'}</p>}
      </div>
    </div>
  )
}

function Toggle({ label, on, set, note }: { label: string; on: boolean; set: (v: boolean) => void; note?: string }) {
  return (
    <label className="col" style={{ gap: 2 }}>
      <span className="row" style={{ alignItems: 'center', gap: 8, color: 'var(--text)' }}>
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{label}
      </span>
      {note && <span className="faint small" style={{ paddingLeft: 22 }}>{note}</span>}
    </label>)
}

function KV({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const rows = Object.entries(value)
  return (
    <div className="kv">
      {rows.map(([k, v]) => (<Fragment key={k}>
        <input className="mono" defaultValue={k} onBlur={(e) => { if (e.target.value !== k) { const n = { ...value }; delete n[k]; if (e.target.value) n[e.target.value] = v; onChange(n) } }} />
        <input className="mono" defaultValue={v} onBlur={(e) => { if (e.target.value !== v) onChange({ ...value, [k]: e.target.value }) }} />
        <button className="quiet" aria-label={`Remove ${k}`} onClick={() => { const n = { ...value }; delete n[k]; onChange(n) }}><Icon name="x" size={12} /></button>
      </Fragment>))}
      <button className="quiet" style={{ gridColumn: '1 / -1', justifySelf: 'start' }} onClick={() => onChange({ ...value, [`--param${rows.length + 1}`]: '' })}><Icon name="plus" />parameter</button>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Sheet } from '@/shell/Sheet'
import { Icon } from '@/shell/Icon'
import { useGlue } from '@/stores/glue'
import { dpu, money, RATE } from './model'

const VERSIONS = ['5.0', '4.0', '3.0']
const WORKERS = ['G.1X', 'G.2X', 'G.4X', 'G.8X']

export type NewSessionForm = { role: string; glueVersion: string; workerType: string; numberOfWorkers: number; idleTimeout: number; connections: string; description: string }

/**
 * Starting a session used to be six controls crammed into the bottom of a 280px list, with the
 * IAM role as a bare ARN box — the one field that decides whether it works at all. It is a sheet
 * now, the roles are offered from the jobs that already run in this account, and the price of the
 * machine you are about to rent is on screen before you rent it.
 */
export function NewSession({ busy, error, onCancel, onStart }: {
  busy: boolean; error?: string | null; onCancel: () => void; onStart: (f: NewSessionForm) => void
}) {
  const jobs = useGlue((s) => s.jobs)
  const roles = useMemo(() => [...new Set(jobs.map((j) => j.role).filter((r): r is string => !!r))], [jobs])
  const [f, setF] = useState<NewSessionForm>({
    role: roles[0] ?? '', glueVersion: '5.0', workerType: 'G.1X', numberOfWorkers: 2, idleTimeout: 30, connections: '', description: '',
  })
  const set = <K extends keyof NewSessionForm>(k: K, v: NewSessionForm[K]) => setF({ ...f, [k]: v })
  const units = dpu(f.workerType, f.numberOfWorkers)
  const hour = units * RATE
  return (
    <Sheet label="Start an interactive session" width={560} onClose={onCancel} dirty={!!f.role}>
      <h2>Start an interactive session</h2>
      <p className="dim" style={{ marginTop: 0 }}>
        A real Spark session in your account. It can reach the Data Catalog, a JDBC source and anything
        inside a VPC — the things the local Glue container cannot.
      </p>

      <label className="col" style={{ gap: 4 }}>
        <span className="eyebrow">IAM role</span>
        {roles.length > 0 ? (
          <div className="row" style={{ gap: 6 }}>
            <select className="fill mono" value={roles.includes(f.role) ? f.role : '__custom'}
              onChange={(e) => set('role', e.target.value === '__custom' ? '' : e.target.value)}>
              {roles.map((r) => <option key={r} value={r}>{r.split('/').pop()}</option>)}
              <option value="__custom">Another role…</option>
            </select>
          </div>) : null}
        {(roles.length === 0 || !roles.includes(f.role)) && (
          <input className="mono" placeholder="arn:aws:iam::123456789012:role/GlueServiceRole" value={f.role} onChange={(e) => set('role', e.target.value)} />)}
        <span className="faint micro">
          {roles.length ? 'Roles your Glue jobs already use. The session assumes it, so it needs the same data access.' : 'The role the session assumes. Any role your Glue jobs use will do.'}
        </span>
      </label>

      <div className="form" style={{ marginTop: 'var(--s4)' }}>
        <label>Glue version<select value={f.glueVersion} onChange={(e) => set('glueVersion', e.target.value)}>{VERSIONS.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Worker type<select value={f.workerType} onChange={(e) => set('workerType', e.target.value)}>{WORKERS.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Workers<input type="number" min={2} max={100} value={f.numberOfWorkers} onChange={(e) => set('numberOfWorkers', Math.max(2, Number(e.target.value)))} /></label>
        <label>Idle timeout (minutes)<input type="number" min={1} max={480} value={f.idleTimeout} onChange={(e) => set('idleTimeout', Math.max(1, Number(e.target.value)))} /></label>
        <label style={{ gridColumn: '1 / -1' }}>Connections <span className="faint micro">— comma separated, for a VPC or JDBC source</span>
          <input value={f.connections} onChange={(e) => set('connections', e.target.value)} placeholder="my-redshift-connection" /></label>
      </div>

      <div className="cost-note">
        <Icon name="dollar" size={14} />
        <div className="fill">
          <b>{units} DPU · ≈ {money(hour)} per hour</b>
          <div className="dim micro" style={{ marginTop: 2 }}>
            Billed from the moment it starts until it stops, whether or not you are typing —
            ≈ {money(hour * (f.idleTimeout / 60))} if you start it and walk away for the full {f.idleTimeout}-minute idle timeout.
            At Glue's standard ${RATE}/DPU-hour; your region may differ.
          </div>
        </div>
      </div>

      {error && <div className="small" role="alert" style={{ color: 'var(--del)', marginTop: 'var(--s2)' }}>{error}</div>}
      <div className="row" style={{ marginTop: 'var(--s4)', justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy || !f.role.trim()} onClick={() => onStart(f)}>
          <Icon name={busy ? 'spinner' : 'play'} className={busy ? 'spin' : ''} />{busy ? 'Starting…' : 'Start session'}
        </button>
      </div>
    </Sheet>
  )
}

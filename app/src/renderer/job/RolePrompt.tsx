import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'

type Role = { role: string; roleArn: string; logGroups: string[]; canWriteLogs: boolean; metricCount: number
  attachedPolicies: string[]; inlinePolicies: string[]; readable: boolean; hasKeelPolicy: boolean; policyName: string; policy: string; missing: string[]; iamNote?: string }

/**
 * Why a run has no logs or metrics is almost always the job's role. This says so, shows the exact
 * policy, and attaches it on one click when the person's own credentials may.
 */
export function RolePrompt({ job, need }: { job: string; need: 'logs' | 'metrics' }) {
  const [r, setR] = useState<Role | null>(null)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const load = async () => { const x = await api.get<Role>(`/api/glue/jobs/${encodeURIComponent(job)}/role`, 'the job role'); if (x.ok) setR(x.value) }
  useEffect(() => { void load() }, [job]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null
  const blocked = need === 'logs' ? !r.canWriteLogs : r.metricCount === 0
  if (!blocked) return null
  const grant = async () => {
    setBusy(true); setMsg(null)
    const x = await api.post<{ note: string }>(`/api/glue/jobs/${encodeURIComponent(job)}/role/grant`, {}, 'the policy')
    setBusy(false)
    setMsg(x.ok ? x.value.note : `${x.fault.why}${x.fault.fix ? ` — ${x.fault.fix}` : ''}`)
    if (x.ok) void load()
  }
  return (
    <div className="card" style={{ padding: 12, margin: 12, borderColor: 'var(--warn)' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Icon name="warn" style={{ color: 'var(--warn)', marginTop: 2 }} />
        <div className="fill">
          <b>The job's role cannot write {need === 'logs' ? 'CloudWatch logs' : 'CloudWatch metrics'}.</b>
          <div className="dim small" style={{ marginTop: 4 }}>{r.missing.join(' ')}</div>
          <div className="faint small" style={{ marginTop: 4 }}>Role <span className="mono">{r.role}</span>{r.attachedPolicies.length ? ` · ${r.attachedPolicies.join(', ')}` : ''}{r.iamNote ? ` · ${r.iamNote}` : ''}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={busy || r.hasKeelPolicy} onClick={() => void grant()}>
          <Icon name={busy ? 'spinner' : 'quality'} className={busy ? 'spin' : ''} />
          {r.hasKeelPolicy ? 'Policy already attached' : busy ? 'Attaching…' : `Add the policy to ${r.role}`}
        </button>
        <button className="quiet" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} policy</button>
        <button className="quiet" onClick={() => void navigator.clipboard.writeText(r.policy)}><Icon name="copy" size={12} />Copy</button>
      </div>
      {msg && <div className="small" style={{ marginTop: 8, color: msg.includes('could not') ? 'var(--del)' : 'var(--add)' }}>{msg}</div>}
      {show && <pre className="mono" style={{ marginTop: 8, padding: 10, background: 'var(--well)', borderRadius: 'var(--r)', fontSize: 11, overflow: 'auto', maxHeight: 260 }}>{r.policy}</pre>}
      <div className="faint small" style={{ marginTop: 6 }}>Runs that already finished have no logs to recover; the next run does.</div>
    </div>
  )
}

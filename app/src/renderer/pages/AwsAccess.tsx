import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { tell, useToast } from '@/shell/Toast'
import { confirm } from '@/shell/Confirm'

type Tier = { id: string; title: string; why: string; on: boolean; required: boolean; actions: string[] }
type Pre = { identity: string; account: string; region?: string; tiers: { id: string; title: string; on: boolean; denied: string[]; unknown: string[]; verdict: string; disables: string[] }[] }

/**
 * What Keel is allowed to do to the account, as switches rather than as one policy document.
 *
 * Read is on and cannot be turned off; nothing in it changes anything. Author and Operate are off
 * until turned on, and the daemon refuses those calls locally, so a read-only install stays
 * read-only even when the credentials would allow more.
 */
export function AwsAccess() {
  const [tiers, setTiers] = useState<Tier[] | null>(null)
  const [pre, setPre] = useState<Pre | null>(null)
  const [checking, setChecking] = useState(false)
  const [policy, setPolicy] = useState<{ tier: string; json: string } | null>(null)
  useEffect(() => { void api.get<{ tiers: Tier[] }>('/api/aws/tiers', 'the access tiers').then((r) => { if (r.ok) setTiers(r.value.tiers) }) }, [])
  const set = async (t: Tier, on: boolean) => {
    if (on && !await confirm({
      title: `Turn ${t.title} on?`,
      body: `${t.why}\n\nKeel will be able to make those calls in the selected account. It still asks before anything irreversible.`,
      confirmLabel: `Turn ${t.title} on`,
    })) return
    const r = await api.post<{ tiers: Tier[] }>(`/api/aws/tiers/${t.id}?on=${on}`, {}, 'the change')
    if (r.ok) { setTiers(r.value.tiers); useToast.getState().done(`${t.title} ${on ? 'on' : 'off'}`) }
    else useToast.getState().fail('change that', r.fault)
  }
  const check = async () => {
    setChecking(true)
    const v = await tell('check the permissions', api.get<Pre>('/api/aws/preflight', 'the preflight', 3 * 60_000))
    setChecking(false)
    if (v) setPre(v)
  }
  const showPolicy = async (id: string) => {
    const v = await tell('read the policy', api.get<{ tier: string; json: string }>(`/api/aws/policy?tier=${id}`, 'the policy'))
    if (v) setPolicy(v)
  }
  return (
    <section className="card">
      <div className="row"><h3 style={{ margin: 0 }}>AWS access</h3><span className="fill" />
        <button disabled={checking} onClick={() => void check()} title="Ask IAM what this identity can actually do, before anything is attempted">
          <Icon name={checking ? 'spinner' : 'quality'} className={checking ? 'spin' : ''} />{checking ? 'Checking…' : 'Check permissions'}</button>
      </div>
      <p className="dim">Read is always on and cannot change anything. The rest are off until you turn them on, and Keel refuses those calls here, before they reach AWS.</p>
      {(tiers ?? []).map((t) => {
        const p = pre?.tiers.find((x) => x.id === t.id)
        return (
          <div key={t.id} className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <input type="checkbox" checked={t.on} disabled={t.required} onChange={(e) => void set(t, e.target.checked)} style={{ marginTop: 3 }} />
            <div className="fill">
              <div className="row" style={{ gap: 8 }}>
                <b>{t.title}</b>
                {t.required && <span className="pill">always on</span>}
                {p && <span className={'pill ' + (p.verdict === 'allowed' ? 'ok' : p.verdict === 'partial' ? 'err' : '')}
                  title={p.denied.length ? `denied: ${p.denied.join(', ')}` : p.unknown.length ? 'IAM would not answer; this identity cannot simulate its own policy' : 'every action allowed'}>
                  {p.verdict === 'allowed' ? 'allowed' : p.verdict === 'partial' ? `${p.denied.length} denied` : 'unknown'}</span>}
                <span className="fill" />
                <button className="quiet" onClick={() => void showPolicy(t.id)}>Policy</button>
              </div>
              <div className="dim small">{t.why}</div>
              {p && p.disables.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>Off without it: {p.disables.join(', ')}</div>}
            </div>
          </div>)
      })}
      {pre && <p className="faint small">Checked as {pre.identity} in {pre.account}{pre.region ? ` · ${pre.region}` : ''}. “unknown” means this identity cannot call iam:SimulatePrincipalPolicy, not that the action is denied.</p>}
      {policy && (
        <div className="col" style={{ gap: 6, marginTop: 8 }}>
          <div className="row"><b>{policy.tier} policy</b><span className="fill" />
            <button className="quiet" onClick={() => void navigator.clipboard.writeText(policy.json)}><Icon name="copy" size={12} />Copy</button>
            <button className="quiet" aria-label="Close the policy" onClick={() => setPolicy(null)}><Icon name="x" size={12} /></button></div>
          <pre className="mono" style={{ maxHeight: 260, overflow: 'auto', background: 'var(--well)', padding: 10, borderRadius: 6, fontSize: 'var(--small)' }}>{policy.json}</pre>
        </div>)}
    </section>
  )
}

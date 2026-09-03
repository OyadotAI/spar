import { useState } from 'react'
import { useToast } from '@/shell/Toast'
import { api } from '@/api/client'
import { useApp } from '@/stores/app'
import { confirm } from '@/shell/Confirm'
import { useTerminal } from '@/stores/terminal'
import { Icon } from '@/shell/Icon'
import { ProfilePicker } from '@/pages/ProfilePicker'
import { AwsAccess } from '@/pages/AwsAccess'

export function SettingsPage() {
  const { state, refreshState, toggle } = useApp()
  const openTerminal = useTerminal((s) => s.openWith)
  const [sso, setSso] = useState({ startUrl: '', ssoRegion: 'us-east-1', account: '', role: '', profile: '', region: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [bucket, setBucket] = useState(state?.scriptBucket ?? '')
  const addSso = async () => {
    setMsg(null)
    const r = await api.post<{ profile: string; login: string }>('/api/aws/sso', sso, 'the SSO profile')
    if (!r.ok) { setMsg(r.fault.why); return }
    await refreshState()
    setMsg(`Profile ${r.value.profile} written. Signing in…`)
    openTerminal(r.value.login)
  }
  const [savingBucket, setSavingBucket] = useState(false)
  const saveBucket = async () => {
    setSavingBucket(true)
    const r = await api.post('/api/profile', { scriptBucket: bucket }, 'the script bucket')
    setSavingBucket(false)
    if (!r.ok) { useToast.getState().fail('save the script bucket', r.fault); return }
    await refreshState(); useToast.getState().done('Script bucket saved')
  }
  return (
    <div className="settings">
      <div className="row" style={{ marginBottom: 16 }}>
        <h1>Settings</h1><span className="fill" />
        <button onClick={() => toggle('showSettings', false)}>Done</button>
      </div>

      <section className="card">
        <h2>AWS</h2>
        <div className="row"><ProfilePicker />
          {state?.profile && <button onClick={() => openTerminal(`aws sso login --profile ${state.profile}`)}>Sign in (SSO)</button>}
        </div>
        <p className="dim">Profiles come from <code>~/.aws/config</code>. Access keys are never entered in Keel: run <code>aws configure</code> in the terminal instead.</p>
        <label className="row">Script bucket <input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-glue-scripts" style={{ width: 260 }} /> <button disabled={savingBucket} onClick={() => void saveBucket()}>{savingBucket ? 'Saving…' : 'Save'}</button></label>
        <p className="dim">Where a deployed job's script goes when it has no <code>ScriptLocation</code> yet: <code>s3://&lt;bucket&gt;/scripts/&lt;job&gt;.py</code>.</p>
      </section>

      <AwsAccess />

      <section className="card">
        <h2>Add an IAM Identity Center (SSO) profile</h2>
        <div className="form">
          <label>Start URL <input value={sso.startUrl} onChange={(e) => setSso({ ...sso, startUrl: e.target.value })} placeholder="https://d-xxxx.awsapps.com/start" /></label>
          <label>Identity Center region <input value={sso.ssoRegion} onChange={(e) => setSso({ ...sso, ssoRegion: e.target.value })} /></label>
          <label>Account id <input value={sso.account} onChange={(e) => setSso({ ...sso, account: e.target.value })} placeholder="123456789012" /></label>
          <label>Role name <input value={sso.role} onChange={(e) => setSso({ ...sso, role: e.target.value })} placeholder="AdministratorAccess" /></label>
          <label>Profile name <input value={sso.profile} onChange={(e) => setSso({ ...sso, profile: e.target.value })} placeholder="keel" /></label>
          <label>Default region <input value={sso.region} onChange={(e) => setSso({ ...sso, region: e.target.value })} placeholder="same as Identity Center" /></label>
        </div>
        <div className="row"><button className="primary" onClick={() => void addSso()}>Write profile and sign in</button>{msg && <span className="dim">{msg}</span>}</div>
      </section>

      <section className="card">
        <h2>Live updates</h2>
        <LiveCard />
      </section>

      <section className="card">
        <h2>Tools</h2>
        <ul className="dim" style={{ margin: 0, paddingLeft: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state && Object.entries(state.tools).map(([k, t]) => {
            const notLoggedIn = k === 'claude' && t.installed && t.loggedIn === false
            return (
              <li key={k} style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                <code>{k}</code>
                {t.installed ? (
                  <>
                    <span className="mono">{t.version}</span>
                    {k === 'claude' && (
                      notLoggedIn ? (
                        <>
                          <span className="pill warn">not signed in</span>
                          <button className="primary" style={{ minHeight: 22, padding: '2px 8px' }} onClick={() => openTerminal('claude login')}>
                            <Icon name="terminal" size={12} />Sign in
                          </button>
                        </>
                      ) : t.loggedIn === true ? (
                        <span className="pill ok">signed in</span>
                      ) : null
                    )}
                  </>
                ) : (
                  <>
                    <span style={{ color: 'var(--del)' }}>not found on PATH</span>
                    {k === 'claude' && (
                      <button style={{ minHeight: 22, padding: '2px 8px' }} onClick={() => openTerminal('npm i -g @anthropic-ai/claude-code')}>
                        <Icon name="terminal" size={12} />Install
                      </button>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function LiveCard() {
  const { state, refreshState } = useApp()
  const live = state?.live
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const flip = async (enable: boolean) => {
    if (!await confirm({
      title: enable ? 'Create the push infrastructure?' : 'Remove the push infrastructure?',
      confirmLabel: enable ? 'Enable live updates' : 'Disable',
      body: enable
        ? 'This creates one SQS queue and two EventBridge rules in this region of your account. Disabling removes them again. Keel keeps polling either way.'
        : 'This deletes the SQS queue and the two EventBridge rules Keel created. Run state falls back to polling.',
    })) return
    setBusy(true); setErr(null)
    const r = await api.post<unknown>(enable ? '/api/live/enable' : '/api/live/disable', {}, 'live updates')
    if (!r.ok) setErr(r.fault.why + (r.fault.fix ? ` — ${r.fault.fix}` : ''))
    await refreshState(); setBusy(false)
  }
  if (!live) return <p className="dim">Pick a profile first.</p>
  const p = live.push
  return (
    <div>
      <p className="dim">Keel already polls Glue (jobs every 5s, runs on a {live.sweepSeconds}s sweep, 3s while a run is live). Enabling push adds an SQS queue and two EventBridge rules in this region so run completions arrive in about a second.
        {p?.trail === 'absent' && <> Job create/update and run start events need a CloudTrail trail, which this account does not have; run completions are live regardless.</>}</p>
      <div className="row">
        <span className={'pill ' + (p?.enabled ? 'ok' : '')}>{p?.enabled ? 'push enabled' : 'polling only'}</span>
        {p?.enabled ? <button disabled={busy} onClick={() => void flip(false)}>Disable</button> : <button className="primary" disabled={busy} onClick={() => void flip(true)}>Enable live updates</button>}
        {p?.error && <span style={{ color: 'var(--warn)' }}>{p.error}</span>}
        {err && <span style={{ color: 'var(--del)' }}>{err}</span>}
      </div>
      <details style={{ marginTop: 8 }}><summary className="dim">IAM actions needed</summary>
        <code style={{ display: 'block', whiteSpace: 'pre-wrap', marginTop: 4 }}>{'sqs:CreateQueue GetQueueAttributes SetQueueAttributes ReceiveMessage DeleteMessage DeleteQueue\nevents:PutRule PutTargets RemoveTargets DeleteRule DescribeRule\nsts:GetCallerIdentity   (optional) cloudtrail:DescribeTrails'}</code></details>
    </div>
  )
}

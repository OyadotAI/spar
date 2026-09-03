import { useEffect, useState } from 'react'
import { Icon } from '@/shell/Icon'
import { useApp } from '@/stores/app'

type Check = { ok: boolean; why?: string; hint?: string; empty?: boolean; git?: boolean; keel?: boolean }
type Tool = { installed: boolean; version?: string; loggedIn?: boolean; authMethod?: string }

const FIX: Record<string, { what: string; how: string; needed: string }> = {
  docker: { what: 'Docker', how: 'docker.com/products/docker-desktop', needed: 'runs your job locally: previews, tests, the local Spark UI' },
  claude: { what: 'Claude Code', how: 'npm i -g @anthropic-ai/claude-code', needed: 'the debugging and authoring agents' },
  git: { what: 'git', how: 'xcode-select --install, or your package manager', needed: 'a branch and worktree per job' },
  aws: { what: 'the AWS CLI', how: 'aws.amazon.com/cli', needed: 'reading and deploying jobs in your account' },
}

/**
 * The first thing a new user sees. It exists because the alternative — silently adopting a default
 * folder — meant Keel created `jobs/`, `.keel/` and a git repository wherever it happened to point.
 */
export function Welcome({ onOpened }: { onOpened: () => void }) {
  const state = useApp((s) => s.state)
  const [recent, setRecent] = useState<string[]>([])
  const [dir, setDir] = useState('')
  const [check, setCheck] = useState<Check | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { void window.keel.recentProjects().then(setRecent) }, [])
  useEffect(() => {
    if (!dir) { setCheck(null); return }
    let live = true
    void window.keel.checkProject(dir).then((c) => { if (live) setCheck(c) })
    return () => { live = false }
  }, [dir])
  const pick = async () => { const p = await window.keel.pickProject(); if (p) setDir(p) }
  const open = async (d = dir) => {
    setBusy(true); setErr(null)
    const r = await window.keel.openProject(d)
    setBusy(false)
    if (!r.ok) { setErr(`${r.why ?? 'That folder cannot be used.'}${r.hint ? ` ${r.hint}` : ''}`); return }
    onOpened()
  }
  const tools = (state?.tools ?? {}) as Record<string, Tool>
  const known = Object.keys(tools).length > 0
  const missing = Object.entries(FIX).filter(([k]) => tools[k] && !tools[k]!.installed)
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}><Icon name="keel" size={28} /><h1 style={{ fontSize: 'var(--display)' }}>SparData</h1></div>
        <p className="dim" style={{ fontSize: 'var(--reading)', marginTop: 0, maxWidth: '56ch' }}>
          A local-first workbench for AWS Glue. Your jobs live in a folder on this machine, as a DAG, generated PySpark
          and tests you can run without touching AWS. Connect an account when you want to import, deploy or watch runs.
        </p>

        <h2 style={{ marginTop: 26 }}>Choose a project folder</h2>
        <p className="dim small" style={{ marginTop: 2 }}>SparData keeps <code>jobs/&lt;name&gt;/</code> here, one git branch per job, and its own state in <code>.spar/</code>.</p>
        <div className="row" style={{ marginTop: 10 }}>
          <input className="mono fill" placeholder="~/glue-jobs" value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && check?.ok) void open() }} />
          <button onClick={() => void pick()}><Icon name="folder" />Browse…</button>
          <button className="primary" disabled={!dir || busy || (check ? !check.ok : false)} onClick={() => void open()}>
            <Icon name={busy ? 'spinner' : 'chevron'} className={busy ? 'spin' : ''} />{check?.empty ? 'Create and open' : 'Open'}
          </button>
        </div>
        {check && !check.ok && <div className="note bad"><Icon name="bad" size={14} /><span><b>{check.why}</b> {check.hint}</span></div>}
        {check?.ok && check.why && <div className="note warn"><Icon name="warn" size={14} /><span><b>{check.why}</b> {check.hint}</span></div>}
        {check?.ok && check.keel && <div className="note ok"><Icon name="ok" size={14} /><span>An existing SparData project. Your jobs and branches are still here.</span></div>}
        {check?.ok && !check.keel && check.empty && <div className="note"><Icon name="info" size={14} /><span>Empty folder. SparData will create it and run <code>git init</code> inside it.</span></div>}
        {err && <div className="note bad"><Icon name="bad" size={14} /><span>{err}</span></div>}

        {recent.length > 0 && (
          <>
            <h2 style={{ marginTop: 24 }}>Recent</h2>
            {recent.map((r) => (
              <button key={r} className="quiet recent" onClick={() => void open(r)}>
                <Icon name="folder" size={14} /><span className="mono">{r.replace(/^\/Users\/[^/]+/, '~')}</span>
              </button>))}
          </>)}

        <h2 style={{ marginTop: 26 }}>On this machine</h2>
        {!known && <p className="faint small">Checking…</p>}
        {known && <div className="tool-list">
          {Object.entries(FIX).map(([k, f]) => {
            const t = tools[k]
            const notLoggedIn = k === 'claude' && t?.installed && t?.loggedIn === false
            const ok = t?.installed && !notLoggedIn
            return (
              <div key={k} className="tool">
                <Icon name={ok ? 'ok' : notLoggedIn ? 'warn' : k === 'aws' || k === 'claude' ? 'info' : 'warn'} size={15} style={{ color: ok ? 'var(--add)' : notLoggedIn || k === 'docker' || k === 'git' ? 'var(--warn)' : 'var(--dim)' }} />
                <div>
                  <div className="row" style={{ gap: 6 }}>
                    <b>{f.what}</b>
                    {t?.installed ? <span className="faint mono small">{t?.version}</span> : <span className="faint small">not found</span>}
                    {notLoggedIn && <span className="pill warn">not signed in</span>}
                  </div>
                  <div className="dim small">
                    {notLoggedIn
                      ? 'Installed, but not signed in. Run claude login in the terminal to enable the agent.'
                      : ok
                      ? f.needed
                      : `Needed for ${f.needed}. Install: ${f.how}`}
                  </div>
                </div>
              </div>)
          })}
        </div>}
        {known && missing.length === 0 && <p className="faint small">Everything SparData uses is present.</p>}
        <p className="faint small" style={{ marginTop: 18 }}>
          Independent open-source project, not affiliated with AWS or Amazon. The local daemon listens on 127.0.0.1 and dies with this window.
        </p>
      </div>
    </div>
  )
}

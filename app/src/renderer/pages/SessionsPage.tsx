import { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { api, type Fault } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { confirm } from '@/shell/Confirm'
import { tell } from '@/shell/Toast'
import { useOps } from '@/shell/Ops'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useApp } from '@/stores/app'
import { when } from '@/shell/format'
import { cmTheme } from '@/authoring/CodePane'
import type { SessionInfo, StatementResult } from '@/wire/types'

const LIVE = new Set(['PROVISIONING', 'READY', 'TIMEOUT'])

/**
 * AWS Glue interactive sessions: a real Spark session in the account. Use it for what the local
 * container cannot reach — the Data Catalog, JDBC, a VPC connection — and as a REPL beside the
 * canvas. A live session bills by DPU-hour, so its cost and idle timeout are always on screen.
 */
export function SessionsPage() {
  const state = useApp((s) => s.state)
  const [list, setList] = useState<SessionInfo[] | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [form, setForm] = useState({ role: '', glueVersion: '5.0', workerType: 'G.1X', numberOfWorkers: 2, idleTimeout: 30, connections: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const load = async () => { const r = await api.get<SessionInfo[]>('/api/glue/sessions', 'the sessions'); if (r.ok) { setList(r.value); setFault(null) } else setFault(r.fault) }
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t) }, [])
  const cur = list?.find((s) => s.id === sel)
  const create = async () => {
    setStarting(true); setMsg(null)
    const r = await api.post<SessionInfo>('/api/glue/sessions', { ...form, connections: form.connections.split(',').map((s) => s.trim()).filter(Boolean) }, 'the session')
    setStarting(false)
    if (!r.ok) { setMsg(`${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}`); return }
    setSel(r.value.id); void load()
  }
  const stop = async (id: string) => { await api.post(`/api/glue/sessions/${encodeURIComponent(id)}/stop`, {}, 'stopping'); void load() }
  const del = async (id: string) => { if (!await confirm({ title: `Delete session ${id}?`, danger: true, confirmLabel: 'Delete', body: "Deleting a stopped session frees its record; a live one is stopped first and billing ends." })) return; await api.del(`/api/glue/sessions/${encodeURIComponent(id)}`, 'deleting'); setSel(null); void load() }
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading sessions…" />
  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <div className="panel" style={{ width: 280, flex: 'none' }}>
        <div className="panel-head"><span className="eyebrow">Interactive sessions</span><span className="fill" /><button className="quiet" onClick={() => void load()}><Icon name="refresh" size={12} /></button></div>
        <div className="fill" style={{ overflow: 'auto' }}>
          {list.length === 0 && <div className="faint small" style={{ padding: 12 }}>No sessions in this region.</div>}
          {list.map((s) => (
            <div key={s.id} className={'panel-row' + (s.id === sel ? ' on' : '')} style={{ height: 'auto', padding: '6px 12px' }} onClick={() => setSel(s.id)}>
              <span className={'dot' + (s.status === 'READY' ? ' live' : '')} style={{ color: s.status === 'READY' ? 'var(--add)' : s.status === 'PROVISIONING' ? 'var(--accent)' : 'var(--faint)' }} />
              <div className="col fill" style={{ gap: 1, minWidth: 0 }}><span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.id}</span><span className="faint" style={{ fontSize: 10 }}>{s.status.toLowerCase()} · {s.workerType} × {s.numberOfWorkers}</span></div>
            </div>))}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Start a session</div>
          <div className="col" style={{ gap: 6 }}>
            <input placeholder="IAM role ARN" className="mono" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            <div className="row" style={{ gap: 6 }}>
              <select value={form.glueVersion} onChange={(e) => setForm({ ...form, glueVersion: e.target.value })}>{['5.0', '4.0', '3.0'].map((v) => <option key={v}>{v}</option>)}</select>
              <select value={form.workerType} onChange={(e) => setForm({ ...form, workerType: e.target.value })}>{['G.1X', 'G.2X', 'G.4X', 'G.8X'].map((v) => <option key={v}>{v}</option>)}</select>
              <input type="number" min={2} style={{ width: 56 }} value={form.numberOfWorkers} onChange={(e) => setForm({ ...form, numberOfWorkers: Number(e.target.value) })} />
            </div>
            <div className="row" style={{ gap: 6 }}><input type="number" min={1} style={{ width: 70 }} value={form.idleTimeout} onChange={(e) => setForm({ ...form, idleTimeout: Number(e.target.value) })} title="idle timeout, minutes" /><span className="faint small">min idle</span></div>
            <input placeholder="connections (optional)" value={form.connections} onChange={(e) => setForm({ ...form, connections: e.target.value })} />
            <button className="primary" disabled={starting || !form.role} onClick={() => void create()}><Icon name={starting ? 'spinner' : 'play'} className={starting ? 'spin' : ''} />{starting ? 'Starting…' : 'Start session'}</button>
            {msg && <span className="small" style={{ color: 'var(--del)' }}>{msg}</span>}
            <span className="faint" style={{ fontSize: 10 }}>Billed per DPU-hour while it lives, one-minute minimum. It stops itself after the idle timeout.</span>
          </div>
        </div>
      </div>
      <div className="fill" style={{ minWidth: 0 }}>
        {cur ? <SessionRepl session={cur} onStop={() => void stop(cur.id)} onDelete={() => void del(cur.id)} /> : (
          <EmptyState title="Pick or start a session">
            {state?.profile ? 'A session runs Spark in your account, so it can read the Data Catalog and anything inside a VPC. The local Glue container cannot.' : 'Choose an AWS profile first.'}
          </EmptyState>)}
      </div>
    </div>
  )
}

function SessionRepl({ session, onStop, onDelete }: { session: SessionInfo; onStop: () => void; onDelete: () => void }) {
  const [code, setCode] = useState("spark.sql('show databases').show()")
  const [busy, setBusy] = useState(false)
  const [cells, setCells] = useState<{ code: string; result?: StatementResult; error?: string }[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [cells])
  const run = async () => {
    if (!code.trim() || busy) return
    setBusy(true)
    setCells((c) => [...c, { code }])
    // A statement on a cold session waits for the session to come up: minutes, not seconds.
    const op = useOps.getState().start(`Statement on ${session.id}`)
    const r = await api.post<StatementResult>(`/api/glue/sessions/${encodeURIComponent(session.id)}/statements`, { code }, 'the statement', 16 * 60_000)
      .finally(() => useOps.getState().finish(op))
    setBusy(false)
    setCells((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, result: r.ok ? r.value : undefined, error: r.ok ? undefined : r.fault.why } : x)))
  }
  const ready = session.status === 'READY'
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="toolbar" style={{ height: 40 }}>
        <span className="mono small">{session.id}</span>
        <span className={'pill ' + (ready ? 'ok' : session.status === 'PROVISIONING' ? 'info' : '')}>{session.status.toLowerCase()}</span>
        <span className="dim small">{session.glueVersion} · {session.workerType} × {session.numberOfWorkers} · idle {session.idleTimeout}m</span>
        {session.dpuSeconds != null && session.dpuSeconds > 0 && <span className="dim small fig">{(session.dpuSeconds / 3600).toFixed(2)} DPU-h</span>}
        <span className="fill" />
        <button onClick={onStop} disabled={!LIVE.has(session.status)}><Icon name="stop" />Stop</button>
        <button className="quiet danger" onClick={onDelete}><Icon name="trash" /></button>
      </div>
      {session.errorMessage && <pre className="err" style={{ margin: 12 }}>{session.errorMessage}</pre>}
      <div ref={scroller} className="fill" style={{ overflow: 'auto', padding: 12 }}>
        {cells.length === 0 && <div className="faint small">Run a statement. The session keeps its state between them, like a notebook cell.</div>}
        {cells.map((c, i) => (
          <div key={i} className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
            <pre className="mono" style={{ margin: 0, padding: '8px 12px', background: 'var(--well)', whiteSpace: 'pre-wrap', fontSize: 'var(--micro)' }}>{c.code}</pre>
            {!c.result && !c.error && <div className="row dim small" style={{ padding: '6px 12px' }}><span className="dot live" style={{ color: 'var(--accent)' }} />running…</div>}
            {c.error && <pre className="err" style={{ margin: 0 }}>{c.error}</pre>}
            {c.result?.output?.text && <pre className="mono" style={{ margin: 0, padding: '8px 12px', whiteSpace: 'pre-wrap', fontSize: 'var(--micro)' }}>{c.result.output.text}</pre>}
            {c.result?.output?.errorValue && <pre className="err" style={{ margin: 0 }}>{c.result.output.errorName}: {c.result.output.errorValue}{c.result.output.traceback?.length ? '\n' + c.result.output.traceback.join('') : ''}</pre>}
          </div>))}
      </div>
      <div style={{ borderTop: '1px solid var(--line)' }}>
        <CodeMirror value={code} height="120px" extensions={[python()]} theme={cmTheme()} onChange={setCode} basicSetup={{ lineNumbers: false }} />
        <div className="row" style={{ padding: 8 }}>
          <span className="faint small">{ready ? 'Ready' : 'The session must be READY before a statement runs.'}</span><span className="fill" />
          <button className="primary" disabled={!ready || busy} onClick={() => void run()}><Icon name={busy ? 'spinner' : 'play'} className={busy ? 'spin' : ''} />{busy ? 'Running…' : 'Run statement'}</button>
        </div>
      </div>
    </div>
  )
}

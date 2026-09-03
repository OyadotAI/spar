import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/stores/glue'
import { api, type Fault } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { confirm } from '@/shell/Confirm'
import { tell, useToast } from '@/shell/Toast'
import { useOps } from '@/shell/Ops'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useSurfaceReason } from '@/shell/useSurfaceReason'
import { ago } from '@/shell/format'
import { NewSession, type NewSessionForm } from '@/sessions/NewSession'
import { Notebook, toCell, type Cell } from '@/sessions/Notebook'
import { ageMs, idleLeftMin, isLive, money, origin, perHour, shortName, spent, dpu, RATE } from '@/sessions/model'
import type { SessionInfo, StatementResult } from '@/wire/types'

const dur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3600_000).toFixed(1)}h`)

/**
 * AWS Glue interactive sessions: a real Spark session in the account, and the one thing in Keel
 * that reaches what the local container cannot — the Data Catalog, JDBC, a VPC connection.
 *
 * Two things drive this screen. A session costs money for every minute it is alive, so its price
 * and its idle countdown are in the header, not buried in a 12px grey line. And while a session
 * is running Glue holds its statement history, so the notebook is read back from the account
 * rather than living in this window — a reload keeps it, and a session the Glue console started
 * can be opened and read. Once a session ends that history is gone for good; the pane says so
 * rather than showing an empty notebook that reads as "nothing ever ran here".
 */
export function SessionsPage() {
  const account = useAccount()
  const [list, setList] = useState<SessionInfo[] | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.get<SessionInfo[]>('/api/glue/sessions', 'the sessions')
    if (r.ok) { setList(r.value); setFault(null) } else setFault(r.fault)
  }, [])
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15_000); return () => clearInterval(t) }, [load, account])

  const cur = list?.find((s) => s.id === sel)
  const create = async (f: NewSessionForm) => {
    setStarting(true); setCreateErr(null)
    const r = await api.post<SessionInfo>('/api/glue/sessions', { ...f, connections: f.connections.split(',').map((x) => x.trim()).filter(Boolean) }, 'the session')
    setStarting(false)
    if (!r.ok) { setCreateErr(`${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}`); return }
    setCreating(false); setSel(r.value.id); void load()
    useToast.getState().done(`${shortName(r.value)} starting`, 'Spark takes a minute or two to come up.')
  }
  const stop = async (s: SessionInfo) => {
    if (!await confirm({ title: `Stop ${shortName(s)}?`, confirmLabel: 'Stop the session', body: `Billing ends when it stops. Anything held in the session — DataFrames, variables, cached tables — is lost; the statement history is kept. It has cost ${money(spent(s))} so far.` })) return
    await tell('stop the session', api.post(`/api/glue/sessions/${encodeURIComponent(s.id)}/stop`, {}, 'stopping'), 'Session stopping'); void load()
  }
  const del = async (s: SessionInfo) => {
    if (!await confirm({ title: `Delete ${shortName(s)}?`, danger: true, confirmLabel: 'Delete', body: 'This removes the session record and its statement history from your account. A live session is stopped first.' })) return
    await tell('delete the session', api.del(`/api/glue/sessions/${encodeURIComponent(s.id)}`, 'deleting'), 'Session deleted'); setSel(null); void load()
  }

  const reason = useSurfaceReason('sessions')
  if (reason) return reason
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading sessions…" />

  const live = list.filter((s) => isLive(s.status))
  const past = list.filter((s) => !isLive(s.status))
  const burn = live.reduce((n, s) => n + perHour(s), 0)

  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <div className="panel" style={{ width: 264, flex: 'none' }}>
        <div className="panel-head">
          <span className="eyebrow">Sessions</span><span className="fill" />
          <button className="quiet" aria-label="Refresh the session list" onClick={() => void load()}><Icon name="refresh" size={12} /></button>
        </div>
        <div style={{ padding: 'var(--s2) var(--s3)' }}>
          <button className="primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setCreating(true); setCreateErr(null) }}>
            <Icon name="plus" />New session
          </button>
          {live.length > 0 && (
            <div className="burn" title="What every live session in this region is costing together">
              <span className="dot live" style={{ color: 'var(--warn)' }} />
              {live.length} live · ≈ {money(burn)}/hr
            </div>)}
        </div>
        <div className="fill" style={{ overflow: 'auto', paddingBottom: 'var(--s2)' }}>
          {list.length === 0 && <div className="faint small" style={{ padding: 'var(--s3)' }}>No sessions in this region.</div>}
          {live.length > 0 && <div className="list-group">Live</div>}
          {live.map((s) => <SessionRow key={s.id} s={s} on={s.id === sel} onPick={() => setSel(s.id)} />)}
          {past.length > 0 && <div className="list-group">Ended</div>}
          {past.map((s) => <SessionRow key={s.id} s={s} on={s.id === sel} onPick={() => setSel(s.id)} />)}
        </div>
      </div>

      <div className="fill" style={{ minWidth: 0 }}>
        {cur
          ? <Workspace key={cur.id} session={cur} onStop={() => void stop(cur)} onDelete={() => void del(cur)} onChanged={load} />
          : (
            <EmptyState title={list.length ? 'Pick a session' : 'No interactive session yet'}
              actions={<button className="primary" onClick={() => { setCreating(true); setCreateErr(null) }}><Icon name="plus" />New session</button>}>
              A session runs Spark in your account, so it can read the Data Catalog, a JDBC source and
              anything inside a VPC — none of which the local Glue container can reach. It bills by the
              minute while it lives and stops itself when it goes idle.
            </EmptyState>)}
      </div>
      {creating && <NewSession busy={starting} error={createErr} onCancel={() => setCreating(false)} onStart={(f) => void create(f)} />}
    </div>
  )
}

function SessionRow({ s, on, onPick }: { s: SessionInfo; on: boolean; onPick: () => void }) {
  const age = ageMs(s)
  const kind = origin(s)
  return (
    <button className={'sess-row' + (on ? ' on' : '')} onClick={onPick} title={s.id}>
      <span className={'dot' + (s.status === 'READY' ? ' live' : '')}
        style={{ color: s.status === 'READY' ? 'var(--add)' : s.status === 'PROVISIONING' ? 'var(--accent)' : 'var(--faint)' }} />
      <span className="col fill" style={{ gap: 2, minWidth: 0, alignItems: 'flex-start' }}>
        <span className="sess-name">{shortName(s)}</span>
        <span className="faint micro">
          {s.status.toLowerCase()} · {s.workerType} × {s.numberOfWorkers}
          {age != null && ` · ${dur(age)}`}
        </span>
      </span>
      {kind !== 'keel' && <span className="pill micro" title={kind === 'studio' ? 'Started by the AWS console, not by Keel' : 'Started outside Keel'}>{kind === 'studio' ? 'console' : 'external'}</span>}
    </button>
  )
}

/** The header is the honest part: what it is, what it costs, and how long before it stops itself. */
function Workspace({ session, onStop, onDelete, onChanged }: { session: SessionInfo; onStop: () => void; onDelete: () => void; onChanged: () => Promise<void> }) {
  const [history, setHistory] = useState<{ readable: boolean; why?: string; statements: StatementResult[] } | null>(null)
  const [pending, setPending] = useState<Cell[]>([])
  const [tick, setTick] = useState(0)

  const loadStatements = useCallback(async () => {
    const r = await api.get<{ readable: boolean; why?: string; statements: StatementResult[] }>(
      `/api/glue/sessions/${encodeURIComponent(session.id)}/statements`, 'the statement history')
    setHistory(r.ok ? r.value : { readable: false, statements: [], why: r.fault.why })
  }, [session.id])
  useEffect(() => { setHistory(null); setPending([]); void loadStatements() }, [loadStatements])
  // the countdown has to move on its own, not only when the 15s session poll lands
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 20_000); return () => clearInterval(t) }, [])

  const statements = history?.statements ?? []
  const cells = useMemo(() => [...statements.map(toCell), ...pending], [statements, pending])
  const ready = session.status === 'READY'
  const busy = pending.length > 0
  const idle = idleLeftMin(session, statements, Date.now() + tick * 0)
  const age = ageMs(session)

  const run = async (code: string) => {
    const key = 'p' + Date.now()
    setPending([{ key, code, state: 'running' }])
    const op = useOps.getState().start(`Statement on ${shortName(session)}`)
    const r = await api.post<StatementResult>(`/api/glue/sessions/${encodeURIComponent(session.id)}/statements`, { code }, 'the statement', 16 * 60_000)
      .finally(() => useOps.getState().finish(op))
    setPending([])
    if (!r.ok) setPending([{ key, code, state: 'error', error: `${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}` }])
    await loadStatements()
    void onChanged()
  }
  const cancel = async (c: Cell) => {
    if (c.n == null) return
    await tell('cancel the statement', api.post(`/api/glue/sessions/${encodeURIComponent(session.id)}/statements/${c.n}/cancel`, {}, 'cancelling'), 'Statement cancelled')
    await loadStatements()
  }

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="toolbar">
        <div className="subject">
          <span className="name">{shortName(session)}</span>
          <span className={'pill ' + (ready ? 'ok' : session.status === 'PROVISIONING' ? 'info' : session.errorMessage ? 'err' : '')}>
            {session.status === 'PROVISIONING' && <span className="dot live" />}{session.status.toLowerCase()}
          </span>
        </div>
        <span className="dim small mono" title={session.id}>{session.glueVersion} · {session.workerType} × {session.numberOfWorkers} · {dpu(session.workerType, session.numberOfWorkers)} DPU</span>
        <span className="fill" />
        {isLive(session.status) && (
          <div className="meter" title={`Glue's standard $${RATE} per DPU-hour; your region may differ`}>
            <span className="meter-v fig">≈ {money(perHour(session))}<span className="faint">/hr</span></span>
            <span className="faint micro">{money(spent(session))} so far{age != null && ` · up ${dur(age)}`}</span>
          </div>)}
        {idle != null && (
          <div className={'meter' + (idle <= 5 ? ' warn' : '')} title="Glue stops the session by itself after this much idle time">
            <span className="meter-v fig">{idle}m</span><span className="faint micro">till auto-stop</span>
          </div>)}
        <button disabled={!isLive(session.status)} onClick={onStop}><Icon name="stop" />Stop</button>
        <button className="quiet danger" aria-label="Delete this session" title="Delete the session and its history" onClick={onDelete}><Icon name="trash" /></button>
      </div>

      {session.status === 'PROVISIONING' && (
        <div className="banner">
          <span className="dot live" style={{ color: 'var(--accent)' }} />
          Starting Spark in your account. This usually takes a minute or two, and billing has already begun.
        </div>)}
      {session.errorMessage && <pre className="err" style={{ margin: 'var(--s3)' }}>{session.errorMessage}</pre>}

      {history === null
        ? <EmptyState title="Reading the statement history…" />
        : <Notebook cells={cells} ready={ready} busy={busy} onRun={(c) => void run(c)} onCancel={(c) => void cancel(c)}
            lost={!history.readable ? (history.why ?? 'The history could not be read.') : undefined}
            hint={cells.length ? `${cells.length} statement${cells.length > 1 ? 's' : ''} · one Spark context` : undefined} />}
    </div>
  )
}

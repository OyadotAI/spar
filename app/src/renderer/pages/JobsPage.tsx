import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { Icon } from '@/shell/Icon'
import { useApp } from '@/stores/app'
import { useGlue, filteredJobs } from '@/stores/glue'
import { useTerminal } from '@/stores/terminal'
import { useLanes } from '@/stores/lanes'
import { ago, duration, isRunning, stateTone } from '@/shell/format'
import { ProfilePicker } from '@/pages/ProfilePicker'
import type { GlueJob, MonitorReply } from '@/wire/types'
import { api } from '@/api/client'
import { onEvent } from '@/events'

const COLS = 'minmax(220px, 2fr) 90px 80px 60px 110px 130px 110px 100px 90px'

function useMonitor(enabled: boolean, hours: number): MonitorReply | null {
  const [m, setM] = useState<MonitorReply | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const load = () => void api.get<MonitorReply>(`/api/glue/monitor?hours=${hours}`, 'the monitoring summary').then((r) => { if (live && r.ok) setM(r.value) })
    load()
    const off = onEvent((k) => { if (k === 'run.changed' || k === 'jobs.changed') load() })
    return () => { live = false; off() }
  }, [enabled, hours])
  return m
}

function Tiles({ m, hours, setHours }: { m: MonitorReply; hours: number; setHours: (h: number) => void }) {
  const T = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => <div className="tile"><span className="eyebrow">{k}</span><div className="n" style={tone ? { color: tone } : undefined}>{v}</div></div>
  const rate = m.total ? Math.round((m.succeeded / Math.max(1, m.succeeded + m.failed)) * 100) : null
  return (
    <div className="tiles">
      <div className="tile"><span className="eyebrow">Runs</span><div className="row" style={{ marginTop: 4 }}><span className="n" style={{ marginTop: 0 }}>{m.total}</span><span className="fill" />
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ fontSize: 11, padding: '1px 18px 1px 6px' }}><option value={24}>24h</option><option value={72}>3d</option><option value={168}>7d</option><option value={720}>30d</option></select></div></div>
      <T k="Success rate" v={rate == null ? '—' : `${rate}%`} tone={rate != null && rate < 100 ? 'var(--warn)' : undefined} />
      <T k="Succeeded" v={m.succeeded} tone={m.succeeded ? 'var(--add)' : undefined} />
      <T k="Failed" v={m.failed} tone={m.failed ? 'var(--del)' : undefined} />
      <T k="Running now" v={m.running} tone={m.running ? 'var(--accent)' : undefined} />
      <T k="Stopped" v={m.stopped} />
      <T k="DPU-hours" v={m.dpuHours.toFixed(2)} />
      <T k="Execution hours" v={m.executionHours.toFixed(2)} />
    </div>
  )
}

export function JobsPage({ onOpen }: { onOpen: (job: { name: string }) => void }) {
  const { state, connection, deathReason, toggle } = useApp()
  const { jobs, local, loaded, failure, auth, query, setQuery, refresh, refreshLocal, createLocal } = useGlue()
  const [newName, setNewName] = useState<string | null>(null)
  const [newErr, setNewErr] = useState<string | null>(null)
  const rows = useMemo(() => filteredJobs(jobs, query), [jobs, query])
  const openTerminal = useTerminal((s) => s.openWith)
  useEffect(() => { if (!loaded && connection === 'connected') { void refresh(); void refreshLocal() } }, [loaded, connection, refresh, refreshLocal])
  const drafts = local.filter((l) => !jobs.some((j) => j.name === l.name))
  const [hours, setHours] = useState(24)
  const monitor = useMonitor(loaded && auth.kind === 'ok' && jobs.length > 0, hours)
  const importJson = async () => {
    const f = await window.keel.openText(); if (!f) return
    try { const def = JSON.parse(f.text) as Record<string, unknown>; const j = (def.Job ?? def) as Record<string, unknown>; const name = String(j.Name ?? f.name.replace(/\.json$/, ''))
      const r = await api.post<{ name: string }>(`/api/glue/jobs/${encodeURIComponent(name)}/import-json`, j, 'importing the job'); if (!r.ok) setNewErr(r.fault.why); else { void refresh(); onOpen({ name }) } } catch (e) { setNewErr((e as Error).message) }
  }
  const running = jobs.filter((j) => isRunning(j.latestRun?.state)).length
  const create = async () => {
    const name = (newName ?? '').trim()
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { setNewErr('letters, digits, dot, dash and underscore only'); return }
    const f = await createLocal(name)
    if (f) { setNewErr(f.why); return }
    setNewName(null); onOpen({ name }); useLanes.getState().setTab(name, 'authoring')
  }

  let body: React.ReactNode
  if (connection === 'dead') body = <EmptyState title="The daemon stopped">{deathReason}</EmptyState>
  else if (!state || (!loaded && connection !== 'connected')) body = <EmptyState title="Starting…">Waiting for the daemon.</EmptyState>
  else if (!state.tools.aws.installed) body = <EmptyState title="The aws CLI is not on PATH">Keel uses it for job definitions and SSO sign-in. Install it from aws.amazon.com/cli, then restart Keel.</EmptyState>
  else if (auth.kind === 'noProfile') body = (
    <EmptyState title="No AWS profile selected" actions={<button className="primary" onClick={() => toggle('showSettings', true)}>Choose or add a profile…</button>}>
      Pick a profile from ~/.aws/config, or add an IAM Identity Center (SSO) one.
    </EmptyState>)
  else if (auth.kind === 'expired') body = (
    <EmptyState title={`Sign in to ${state.profile}`} actions={<button className="primary" onClick={() => openTerminal(auth.fix)}>Sign in</button>}>
      The SSO session has expired. Signing in runs <code>{auth.fix}</code> in the terminal; the list fills on its own once it succeeds.
    </EmptyState>)
  else if (failure) body = <FaultState fault={failure} retry={() => void refresh()} />
  else if (!loaded) body = <EmptyState title="Reading jobs…">First look at {state.region ?? 'the region'}.</EmptyState>
  else if (jobs.length === 0) body = <EmptyState title={`No Glue jobs in ${state.region ?? 'this region'}`} actions={<button className="primary" onClick={() => { setNewName(''); setNewErr(null) }}><Icon name="plus" />New job</button>}>Jobs created in the console or by API appear here within a few seconds.</EmptyState>
  else if (rows.length === 0) body = <EmptyState title="No job matches">Nothing named like “{query}”.</EmptyState>
  else body = <Table rows={rows} onOpen={onOpen} />

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <div className="sub">{loaded && auth.kind === 'ok' ? <>{jobs.length} in <span className="fig">{state?.region}</span>{running ? <> · <span style={{ color: 'var(--accent)' }}>{running} running</span></> : ''}{drafts.length ? <> · {drafts.length} local draft{drafts.length > 1 ? 's' : ''}</> : ''}</> : 'AWS Glue, live'}</div>
        </div>
        <span className="fill" />
        <div className="row">
          <ProfilePicker />
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--faint)' }} />
            <input placeholder="Search jobs" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 220, paddingLeft: 26 }} />
          </div>
          <button onClick={() => { setNewName(''); setNewErr(null) }} title="A job that lives only here until you deploy it"><Icon name="plus" />New job</button>
          <button className="quiet" onClick={() => void importJson()} title="Create a job from an exported job JSON"><Icon name="download" />Import</button>
          <button className="quiet" onClick={() => void refresh()} title="Re-read now (the list also updates on its own)"><Icon name="refresh" /></button>
        </div>
      </div>
      {drafts.length > 0 && (
        <div className="drafts row" style={{ flexWrap: 'wrap' }}>
          <span className="eyebrow">Local only</span>
          {drafts.map((l) => <button key={l.name} className="quiet" onClick={() => onOpen({ name: l.name })} title={`jobs/${l.name} on ${l.lane.branch ?? 'the project branch'} — not in AWS yet`}>{l.name}<span className="pill">draft</span></button>)}
        </div>)}
      {monitor && loaded && auth.kind === 'ok' && jobs.length > 0 && <Tiles m={monitor} hours={hours} setHours={setHours} />}
      <div className="fill" style={{ minHeight: 0 }}>{body}</div>
      {newName !== null && (
        <div className="sheet-backdrop" onClick={() => setNewName(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
            <h2 style={{ marginBottom: 6 }}>New job</h2>
            <p className="dim" style={{ margin: '0 0 12px' }}>Creates <code>jobs/&lt;name&gt;</code> on its own branch. It reaches AWS only when you deploy.</p>
            <input autoFocus className="mono" placeholder="orders-daily-etl" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: '100%' }} onKeyDown={(e) => { if (e.key === 'Enter') void create() }} />
            {newErr && <div style={{ color: 'var(--del)', fontSize: 12, marginTop: 6 }}>{newErr}</div>}
            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button onClick={() => setNewName(null)}>Cancel</button><button className="primary" onClick={() => void create()}>Create</button></div>
          </div>
        </div>)}
    </div>
  )
}

function Table({ rows, onOpen }: { rows: GlueJob[]; onOpen: (j: GlueJob) => void }) {
  const parent = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ job: GlueJob; x: number; y: number } | null>(null)
  const refresh = useGlue((s) => s.refresh)
  const act = async (j: GlueJob, what: 'run' | 'clone' | 'delete' | 'export') => {
    setMenu(null)
    if (what === 'run') { await api.post(`/api/glue/jobs/${encodeURIComponent(j.name)}/runs`, {}, `starting ${j.name}`) }
    else if (what === 'clone') { const n = window.prompt('Name for the copy', `${j.name}-copy`); if (n) { const r = await api.post<{ name: string }>(`/api/glue/jobs/${encodeURIComponent(j.name)}/clone`, { newName: n }, 'cloning'); if (!r.ok) window.alert(r.fault.why); else void refresh() } }
    else if (what === 'delete') { if (window.confirm(`Delete the Glue job "${j.name}" from AWS? The local folder, if any, stays.`)) { const r = await api.del(`/api/glue/jobs/${encodeURIComponent(j.name)}`, 'deleting'); if (!r.ok) window.alert(r.fault.why); else void refresh() } }
    else if (what === 'export') { const r = await api.get<unknown>(`/api/glue/jobs/${encodeURIComponent(j.name)}/export`, 'exporting'); if (r.ok) void window.keel.saveText(`${j.name}.json`, JSON.stringify(r.value, null, 2)) }
  }
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 36, overscan: 12 })
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="jobs-head" style={{ gridTemplateColumns: COLS }}>
        <span>Name</span><span>Type</span><span>Mode</span><span>Glue</span><span>Workers</span><span>Last run</span><span>Started</span><span>Modified</span><span>Duration</span>
      </div>
      <div ref={parent} className="fill" style={{ overflow: 'auto' }} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' && selected) { const j = rows.find((r) => r.name === selected); if (j) onOpen(j) } }}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const j = rows[it.index]!; const r = j.latestRun
            return (
              <div key={j.name} className={'jobs-row' + (selected === j.name ? ' selected' : '')} style={{ gridTemplateColumns: COLS, transform: `translateY(${it.start}px)`, height: it.size }}
                onClick={() => setSelected(j.name)} onDoubleClick={() => onOpen(j)} onContextMenu={(e) => { e.preventDefault(); setSelected(j.name); setMenu({ job: j, x: e.clientX, y: e.clientY }) }}>
                <span className="row" style={{ gap: 8, minWidth: 0 }}>
                  <span className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span>
                  {j.local?.imported && <span className="pill" title="has a local folder">local</span>}
                  {j.local?.remoteChanged && <span className="pill warn" title="changed in AWS since you imported it">remote changed</span>}
                </span>
                <span className="dim small">{j.commandName === 'gluestreaming' ? 'Streaming' : j.commandName === 'pythonshell' ? 'Python shell' : j.commandName === 'glueray' ? 'Ray' : 'Spark'}</span>
                <span className="dim small">{(j.jobMode ?? 'SCRIPT').toLowerCase()}</span>
                <span className="dim fig small">{j.glueVersion ?? '—'}</span>
                <span className="dim fig small">{j.workerType ? `${j.workerType} × ${j.numberOfWorkers ?? '?'}` : '—'}</span>
                <span>{r ? <span className={'pill ' + stateTone(r.state)}>{isRunning(r.state) && <span className="dot live" />}{r.state.toLowerCase()}</span> : <span className="faint small">never ran</span>}</span>
                <span className="dim fig small" title={r?.startedOn}>{ago(r?.startedOn)}</span>
                <span className="dim fig small" title={j.lastModifiedOn}>{ago(j.lastModifiedOn)}</span>
                <span className="row dim fig small" style={{ gap: 4 }}>{duration(r?.executionTime, r?.startedOn, isRunning(r?.state))}<span className="fill" /><button className="quiet" style={{ padding: 2 }} onClick={(e) => { e.stopPropagation(); setMenu({ job: j, x: e.clientX, y: e.clientY }) }}><Icon name="more" size={14} /></button></span>
              </div>)
          })}
        </div>
      </div>
      {menu && (
        <div className="sheet-backdrop" style={{ background: 'transparent', backdropFilter: 'none' }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}>
          <div className="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 200), position: 'fixed' }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setMenu(null); onOpen(menu.job) }}><Icon name="folder" />Open</button>
            <button onClick={() => void act(menu.job, 'run')}><Icon name="play" />Run</button>
            <div className="sep" />
            <button onClick={() => void act(menu.job, 'clone')}><Icon name="copy" />Clone…</button>
            <button onClick={() => void act(menu.job, 'export')}><Icon name="download" />Export JSON…</button>
            <div className="sep" />
            <button className="danger" onClick={() => void act(menu.job, 'delete')}><Icon name="trash" />Delete from AWS…</button>
          </div>
        </div>)}
    </div>
  )
}

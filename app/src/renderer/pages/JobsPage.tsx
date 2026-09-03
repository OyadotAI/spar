import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { Icon } from '@/shell/Icon'
import { Seg } from '@/shell/Seg'
import { useApp } from '@/stores/app'
import { useGlue, filteredJobs, type LocalJob } from '@/stores/glue'
import { useTerminal } from '@/stores/terminal'
import { useLanes } from '@/stores/lanes'
import { ago, duration, isRunning, stateTone } from '@/shell/format'
import { ProfilePicker } from '@/pages/ProfilePicker'
import type { GlueJob, MonitorReply } from '@/wire/types'
import { api } from '@/api/client'
import { tell, useToast } from '@/shell/Toast'
import { confirm } from '@/shell/Confirm'
import { useEscape } from '@/shell/useEscape'
import { prompt } from '@/shell/Prompt'
import { onEvent } from '@/events'
import { RunSheet } from '@/console/RunSheet'
import { Sheet } from '@/shell/Sheet'


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

/**
 * The run summary, as one strip rather than eight cards.
 *
 * This page is a list of jobs; the dashboard is the Monitoring section next door. Eight equal-weight
 * tiles wrapping into a ragged grid pushed the actual content below the fold and made nothing look
 * primary. Same numbers, one line, no boxes — and only the failure count keeps a colour.
 */
function Summary({ m, hours, setHours }: { m: MonitorReply; hours: number; setHours: (h: number) => void }) {
  const rate = m.total ? Math.round((m.succeeded / Math.max(1, m.succeeded + m.failed)) * 100) : null
  const S = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
    <div className="stat"><span className="k">{k}</span><span className="v" style={tone ? { color: tone } : undefined}>{v}</span></div>)
  return (
    <div className="stats">
      <div className="stat">
        <label className="k" htmlFor="stats-range">Runs</label>
        <span className="row" style={{ gap: 6 }}>
          <span className="v">{m.total}</span>
          <select id="stats-range" className="quiet-select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={24}>24h</option><option value={72}>3d</option><option value={168}>7d</option><option value={720}>30d</option>
          </select>
        </span>
      </div>
      <S k="Success" v={rate == null ? '—' : `${rate}%`} />
      <S k="Succeeded" v={m.succeeded} />
      <S k="Failed" v={m.failed} tone={m.failed ? 'var(--del)' : undefined} />
      <S k="Running" v={m.running} tone={m.running ? 'var(--accent)' : undefined} />
      <S k="Stopped" v={m.stopped} />
      <S k="DPU-hours" v={m.dpuHours.toFixed(2)} />
      <S k="Exec hours" v={m.executionHours.toFixed(2)} />
    </div>
  )
}

export function JobsPage({ onOpen }: { onOpen: (job: { name: string }) => void }) {
  const { state, connection, deathReason, toggle } = useApp()
  const { jobs, local, loaded, failure, auth, query, setQuery, refresh, refreshLocal, createLocal, stale, offline, refreshedAt } = useGlue()
  const [newName, setNewName] = useState<string | null>(null)
  const [newErr, setNewErr] = useState<string | null>(null)
  const [scope, setScope] = useState<'all' | 'local' | 'aws'>('all')
  const rows = useMemo(() => filteredJobs(jobs, query), [jobs, query])
  const openTerminal = useTerminal((s) => s.openWith)
  useEffect(() => { if (!loaded && connection === 'connected') { void refresh(); void refreshLocal() } }, [loaded, connection, refresh, refreshLocal])
  const drafts = local.filter((l) => !jobs.some((j) => j.name === l.name))
  const draftRows = useMemo(() => {
    const n = query.trim().toLowerCase()
    return n ? drafts.filter((l) => l.name.toLowerCase().includes(n)) : drafts
  }, [drafts, query])
  const [hours, setHours] = useState(24)
  useEscape(newName !== null, () => setNewName(null))
  const monitor = useMonitor(loaded && auth.kind === 'ok' && jobs.length > 0, hours)
  const importJson = async () => {
    const f = await window.keel.openText(); if (!f) return
    try { const def = JSON.parse(f.text) as Record<string, unknown>; const j = (def.Job ?? def) as Record<string, unknown>; const name = String(j.Name ?? f.name.replace(/\.json$/, ''))
      const r = await api.post<{ name: string }>(`/api/glue/jobs/${encodeURIComponent(name)}/import-json`, j, 'importing the job')
      if (!r.ok) useToast.getState().fail('import the job', r.fault); else { useToast.getState().done(`${name} created in AWS`); void refresh(); onOpen({ name }) } } catch (e) { useToast.getState().push({ kind: 'bad', title: 'That file is not a job definition', detail: (e as Error).message }) }
  }
  const running = jobs.filter((j) => isRunning(j.latestRun?.state)).length
  const create = async () => {
    const name = (newName ?? '').trim()
    if (!/^[A-Za-z0-9._-]+$/.test(name)) { setNewErr('letters, digits, dot, dash and underscore only'); return }
    const f = await createLocal(name)
    if (f) { setNewErr(f.why); return }
    setNewName(null); onOpen({ name }); useLanes.getState().setTab(name, 'authoring')
  }

  const hasAnyJobs = rows.length > 0 || draftRows.length > 0

  let body: React.ReactNode
  if (connection === 'dead') body = <EmptyState icon="bad" title="The daemon stopped">{deathReason}</EmptyState>
  else if (!state || (!loaded && connection !== 'connected')) body = <EmptyState icon="spinner" title="Starting…">Waiting for the daemon.</EmptyState>
  else if (!state.tools.aws.installed && !hasAnyJobs) body = <EmptyState icon="warn" title="The aws CLI is not on PATH">Keel uses it for job definitions and SSO sign-in. Install it from aws.amazon.com/cli, then restart Keel.</EmptyState>
  else if (auth.kind === 'noProfile' && !hasAnyJobs) body = (
    <EmptyState icon="gear" title="No AWS profile selected"
      actions={<>
        <button className="primary" onClick={() => { setNewName(''); setNewErr(null) }}><Icon name="plus" />Start a local job</button>
        <button onClick={() => toggle('showSettings', true)}>Connect AWS…</button>
      </>}>
      Building a pipeline, generating its code, running its tests and running it on sample data all happen on this machine.
      AWS is needed only to import an existing job, to deploy, and to run in the cloud.
    </EmptyState>)
  else if (auth.kind === 'expired' && !hasAnyJobs) body = (
    <EmptyState icon="terminal" title={`Sign in to ${state.profile}`} actions={<button className="primary" onClick={() => openTerminal(auth.fix)}>Sign in</button>}>
      The SSO session has expired. Signing in runs <code>{auth.fix}</code> in the terminal; the list fills on its own once it succeeds.
    </EmptyState>)
  else if (failure && !hasAnyJobs) body = <FaultState fault={failure} retry={() => void refresh()} />
  else if (!loaded && !hasAnyJobs) body = <EmptyState icon="spinner" title="Reading jobs…">First look at {state.region ?? 'the region'}.</EmptyState>
  else if (!hasAnyJobs && query) body = <EmptyState icon="search" title="No job matches">Nothing named like “{query}”.</EmptyState>
  else if (!hasAnyJobs) body = <EmptyState icon="keel" title={`No Glue jobs in ${state?.region ?? 'this region'}`} actions={<button className="primary" onClick={() => { setNewName(''); setNewErr(null) }}><Icon name="plus" />New job</button>}>Jobs created in the console or by API appear here within a few seconds.</EmptyState>
  else body = (
    <div className="col" style={{ height: '100%' }}>
      {auth.kind === 'noProfile' && (
        <div className="banner">
          <Icon name="info" size={14} />
          <span className="fill">No AWS profile selected — showing local drafts. Connect an AWS account to see cloud jobs.</span>
          <button className="quiet" onClick={() => toggle('showSettings', true)} style={{ textDecoration: 'underline' }}>Connect AWS…</button>
        </div>
      )}
      <div className="fill" style={{ minHeight: 0 }}>
        <Table rows={scope === 'local' ? [] : rows} drafts={scope === 'aws' ? [] : draftRows} onOpen={onOpen} />
      </div>
    </div>
  )

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <div className="sub">{loaded && auth.kind === 'ok' ? <>{jobs.length} in <span className="fig">{state?.region}</span>{running ? <> · <span style={{ color: 'var(--accent)' }}>{running} running</span></> : ''}{drafts.length ? <> · {drafts.length} local draft{drafts.length > 1 ? 's' : ''}</> : ''}</> : drafts.length ? `${drafts.length} local draft${drafts.length > 1 ? 's' : ''}` : 'AWS Glue, live'}</div>
        </div>
        <span className="fill" />
        <div className="row" style={{ gap: 8 }}>
          {hasAnyJobs && (
            <Seg
              label="Job filter"
              value={scope}
              onChange={setScope}
              options={[
                ['all', `All (${drafts.length + jobs.length})`],
                ['local', `Local (${drafts.length})`],
                ['aws', `In AWS (${jobs.length})`],
              ] as const}
            />
          )}
          <ProfilePicker />
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--faint)' }} />
            <input placeholder="Search jobs" data-search aria-label="Search jobs" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 180, paddingLeft: 26 }} />
          </div>
          <button className="primary" onClick={() => { setNewName(''); setNewErr(null) }} title="A job that lives only here until you deploy it"><Icon name="plus" />New job</button>
          <button className="quiet" onClick={() => void importJson()} title="Create a job from an exported job JSON"><Icon name="download" />Import</button>
          <button className="quiet" onClick={() => void refresh()} aria-label="Refresh the job list" title="Re-read now (the list also updates on its own)"><Icon name="refresh" /></button>
        </div>
      </div>
      {stale && (
        <div className="row offline-note">
          <Icon name="clock" size={13} />
          <span className="fill">Showing the last listing{refreshedAt ? `, as of ${ago(refreshedAt)}` : ''}. {offline ?? 'AWS has not answered yet.'}</span>
          <button className="quiet" onClick={() => void refresh()}>Try again</button>
        </div>)}
      {monitor && loaded && auth.kind === 'ok' && jobs.length > 0 && <Summary m={monitor} hours={hours} setHours={setHours} />}
      <div className="fill" style={{ minHeight: 0 }}>{body}</div>
      {newName !== null && (
        <Sheet label="New job" width={440} onClose={() => setNewName(null)} dirty={newName.length > 0}>
          <h2>New job</h2>
          <p className="dim" style={{ marginTop: 0 }}>Creates <code>jobs/&lt;name&gt;</code> on its own branch. It reaches AWS only when you deploy.</p>
          <input autoFocus className="mono" aria-label="Job name" placeholder="orders-daily-etl" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: '100%' }} onKeyDown={(e) => { if (e.key === 'Enter') void create() }} />
          {newErr && <div className="small" style={{ color: 'var(--del)', marginTop: 6 }} role="alert">{newErr}</div>}
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button onClick={() => setNewName(null)}>Cancel</button><button className="primary" onClick={() => void create()}>Create</button></div>
        </Sheet>)}
    </div>
  )
}

/**
 * One list, two sections.
 *
 * Local-only jobs used to sit in a chip strip above the table, which read as a notice rather than
 * as jobs — so the page showed two things in two shapes. They are rows now, under a "Local" head,
 * with what a job that has never reached AWS can honestly say and dashes for the rest.
 */
type Item =
  | { kind: 'head'; key: string; label: string; note: string }
  | { kind: 'job'; key: string; job: GlueJob }
  | { kind: 'draft'; key: string; draft: LocalJob }

function Table({ rows, drafts, onOpen }: { rows: GlueJob[]; drafts: LocalJob[]; onOpen: (j: { name: string }) => void }) {
  const parent = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  // one click opens the actions menu: double-click-to-open was the only way in and nothing said so
  const [menu, setMenu] = useState<{ job?: GlueJob; draft?: LocalJob; x: number; y: number } | null>(null)
  // Run means the same thing here as it does in a job tab: the arguments sheet, then the run.
  // It used to fire a real cloud run straight from the context menu with no arguments and no confirm.
  const [runFor, setRunFor] = useState<GlueJob | null>(null)
  const refresh = useGlue((s) => s.refresh)
  const act = async (j: GlueJob, what: 'run' | 'clone' | 'delete' | 'export') => {
    setMenu(null)
    if (what === 'run') {
      setRunFor(j)
    } else if (what === 'clone') {
      const n = await prompt({ title: `Clone ${j.name}`, body: 'A copy of the job definition, including its DAG, under a new name in AWS.', value: `${j.name}-copy`, mono: true, confirmLabel: 'Clone' })
      if (n && await tell('clone the job', api.post<{ name: string }>(`/api/glue/jobs/${encodeURIComponent(j.name)}/clone`, { newName: n }, 'cloning'), `Cloned to ${n}`)) void refresh()
    } else if (what === 'delete') {
      const ok = await confirm({ title: `Delete ${j.name} from AWS?`, danger: true, typeToConfirm: j.name, confirmLabel: 'Delete job',
        body: 'This removes the job definition and its run history from your AWS account. The local folder, its git branch and its tests stay on this machine.' })
      if (ok && await tell('delete the job', api.del(`/api/glue/jobs/${encodeURIComponent(j.name)}`, 'deleting'), `${j.name} deleted from AWS`)) void refresh()
    } else if (what === 'export') {
      const r = await tell('export the job', api.get<unknown>(`/api/glue/jobs/${encodeURIComponent(j.name)}/export`, 'exporting'))
      if (r) void window.keel.saveText(`${j.name}.json`, JSON.stringify(r, null, 2))
    }
  }
  useEscape(!!menu, () => setMenu(null))
  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    if (drafts.length) {
      out.push({ kind: 'head', key: 'h-local', label: 'Local only', note: `${drafts.length} not in AWS yet — deploy to create them` })
      for (const d of drafts) out.push({ kind: 'draft', key: 'd-' + d.name, draft: d })
    }
    if (rows.length) {
      if (drafts.length) out.push({ kind: 'head', key: 'h-aws', label: 'In AWS', note: `${rows.length} job${rows.length > 1 ? 's' : ''} in this region` })
      for (const j of rows) out.push({ kind: 'job', key: 'j-' + j.name, job: j })
    }
    return out
  }, [rows, drafts])
  const v = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: (i) => (items[i]?.kind === 'head' ? 30 : 36), overscan: 12 })
  return (
    <div className="col jobs-table" style={{ height: '100%' }}>
      <div className="jobs-head">
        <span>Name</span><span className="opt">Type</span><span className="opt">Mode</span><span className="opt">Glue</span><span className="opt">Workers</span>
        <span>Last run</span><span>Started</span><span>Modified</span><span>Duration</span>
      </div>
      <div ref={parent} className="fill" style={{ overflow: 'auto' }} tabIndex={0}
        onKeyDown={(e) => {
          const pickable = items.filter((x) => x.kind !== 'head')
          const at = pickable.findIndex((r) => (r.kind === 'job' ? r.job.name : r.kind === 'draft' ? r.draft.name : '') === selected)
          const nameOf = (x: Item) => (x.kind === 'job' ? x.job.name : x.kind === 'draft' ? x.draft.name : '')
          if (e.key === 'Enter' && at >= 0) onOpen({ name: nameOf(pickable[at]!) })
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const next = Math.min(pickable.length - 1, Math.max(0, (at < 0 ? -1 : at) + (e.key === 'ArrowDown' ? 1 : -1)))
            const j = pickable[next]
            if (j) { setSelected(nameOf(j)); v.scrollToIndex(items.indexOf(j), { align: 'auto' }) }
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault()
            const j = pickable[e.key === 'Home' ? 0 : pickable.length - 1]
            if (j) { setSelected(nameOf(j)); v.scrollToIndex(items.indexOf(j), { align: 'auto' }) }
          }
        }}>
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const item = items[it.index]!
            const style = { transform: `translateY(${it.start}px)`, height: it.size } as const

            if (item.kind === 'head') return (
              <div key={item.key} className="jobs-group" style={style}>
                <span className={'pill ' + (item.key === 'h-local' ? 'info' : 'source')} style={{ marginRight: 6 }}>{item.label}</span>
                <span className="faint">{item.note}</span>
              </div>)

            if (item.kind === 'draft') {
              const l = item.draft
              return (
                <div key={item.key} className={'jobs-row' + (selected === l.name ? ' selected' : '')} style={style}
                  onClick={(e) => { setSelected(l.name); setMenu({ draft: l, x: e.clientX, y: e.clientY }) }}
                  onDoubleClick={() => { setMenu(null); onOpen({ name: l.name }) }}
                  onContextMenu={(e) => { e.preventDefault(); setSelected(l.name); setMenu({ draft: l, x: e.clientX, y: e.clientY }) }}>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <Icon name="route" size={14} style={{ color: 'var(--accent)' }} />
                    <span className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                    <span className="pill info" title={`jobs/${l.name} on ${l.lane.branch ?? 'the project branch'} — not in AWS yet`}>local</span>
                    {l.lane.dirty ? <span className="pill warn" title="uncommitted changes in its lane">{l.lane.dirty} changed</span> : null}
                  </span>
                  {/* a job that has never reached AWS has no type, mode, version or run history */}
                  <span className="dim small opt">{l.hasDag ? 'Spark' : '—'}</span>
                  <span className="dim small opt">{l.hasDag ? 'visual' : '—'}</span>
                  <span className="dim fig small opt">—</span>
                  <span className="dim fig small opt">—</span>
                  <span><span className="pill">local draft</span></span>
                  <span className="dim fig small">—</span>
                  <span className="dim fig small">—</span>
                  <span className="row dim fig small" style={{ gap: 4 }}>{[l.hasScript && 'script', l.hasTests && 'tests'].filter(Boolean).join(' · ') || '—'}<span className="fill" />
                    <button className="quiet" style={{ padding: 2, minHeight: 0 }} aria-label={`Actions for ${l.name}`} onClick={(e) => { e.stopPropagation(); setMenu({ draft: l, x: e.clientX, y: e.clientY }) }}><Icon name="more" size={14} /></button></span>
                </div>)
            }

            const j = item.job; const r = j.latestRun
            return (
              <div key={item.key} className={'jobs-row' + (selected === j.name ? ' selected' : '')} style={style}
                onClick={(e) => { setSelected(j.name); setMenu({ job: j, x: e.clientX, y: e.clientY }) }}
                onDoubleClick={() => { setMenu(null); onOpen(j) }}
                onContextMenu={(e) => { e.preventDefault(); setSelected(j.name); setMenu({ job: j, x: e.clientX, y: e.clientY }) }}>
                <span className="row" style={{ gap: 8, minWidth: 0 }}>
                  <Icon name="database" size={14} style={{ color: 'var(--faint)' }} />
                  <span className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span>
                  {j.local?.imported && <span className="pill ok" title="has a local folder">synced</span>}
                  {j.local?.remoteChanged && <span className="pill warn" title="changed in AWS since you imported it">remote changed</span>}
                </span>
                <span className="dim small opt">{j.commandName === 'gluestreaming' ? 'Streaming' : j.commandName === 'pythonshell' ? 'Python shell' : j.commandName === 'glueray' ? 'Ray' : 'Spark'}</span>
                <span className="dim small opt">{(j.jobMode ?? 'SCRIPT').toLowerCase()}</span>
                <span className="dim fig small opt">{j.glueVersion ?? '—'}</span>
                <span className="dim fig small opt">{j.workerType ? `${j.workerType} × ${j.numberOfWorkers ?? '?'}` : '—'}</span>
                <span>{r ? <span className={'pill ' + stateTone(r.state)}>{isRunning(r.state) && <span className="dot live" />}{r.state.toLowerCase()}</span> : <span className="faint small">never ran</span>}</span>
                <span className="dim fig small" title={r?.startedOn}>{ago(r?.startedOn)}</span>
                <span className="dim fig small" title={j.lastModifiedOn}>{ago(j.lastModifiedOn)}</span>
                <span className="row dim fig small" style={{ gap: 4 }}>{duration(r?.executionTime, r?.startedOn, isRunning(r?.state))}<span className="fill" /><button className="quiet" style={{ padding: 2, minHeight: 0 }} aria-label={`Actions for ${j.name}`} onClick={(e) => { e.stopPropagation(); setMenu({ job: j, x: e.clientX, y: e.clientY }) }}><Icon name="more" size={14} /></button></span>
              </div>)
          })}
        </div>
      </div>
      {runFor && (
        <RunSheet initial={{}} onClose={() => setRunFor(null)} onRun={(args) => {
          const j = runFor; setRunFor(null)
          void tell(`start ${j.name}`, api.post<{ runId: string }>(`/api/glue/jobs/${encodeURIComponent(j.name)}/runs`, { arguments: args }, `starting ${j.name}`))
            .then((r) => { if (r) useToast.getState().done(`${j.name} started`, r.runId.slice(3, 19) + '…') })
        }} />)}
      {menu && (
        <div className="sheet-backdrop" style={{ background: 'transparent', backdropFilter: 'none' }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}>
          <div className="menu" role="menu" aria-label={`Actions for ${menu.job?.name ?? menu.draft!.name}`}
            ref={(el) => el?.querySelector('button')?.focus()}
            style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 210), position: 'fixed' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              e.preventDefault()
              const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
              const at = items.indexOf(document.activeElement as HTMLButtonElement)
              items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus()
            }}>
            <button role="menuitem" onClick={() => { const n = menu.job?.name ?? menu.draft!.name; setMenu(null); onOpen({ name: n }) }}><Icon name="folder" />Open</button>
            {menu.draft && <>
              <div className="sep" />
              <button role="menuitem" onClick={() => { const n = menu.draft!.name; setMenu(null); void import('@/authoring/store').then((m) => m.useAuthoring.getState().deploy(n, true)) }}>
                <Icon name="deploy" />Deploy to AWS…
              </button>
            </>}
            {menu.job && <>
              <button role="menuitem" onClick={() => void act(menu.job!, 'run')}><Icon name="play" />Run…</button>
              <div className="sep" />
              <button role="menuitem" onClick={() => void act(menu.job!, 'clone')}><Icon name="copy" />Clone…</button>
              <button role="menuitem" onClick={() => void act(menu.job!, 'export')}><Icon name="download" />Export JSON…</button>
              <div className="sep" />
              <button role="menuitem" className="danger" onClick={() => void act(menu.job!, 'delete')}><Icon name="trash" />Delete from AWS…</button>
            </>}
          </div>
        </div>)}
    </div>
  )
}

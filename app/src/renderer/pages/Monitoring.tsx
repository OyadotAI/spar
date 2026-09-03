import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAccount } from '@/stores/glue'
import { api, type Fault } from '@/api/client'
import { onEvent } from '@/events'
import { Icon } from '@/shell/Icon'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useSurfaceReason } from '@/shell/useSurfaceReason'
import { StackedBars, StackedColumns, STATUS_KEYS } from '@/shell/Chart'
import { duration, isRunning, stateTone, when } from '@/shell/format'
import type { MonitorReply, MonitorRun } from '@/wire/types'

const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0)
const OUTCOMES = STATUS_KEYS
const bucket = (s: string) => (s === 'SUCCEEDED' ? 'succeeded' : ['FAILED', 'ERROR', 'TIMEOUT'].includes(s) ? 'failed' : ['STOPPED', 'STOPPING', 'EXPIRED'].includes(s) ? 'stopped' : 'running')

/**
 * Runs bucketed over the selected window, from the runs themselves.
 *
 * The daemon's `byDay` is one bucket for a 24-hour window, which is why "Runs by day" used to be a
 * single bar. Bucketing here lets the resolution follow the window: hours for a day, quarter-days
 * for a week, days beyond that.
 */
function overTime(runs: MonitorRun[], hours: number): { label: string; values: Record<string, number> }[] {
  const size = hours <= 24 ? 2 : hours <= 72 ? 6 : hours <= 168 ? 24 : 24     // hours per bucket
  const count = Math.max(1, Math.round(hours / size))
  const now = Date.now()
  const out = Array.from({ length: count }, (_, i) => {
    const at = new Date(now - (count - 1 - i) * size * 3600_000)
    return {
      label: size < 24 ? at.toLocaleTimeString(undefined, { hour: '2-digit' }) : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      values: {} as Record<string, number>,
    }
  })
  for (const r of runs) {
    const t = Date.parse(r.startedOn ?? '')
    if (!Number.isFinite(t)) continue
    const i = count - 1 - Math.floor((now - t) / (size * 3600_000))
    const slot = out[i]
    if (slot) slot.values[bucket(r.state)] = (slot.values[bucket(r.state)] ?? 0) + 1
  }
  return out
}

/** Glue Studio's job run monitoring: the totals, the three breakdowns, and every run in the window. */
export function Monitoring({ onOpen }: { onOpen: (job: string, run?: string) => void }) {
  const account = useAccount()
  const [hours, setHours] = useState(24)
  const [m, setM] = useState<MonitorReply | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [type, setType] = useState('')
  const [worker, setWorker] = useState('')
  const load = async (refresh = false) => {
    const r = await api.get<MonitorReply>(`/api/glue/monitor?hours=${hours}${refresh ? '&refresh=true' : ''}`, 'the monitoring summary')
    if (r.ok) { setM(r.value); setFault(null) } else setFault(r.fault)
  }
  useEffect(() => { void load(); return onEvent((k) => { if (k === 'run.changed' || k === 'jobs.changed') void load() }) }, [hours, account]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (m?.recent ?? []).filter((r) => (!q || r.job.toLowerCase().includes(q.toLowerCase()) || r.id.includes(q))
    && (!state || bucket(r.state) === state) && (!type || r.jobType === type) && (!worker || r.workerType === worker)), [m, q, state, type, worker])
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 32, overscan: 12 })
  // the pane says which reason it is before it says it could not read anything
  const reason = useSurfaceReason('run history')
  if (reason) return reason
  if (fault) return <FaultState fault={fault} retry={() => void load(true)} />
  if (!m) return <EmptyState title="Reading run history…" />
  const types = Object.keys(m.byType ?? {}), workers = Object.keys(m.byWorker ?? {})
  const bars = (o: Record<string, Record<string, number>> | undefined) => Object.entries(o ?? {}).map(([label, values]) => ({ label, values }))
  // which job is failing is the question this page exists to answer; type and worker are filters
  const byJob = Object.entries((m.recent ?? []).reduce<Record<string, Record<string, number>>>((acc, r) => {
    (acc[r.job] ??= {})[bucket(r.state)] = ((acc[r.job] ??= {})[bucket(r.state)] ?? 0) + 1
    return acc
  }, {})).map(([label, values]) => ({ label, values }))
    .sort((a, b) => (b.values.failed ?? 0) - (a.values.failed ?? 0) || sum(b.values) - sum(a.values))
  const rate = m.total ? Math.round((m.succeeded / Math.max(1, m.succeeded + m.failed)) * 100) : null
  const COLS = 'minmax(160px,1.4fr) 110px 150px 90px 80px 90px 100px 1.4fr'
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head">
        <div><h1>Job run monitoring</h1><div className="sub">{m.total} runs in the last {hours >= 24 ? `${hours / 24} day${hours > 24 ? 's' : ''}` : `${hours}h`}</div></div>
        <span className="fill" />
        <div className="row">
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={24}>Last 24 hours</option><option value={72}>Last 3 days</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select>
          <button className="quiet" onClick={() => void load(true)}><Icon name="refresh" /></button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><span className="k">Runs</span><span className="v">{m.total}</span></div>
        <div className="stat"><span className="k">Success</span><span className="v">{rate == null ? '—' : `${rate}%`}</span></div>
        <div className="stat"><span className="k">Failed</span><span className="v" style={m.failed ? { color: 'var(--del)' } : undefined}>{m.failed}</span></div>
        <div className="stat"><span className="k">Running</span><span className="v" style={m.running ? { color: 'var(--accent)' } : undefined}>{m.running}</span></div>
        <div className="stat"><span className="k">Stopped</span><span className="v">{m.stopped}</span></div>
        <div className="stat"><span className="k">DPU-hours</span><span className="v">{m.dpuHours.toFixed(2)}</span></div>
        <div className="stat"><span className="k">Exec hours</span><span className="v">{m.executionHours.toFixed(2)}</span></div>
      </div>
      <div className="chart-grid" style={{ padding: '0 24px 14px' }}>
        <StackedColumns title={`Runs over the last ${hours >= 24 ? `${hours / 24} day${hours > 24 ? 's' : ''}` : `${hours} hours`}`} buckets={overTime(m.recent ?? [], hours)} keys={OUTCOMES} />
        {/* a breakdown with one category is a stat, not a chart — StackedBars renders nothing below two rows */}
        <StackedBars title="Runs by job" data={byJob} keys={OUTCOMES} onPick={(l) => setQ(l === q ? '' : l)} />
        <StackedBars title="Runs by job type" data={bars(m.byType)} keys={OUTCOMES} onPick={(l) => setType(l === type ? '' : l)} />
        <StackedBars title="Runs by worker type" data={bars(m.byWorker)} keys={OUTCOMES} onPick={(l) => setWorker(l === worker ? '' : l)} />
      </div>
      <div className="row" style={{ padding: '0 24px 10px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}><Icon name="search" size={12} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--faint)' }} /><input placeholder="Job or run id" data-search aria-label="Filter by job or run id" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200, paddingLeft: 26 }} /></div>
        <select value={state} onChange={(e) => setState(e.target.value)}><option value="">any status</option>{OUTCOMES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="">any type</option>{types.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={worker} onChange={(e) => setWorker(e.target.value)}><option value="">any worker</option>{workers.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        {(q || state || type || worker) && <button className="quiet" onClick={() => { setQ(''); setState(''); setType(''); setWorker('') }}><Icon name="x" size={12} />clear</button>}
        <span className="fill" /><span className="faint small">{rows.length} of {m.recent.length} shown · DPU-hours {m.dpuHours.toFixed(2)}</span>
      </div>
      <div className="jobs-head" style={{ gridTemplateColumns: COLS }}><span>Job</span><span>Status</span><span>Started</span><span>Duration</span><span>DPU-h</span><span>Type</span><span>Capacity</span><span>Error</span></div>
      <div ref={parent} className="fill" style={{ overflow: 'auto' }}>
        {rows.length === 0 && <div className="faint small" style={{ padding: 16 }}>No run matches.</div>}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => { const r: MonitorRun = rows[it.index]!
            return (
              <div key={r.id} className="jobs-row" style={{ gridTemplateColumns: COLS, transform: `translateY(${it.start}px)`, height: it.size }} onDoubleClick={() => onOpen(r.job, r.id)}>
                <span className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.job}</span>
                <span><span className={'pill ' + stateTone(r.state)}>{isRunning(r.state) && <span className="dot live" />}{r.state.toLowerCase()}</span></span>
                <span className="dim fig small">{when(r.startedOn)}</span>
                <span className="dim fig small">{duration(r.executionTime, r.startedOn, isRunning(r.state))}</span>
                <span className="dim fig small">{r.dpuHours.toFixed(2)}</span>
                <span className="dim small">{r.jobType}</span>
                <span className="dim fig small">{r.workerType ? `${r.numberOfWorkers ?? '?'}×${r.workerType}` : '—'}</span>
                <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.errorMessage ? 'var(--del)' : 'var(--faint)' }} title={r.errorMessage}>{r.errorMessage ?? ''}</span>
              </div>) })}
        </div>
      </div>
    </div>
  )
}

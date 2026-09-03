import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useJob } from '@/stores/job'
import { SplitPane } from '@/shell/SplitPane'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { Icon } from '@/shell/Icon'
import { Seg } from '@/shell/Seg'
import { ago, duration, isRunning, stateTone, when } from '@/shell/format'
import type { GlueRun } from '@/wire/types'
import { RunLinks } from './RunLinks'
import { TriagePanel, LogWhereNote } from './Triage'
import { MetricsPane, InsightsPane, SparkUiPane } from '@/job/RunPanes'
import { RolePrompt } from '@/job/RolePrompt'

export function ConsoleTab({ job }: { job: string }) {
  const st = useJob((s) => s.jobs[job])
  const { refreshRuns, select } = useJob()
  useEffect(() => { if (!st?.loaded) void refreshRuns(job) }, [job, st?.loaded, refreshRuns])
  if (!st || !st.loaded) return <EmptyState title="Reading runs…" />
  if (st.runsFault) return <FaultState fault={st.runsFault} retry={() => void refreshRuns(job)} />
  if (st.runs.length === 0) return <EmptyState title="This job has never run">Start one with Run, or from the console — it shows up here on its own.</EmptyState>
  const run = st.runs.find((r) => r.id === st.selectedRun)
  return (
    <SplitPane vertical storageKey="console.runs" initial={0.3} min={110} minB={220}
      a={<RunsList runs={st.runs} selected={st.selectedRun} onSelect={(id) => select(job, id)} />}
      b={run ? <RunPane job={job} run={run} /> : <EmptyState title="Pick a run" />} />
  )
}

export function RunsList({ runs, selected, onSelect, compact = false }: { runs: GlueRun[]; selected?: string; onSelect: (id: string) => void; compact?: boolean }) {
  const cols = compact ? '1fr 64px' : '120px 1fr 150px 90px 80px 90px 2fr'
  return (
    <div className="col" style={{ height: '100%' }}>
      {!compact && <div className="jobs-head" style={{ gridTemplateColumns: cols, padding: '0 14px' }}><span>State</span><span>Run</span><span>Started</span><span>Duration</span><span>DPU-hours</span><span>Capacity</span><span>Error</span></div>}
      <div className="fill" style={{ overflow: 'auto' }} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
          e.preventDefault()
          const at = runs.findIndex((r) => r.id === selected)
          const next = runs[Math.min(runs.length - 1, Math.max(0, (at < 0 ? -1 : at) + (e.key === 'ArrowDown' ? 1 : -1)))]
          if (next) onSelect(next.id)
        }}>
        {runs.map((r) => (
          <div key={r.id} className={'jobs-row static' + (r.id === selected ? ' selected' : '')} style={{ gridTemplateColumns: cols, height: compact ? 30 : 32, padding: compact ? '0 12px' : '0 14px' }} onClick={() => onSelect(r.id)}>
            <span><span className={'pill ' + stateTone(r.state)}>{isRunning(r.state) && <span className="dot live" />}{r.state.toLowerCase()}</span></span>
            {!compact && <span className="fig dim small" title={r.id}>{r.id.slice(3, 15)}…{r.attempt && r.attempt > 1 ? ` #${r.attempt}` : ''}</span>}
            <span className="dim fig small" title={r.startedOn}>{compact ? ago(r.startedOn) : when(r.startedOn)}</span>
            {!compact && <><span className="dim fig small">{duration(r.executionTime, r.startedOn, isRunning(r.state))}</span>
              <span className="dim fig small">{r.dpuHours != null ? r.dpuHours.toFixed(2) : '—'}</span>
              <span className="dim fig small">{r.workerType ? `${r.numberOfWorkers ?? '?'}×${r.workerType}` : r.maxCapacity ? `${r.maxCapacity} DPU` : '—'}</span>
              <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.errorMessage ? 'var(--del)' : 'var(--faint)' }} title={r.errorMessage}>{r.errorMessage ?? ''}</span></>}
          </div>))}
      </div>
    </div>
  )
}

function RunPane({ job, run }: { job: string; run: GlueRun }) {
  const [pane, setPane] = useState<'logs' | 'metrics' | 'insights' | 'spark'>('logs')
  const body = (
    <div className="col" style={{ height: '100%' }}>
      <div className="seg-bar" style={{ borderTop: '1px solid var(--line)' }}>
        <Seg label="Run detail" value={pane} onChange={setPane}
          options={[['logs', 'Logs'], ['metrics', 'Metrics'], ['insights', 'Insights'], ['spark', 'Spark UI']] as const} />
      </div>
      <div className="fill" style={{ minHeight: 0 }}>
        {pane === 'logs' ? <LogConsole job={job} />
          : pane === 'metrics' ? <MetricsPane job={job} run={run.id} />
          : pane === 'insights' ? <InsightsPane job={job} run={run.id} />
          : <SparkUiPane job={job} run={run.id} />}
      </div>
    </div>)
  return <SplitPane vertical storageKey="console.detail" initial={run.errorMessage ? 0.32 : 0.2} min={80} minB={200} a={<RunDetail job={job} run={run} />} b={body} />
}

function Fact({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return <div className="fact"><span className="eyebrow">{k}</span><span className="v" style={tone ? { color: tone } : undefined}>{v}</span></div>
}

function RunDetail({ job, run }: { job: string; run: GlueRun }) {
  const [showArgs, setShowArgs] = useState(false)
  const args = Object.entries(run.arguments ?? {})
  const tone = stateTone(run.state)
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="facts">
        <Fact k="State" v={<span className={'pill ' + tone}>{isRunning(run.state) && <span className="dot live" />}{run.state.toLowerCase()}</span>} />
        <Fact k="Run" v={<span title={run.id}>{run.id.slice(3, 19)}…{run.attempt && run.attempt > 1 ? ` attempt ${run.attempt}` : ''}</span>} />
        <Fact k="Started" v={when(run.startedOn)} />
        {run.completedOn && <Fact k="Completed" v={when(run.completedOn)} />}
        <Fact k="Duration" v={duration(run.executionTime, run.startedOn, isRunning(run.state))} />
        {run.dpuHours != null && <Fact k="DPU-hours" v={run.dpuHours.toFixed(2)} />}
        {run.triggerName && <Fact k="Triggered by" v={run.triggerName} />}
        {run.workerType && <Fact k="Workers" v={`${run.workerType} × ${run.numberOfWorkers}`} />}
        {run.glueVersion && <Fact k="Glue" v={run.glueVersion} />}
        {run.previousRunId && <Fact k="Retry of" v={run.previousRunId.slice(3, 15) + '…'} />}
        {args.length > 0 && <Fact k="Arguments" v={<button className="quiet" style={{ padding: '0 4px', height: 16 }} onClick={() => setShowArgs(!showArgs)}>{args.length} {showArgs ? '▾' : '▸'}</button>} />}
      </div>
      <div style={{ padding: '0 10px 6px' }}><RunLinks job={job} runId={run.id} /></div>
      {run.stateDetail && <div className="dim small" style={{ padding: '0 14px 8px' }}>{run.stateDetail}</div>}
      {run.errorMessage && <pre className="err" style={{ margin: '0 14px 10px' }}>{run.errorMessage}</pre>}
      {(run.errorMessage || run.state === 'FAILED' || run.state === 'TIMEOUT' || run.state === 'ERROR') && <TriagePanel job={job} run={run.id} />}
      {showArgs && <table className="mono small" style={{ borderCollapse: 'collapse', margin: '0 14px 10px' }}><tbody>
        {args.map(([k, v]) => <tr key={k}><td className="dim" style={{ paddingRight: 14, verticalAlign: 'top' }}>{k}</td><td style={{ wordBreak: 'break-all' }}>{v}</td></tr>)}
      </tbody></table>}
    </div>
  )
}

export function LogConsole({ job }: { job: string }) {
  const st = useJob((s) => s.jobs[job])!
  const { setGroup, setFollow, setSearch, clearLines, reconnectLogs } = useJob()
  const parent = useRef<HTMLDivElement>(null)
  const lines = useMemo(() => { const q = st.search.trim().toLowerCase(); return q ? st.lines.filter((l) => l.message.toLowerCase().includes(q)) : st.lines }, [st.lines, st.search])
  const v = useVirtualizer({ count: lines.length, getScrollElement: () => parent.current, estimateSize: () => 18, overscan: 30 })
  useEffect(() => { if (st.follow && lines.length) v.scrollToIndex(lines.length - 1, { align: 'end' }) }, [lines.length, st.follow, v])
  const onScroll = () => { const el = parent.current; if (!el) return; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40; if (atBottom !== st.follow) setFollow(job, atBottom) }
  const empty = st.logState.kind === 'streaming'
    ? (st.streams.length ? 'Streams found; waiting for lines…' : 'No log streams for this run yet. Glue opens them about a minute into a run. If a finished run has none, the job\'s IAM role cannot write to CloudWatch Logs (it needs logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents on /aws-glue/*).')
    : st.logState.kind === 'ended' && !st.streams.length ? 'This run wrote no CloudWatch logs. Its IAM role needs logs:CreateLogGroup/CreateLogStream/PutLogEvents on /aws-glue/* for Glue to keep them.' : 'No lines.'
  return (
    <div className="col" style={{ height: '100%', position: 'relative' }}>
      <div className="logbar">
        <select value={st.group} onChange={(e) => setGroup(job, e.target.value as typeof st.group)}>
          <option value="all">all streams</option><option value="output">output (stdout/stderr)</option><option value="error">error (driver, Spark)</option>
        </select>
        <input placeholder="filter" data-search aria-label="Filter log lines" value={st.search} onChange={(e) => setSearch(job, e.target.value)} style={{ width: 180 }} />
        <button className={'quiet' + (st.follow ? ' on' : '')} onClick={() => setFollow(job, !st.follow)} title="Follow the tail">{st.follow ? 'following' : 'follow'}</button>
        <button className="quiet" onClick={() => clearLines(job)}>clear</button>
        <LogWhereNote job={job} />
        <span className="fill" />
        <span className="faint fig">{st.streams.length ? `${st.streams.length} stream${st.streams.length > 1 ? 's' : ''} · ` : ''}{lines.length} lines
          {st.logState.kind === 'streaming' && <> · <span style={{ color: 'var(--add)' }}>live</span></>}{st.logState.kind === 'ended' && ` · ${st.logState.reason}`}
          {st.logState.kind === 'stalled' && <> · <span style={{ color: 'var(--warn)' }}>{st.logState.reason}</span> <button className="quiet" onClick={() => reconnectLogs(job)}>reconnect</button></>}</span>
      </div>
      <div ref={parent} className="fill logwell" style={{ overflow: 'auto', padding: '4px 0' }} onScroll={onScroll}>
        {lines.length === 0 && <><div className="faint small" style={{ padding: '10px 12px', whiteSpace: 'pre-wrap', maxWidth: 80 * 7 }}>{empty}</div>{st.logState.kind !== 'idle' && !st.streams.length && <RolePrompt job={job} need="logs" />}</>}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => { const l = lines[it.index]!; return (
            <div key={it.key} className="logline" style={{ transform: `translateY(${it.start}px)`, color: l.group === 'error' && /ERROR|Exception|Traceback/.test(l.message) ? 'var(--del)' : undefined }}>
              <span className="ts">{new Date(l.ts).toLocaleTimeString()}</span><span className="st">{l.stream.replace(/^jr_[0-9a-f]+-?/, '') || 'driver'}</span>{l.message.replace(/\n$/, '')}
            </div>) })}
        </div>
      </div>
    </div>
  )
}

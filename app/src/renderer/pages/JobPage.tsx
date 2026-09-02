import { useState } from 'react'
import { useLanes, type Lane } from '@/stores/lanes'
import { useJob } from '@/stores/job'
import { useGlue } from '@/stores/glue'
import { ConsoleTab, RunsList } from '@/console/ConsoleTab'
import { RunSheet } from '@/console/RunSheet'
import { SplitPane } from '@/shell/SplitPane'
import { ChatRail } from '@/chat/ChatRail'
import { AuthoringTab } from '@/authoring/AuthoringTab'
import { useAuthoring } from '@/authoring/store'
import { GitBar, ChangesPanel } from '@/shell/GitBar'
import { Icon } from '@/shell/Icon'
import { isRunning } from '@/shell/format'
import { JobDetails } from '@/job/JobDetails'
import { Schedules } from '@/job/Schedules'
import { ScriptTab } from '@/job/ScriptTab'
import { DataQualityTab } from '@/job/DataQualityTab'

type Panel = 'runs' | 'changes' | null

export function JobPage({ lane }: { lane: Lane }) {
  const setTab = useLanes((s) => s.setTab)
  const st = useJob((s) => s.jobs[lane.id])
  const { start, stop, select } = useJob()
  const glueJob = useGlue((s) => s.jobs.find((j) => j.name === lane.id))
  const auth = useAuthoring((s) => s.jobs[lane.id])
  const [sheet, setSheet] = useState<null | { retryOf?: string; initial: Record<string, string> }>(null)
  const [err, setErr] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const selected = st?.runs.find((r) => r.id === st.selectedRun)
  const running = st?.runs.find((r) => isRunning(r.state))
  const run = async (args: Record<string, string>, retryOf?: string) => {
    setSheet(null); setErr(null)
    const f = await start(lane.id, args, retryOf)
    if (f) setErr(`${f.why}${f.fix ? ` — ${f.fix}` : ''}`)
  }
  const railBtn = (p: Exclude<Panel, null>, icon: string, title: string) => (
    <button className={panel === p ? 'on' : ''} title={title} onClick={() => setPanel(panel === p ? null : p)}><Icon name={icon} size={16} /></button>)
  const main = lane.tab === 'console'
    ? <SplitPane storageKey="job.chat" initial={Math.max(460, window.innerWidth - 520)} min={380} minB={340}
        a={<ConsoleTab job={lane.id} />}
        b={<ChatRail job={lane.id} mode="debug" run={st?.selectedRun} placeholder="Ask why this run failed…" />} />
    : lane.tab === 'script' ? <ScriptTab job={lane.id} />
    : lane.tab === 'details' ? <JobDetails job={lane.id} />
    : lane.tab === 'schedules' ? <Schedules job={lane.id} />
    : lane.tab === 'dq' ? <DataQualityTab job={lane.id} />
    : <AuthoringTab job={lane.id} />
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="toolbar">
        <div className="row" style={{ gap: 0 }}>
          {([['authoring', 'Visual'], ['script', 'Script'], ['details', 'Job details'], ['console', 'Runs'], ['dq', 'Data quality'], ['schedules', 'Schedules']] as const).map(([t, label]) => (
            <button key={t} className={'tabbtn' + (lane.tab === t ? ' on' : '')} onClick={() => setTab(lane.id, t)}>{label}</button>))}
        </div>
        <GitBar job={lane.id} />
        {glueJob?.local?.remoteChanged && <span className="pill warn" title="the job definition changed in AWS after you imported it">remote changed</span>}
        <span className="fill" />
        {err && <span className="small" style={{ color: 'var(--del)' }}>{err}</span>}
        {auth?.message && lane.tab === 'authoring' && <span className="small dim" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={auth.message}>{auth.message}</span>}
        <button className="primary" disabled={!!st?.busy || !glueJob} onClick={() => setSheet({ initial: {} })} title={glueJob ? 'Start a run (⌘R)' : 'Deploy first'}><Icon name="play" />Run</button>
        <button disabled={!running || !!st?.busy} onClick={() => running && void stop(lane.id, running.id)} title="Stop the running run (⌘.)"><Icon name="stop" />Stop</button>
        <button disabled={!selected || isRunning(selected.state)} onClick={() => selected && setSheet({ retryOf: selected.id, initial: selected.arguments ?? {} })} title="Run again with the same arguments"><Icon name="retry" />Retry</button>
        {lane.tab === 'authoring' && <button disabled={!!auth?.busy} onClick={() => void useAuthoring.getState().deploy(lane.id, !glueJob)} title="Push the DAG and the tested job.py to AWS (⇧⌘D)"><Icon name="deploy" />{auth?.busy === 'deploying' ? 'Deploying…' : glueJob ? 'Deploy' : 'Deploy (create)'}</button>}
      </div>
      <div className="row fill" style={{ gap: 0, alignItems: 'stretch', minHeight: 0 }}>
        <div className="rail">
          {railBtn('runs', 'runs', 'Runs')}
          {railBtn('changes', 'changes', 'Changes in this lane')}
        </div>
        {panel && (
          <div className="panel" style={{ width: 260, flex: 'none' }}>
            <div className="panel-head"><span className="eyebrow">{panel === 'runs' ? 'Runs' : 'Changes'}</span><span className="fill" /><button className="quiet" onClick={() => setPanel(null)}><Icon name="x" size={12} /></button></div>
            <div className="fill" style={{ overflow: 'auto' }}>
              {panel === 'runs' ? <RunsList runs={st?.runs ?? []} selected={st?.selectedRun} onSelect={(id) => { select(lane.id, id); if (lane.tab !== 'console') setTab(lane.id, 'console') }} compact /> : <ChangesPanel job={lane.id} />}
            </div>
          </div>)}
        <div className="fill" style={{ minHeight: 0 }}>{main}</div>
      </div>
      {sheet && <RunSheet initial={sheet.initial} onClose={() => setSheet(null)} onRun={(args) => void run(args, sheet.retryOf)} />}
    </div>
  )
}

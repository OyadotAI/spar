import { useState } from 'react'
import { useLanes, type Lane } from '@/stores/lanes'
import { useJob } from '@/stores/job'
import { useGlue } from '@/stores/glue'
import { ConsoleTab } from '@/console/ConsoleTab'
import { RunSheet } from '@/console/RunSheet'
import { SplitPane } from '@/shell/SplitPane'
import { ChatRail } from '@/chat/ChatRail'
import { AuthoringTab } from '@/authoring/AuthoringTab'
import { useAuthoring } from '@/authoring/store'
import { GitPill, ChangesPanel } from '@/shell/GitBar'
import { Sidebar, type NavItem } from '@/shell/Sidebar'
import { Icon } from '@/shell/Icon'
import { isRunning, stateTone } from '@/shell/format'
import { JobDetails } from '@/job/JobDetails'
import { Schedules } from '@/job/Schedules'
import { ScriptTab } from '@/job/ScriptTab'
import { UpgradeTab } from '@/job/UpgradeTab'
import type { Tab } from '@/stores/lanes'

const NAV: NavItem<Tab>[] = [
  { id: 'authoring', label: 'Visual', icon: 'route' },
  { id: 'script', label: 'Script', icon: 'code' },
  { id: 'console', label: 'Runs', icon: 'runs' },
  { id: 'schedules', label: 'Schedules', icon: 'schedule' },
  { id: 'details', label: 'Job details', icon: 'gear' },
  { id: 'changes', label: 'Changes', icon: 'changes' },
  { id: 'upgrade', label: 'Upgrade', icon: 'wrench' },
]

export function JobPage({ lane }: { lane: Lane }) {
  const setTab = useLanes((s) => s.setTab)
  const st = useJob((s) => s.jobs[lane.id])
  const { start, stop } = useJob()
  const glueJob = useGlue((s) => s.jobs.find((j) => j.name === lane.id))
  const auth = useAuthoring((s) => s.jobs[lane.id])
  const [sheet, setSheet] = useState<null | { retryOf?: string; initial: Record<string, string> }>(null)
  const selected = st?.runs.find((r) => r.id === st.selectedRun)
  const running = st?.runs.find((r) => isRunning(r.state))
  const latest = glueJob?.latestRun
  const run = async (args: Record<string, string>, retryOf?: string) => {
    setSheet(null)
    await start(lane.id, args, retryOf)   // failures surface as a toast, like every other action
  }
  // Runs and Changes are sections, not a second copy of themselves in a side panel.
  const main = lane.tab === 'console'
    ? <SplitPane storageKey="job.chat" initial={0.68} minB={340}
        a={<ConsoleTab job={lane.id} />}
        b={<ChatRail job={lane.id} mode="debug" run={st?.selectedRun} placeholder="Ask why this run failed…" />} />
    : lane.tab === 'script' ? <ScriptTab job={lane.id} />
    : lane.tab === 'details' ? <JobDetails job={lane.id} />
    : lane.tab === 'schedules' ? <Schedules job={lane.id} />
    : lane.tab === 'upgrade' ? <UpgradeTab job={lane.id} />
    : lane.tab === 'changes' ? <ChangesPanel job={lane.id} />
    : <AuthoringTab job={lane.id} />
  const section = NAV.find((n) => n.id === lane.tab)
  const canGenerate = lane.tab === 'authoring' || lane.tab === 'script'
  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <Sidebar items={NAV} active={lane.tab} onSelect={(t) => setTab(lane.id, t)} storageKey="job" label={`${lane.id} sections`} />
      <div className="col fill" style={{ minWidth: 0 }}>
        {/* The action bar. It says what you can DO here, never where you can go. */}
        <div className="toolbar">
          <div className="subject">
            <span className="name" title={lane.id}>{lane.id}</span>
            {latest && <span className={'pill ' + stateTone(latest.state)}>{isRunning(latest.state) && <span className="dot live" />}{latest.state.toLowerCase()}</span>}
            {!glueJob && <span className="pill">local draft</span>}
            {glueJob?.local?.remoteChanged && <span className="pill warn" title="the job definition changed in AWS after you imported it">remote changed</span>}
          </div>
          <GitPill job={lane.id} onOpen={() => setTab(lane.id, 'changes')} />
          <span className="fill" />
          {auth?.message && canGenerate && <span className="small dim" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={auth.message}>{auth.message}</span>}
          {canGenerate && <button className="quiet" disabled={!!auth?.busy} onClick={() => void useAuthoring.getState().generate(lane.id)} title="dag.json → job.py + test scaffolds"><Icon name="refresh" />{auth?.busy === 'generating' ? 'Generating…' : 'Generate'}</button>}
          <button className="primary" disabled={!!st?.busy || !glueJob} onClick={() => setSheet({ initial: {} })}
            title={glueJob ? 'Start a run (⌘R)' : 'This job is not in AWS yet — deploy it first'}><Icon name="play" />Run</button>
          <button disabled={!running || !!st?.busy} onClick={() => running && void stop(lane.id, running.id)}
            title={running ? 'Stop the running run (⌘.)' : 'Nothing is running'}><Icon name="stop" />Stop</button>
          <button disabled={!selected || isRunning(selected.state)} onClick={() => selected && setSheet({ retryOf: selected.id, initial: selected.arguments ?? {} })}
            title={selected ? 'Run again with the same arguments' : 'Pick a run under Runs first'}><Icon name="retry" />Retry</button>
          <button disabled={!!auth?.busy} onClick={() => void useAuthoring.getState().deploy(lane.id, !glueJob)}
            title="Push the DAG and the tested job.py to AWS (⇧⌘D)"><Icon name="deploy" />{auth?.busy === 'deploying' ? 'Deploying…' : glueJob ? 'Deploy' : 'Deploy (create)'}</button>
        </div>
        <main className="fill" role="tabpanel" aria-label={section?.label} style={{ minHeight: 0 }}>{main}</main>
      </div>
      {sheet && <RunSheet initial={sheet.initial} onClose={() => setSheet(null)} onRun={(args) => void run(args, sheet.retryOf)} />}
    </div>
  )
}

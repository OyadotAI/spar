import { useEffect, useMemo } from 'react'
import { useApp } from '@/stores/app'
import { connectEvents } from '@/events'
import { LaneTabs } from '@/shell/LaneTabs'
import { StatusBar } from '@/shell/StatusBar'
import { TerminalPane } from '@/shell/Terminal'
import { JobsPage } from '@/pages/JobsPage'
import { JobPage } from '@/pages/JobPage'
import { SettingsPage } from '@/pages/Settings'
import { useTerminal } from '@/stores/terminal'
import { useLanes, activeLane } from '@/stores/lanes'
import { useJob } from '@/stores/job'
import { useGlue } from '@/stores/glue'
import { isRunning } from '@/shell/format'

export function App() {
  const { setPort, daemonDied, refreshState, showSettings, toggle } = useApp()
  const term = useTerminal()
  const lanes = useLanes()
  const lane = activeLane(lanes)
  const glueJobs = useGlue((s) => s.jobs)
  const busyJobs = useMemo(() => new Set(glueJobs.filter((j) => isRunning(j.latestRun?.state)).map((j) => j.name)), [glueJobs])
  useEffect(() => {
    let cancelled = false
    void window.keel.port().then((s) => { if (!cancelled && s.port) { setPort(s.port, s.project); void refreshState(); connectEvents() } })
    // tabs belong to a project; load them when the daemon says which project this is
    const offProject = useApp.subscribe((s, prev) => {
      if (s.project && s.project !== prev.project) {
        useLanes.getState().loadFor(s.project)
        const open = window.keel.openOnLaunch
        if (open) { const [job, tab, node] = open.split(':'); if (job === 'home') useLanes.getState().select('home'); else if (job) { useLanes.getState().openJob(job); if (tab) useLanes.getState().setTab(job, tab as 'console'); if (node) setTimeout(() => void import('@/dag/store').then((m) => m.useDag.getState().select(job, [node])), 4000) } }
      }
    })
    const off = window.keel.onDaemon((s) => {
      if (s.port) { setPort(s.port, s.project); void refreshState(); connectEvents() }
      else daemonDied(s.reason ?? 'daemon exited')
    })
    const offMenu = window.keel.onMenu((cmd) => {
      const l = activeLane(useLanes.getState())
      if (cmd === 'settings') toggle('showSettings')
      else if (cmd === 'terminal') useTerminal.getState().toggle()
      else if (cmd === 'open-project') void window.keel.pickProject()
      else if (cmd === 'home') useLanes.getState().select('home')
      else if (cmd === 'run' && l) void useJob.getState().start(l.id)
      else if (cmd === 'stop' && l) { const r = useJob.getState().get(l.id).runs.find((x) => isRunning(x.state)); if (r) void useJob.getState().stop(l.id, r.id) }
      else if (cmd === 'deploy' && l) void import('@/authoring/store').then((m) => m.useAuthoring.getState().deploy(l.id))
    })
    return () => { cancelled = true; off(); offMenu(); offProject() }
  }, [setPort, daemonDied, refreshState, toggle])
  const tones = useMemo(() => new Map(glueJobs.map((j) => [j.name, j.latestRun?.state === 'SUCCEEDED' ? 'ok' as const : j.latestRun && !isRunning(j.latestRun.state) ? 'err' as const : undefined])), [glueJobs])
  const tabs = [{ id: 'home', title: 'Jobs' }, ...lanes.open.map((l) => ({ id: l.id, title: l.title, busy: busyJobs.has(l.id), tone: tones.get(l.id) }))]
  return (
    <div className="app">
      <LaneTabs tabs={tabs} active={showSettings ? '' : lanes.active} onSelect={(id) => { toggle('showSettings', false); lanes.select(id) }} onClose={lanes.close} />
      <div className="fill" style={{ minHeight: 0 }}>
        {showSettings ? <SettingsPage /> : lane ? <JobPage key={lane.id} lane={lane} /> : <JobsPage onOpen={(j) => lanes.openJob(j.name)} />}
      </div>
      <div style={{ height: term.open ? 280 : 0, borderTop: term.open ? '1px solid var(--line)' : 'none', overflow: 'hidden', background: 'var(--well)' }}>
        {term.open && <TerminalPane key={term.nonce} run={term.run} />}
      </div>
      <StatusBar />
    </div>
  )
}

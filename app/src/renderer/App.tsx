import { useEffect, useMemo } from 'react'
import { useApp } from '@/stores/app'
import { connectEvents } from '@/events'
import { LaneTabs } from '@/shell/LaneTabs'
import { StatusBar } from '@/shell/StatusBar'
import { TerminalPane } from '@/shell/Terminal'
import { Home } from '@/pages/Home'
import { Welcome } from '@/pages/Welcome'
import { Toasts } from '@/shell/Toast'
import { ConfirmSheet } from '@/shell/Confirm'
import { PromptSheet } from '@/shell/Prompt'
import { Palette, usePalette } from '@/shell/Palette'
import { OpsTray } from '@/shell/Ops'
import { useEngine } from '@/stores/engine'
import { JobPage } from '@/pages/JobPage'
import { useTerminal } from '@/stores/terminal'
import { useLanes, activeLane } from '@/stores/lanes'
import { useJob } from '@/stores/job'
import { useGlue } from '@/stores/glue'
import { isRunning } from '@/shell/format'
import { Icon } from '@/shell/Icon'

/** ⌘F and Edit ▸ Find both land here. The box marks itself with `data-search`; matching on
 *  placeholder text meant renaming a placeholder silently broke the shortcut. */
function focusSearch(): void {
  const box = document.querySelector<HTMLInputElement>('[data-search]')
  if (box) { box.focus(); box.select() }
}

export function App() {
  const { setPort, daemonDied, refreshState, showSettings, toggle, setConnection } = useApp()
  const hasProject = useApp((s) => s.state?.hasProject !== false && !!s.state)
  const term = useTerminal()
  const lanes = useLanes()
  const lane = activeLane(lanes)
  const glueJobs = useGlue((s) => s.jobs)
  const busyJobs = useMemo(() => new Set(glueJobs.filter((j) => isRunning(j.latestRun?.state)).map((j) => j.name)), [glueJobs])
  useEffect(() => {
    let cancelled = false
    void window.keel.port().then((s) => { if (!cancelled && s.port) { setPort(s.port, s.project); void refreshState(); void useEngine.getState().refresh(); connectEvents() } })
    // tabs belong to a project; load them when the daemon says which project this is
    const offProject = useApp.subscribe((s, prev) => {
      if (s.project && s.project !== prev.project) {
        useLanes.getState().loadFor(s.project)
        const open = window.keel.openOnLaunch
        if (open) { const [job, tab, node] = open.split(':'); if (job === 'home') { if (tab) try { localStorage.setItem('home.section', tab) } catch { /* ignore */ } ; useLanes.getState().select('home') } else if (job) { useLanes.getState().openJob(job); if (tab) useLanes.getState().setTab(job, tab as 'console'); if (node) setTimeout(() => void import('@/dag/store').then((m) => m.useDag.getState().select(job, [node])), 4000) } }
      }
    })
    const off = window.keel.onDaemon((s) => {
      if (s.port) { setPort(s.port, s.project); void refreshState(); connectEvents() }
      else daemonDied(s.reason ?? 'daemon exited')
    })
    const offMenu = window.keel.onMenu((cmd) => {
      const l = activeLane(useLanes.getState())
      if (cmd === 'palette') usePalette.getState().toggle()
      else if (cmd === 'find') focusSearch()
      else if (cmd === 'close-tab') { const a = useLanes.getState(); if (a.active !== 'home') a.close(a.active) }
      else if (cmd === 'settings') toggle('showSettings')
      else if (cmd === 'terminal') useTerminal.getState().toggle()
      else if (cmd === 'open-project') void window.keel.pickProject()
      else if (cmd === 'home') useLanes.getState().select('home')
      else if (cmd === 'run' && l) void useJob.getState().start(l.id)
      else if (cmd === 'stop' && l) { const r = useJob.getState().get(l.id).runs.find((x) => isRunning(x.state)); if (r) void useJob.getState().stop(l.id, r.id) }
      else if (cmd === 'deploy' && l) void import('@/authoring/store').then((m) => m.useAuthoring.getState().deploy(l.id))
    })
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const l = useLanes.getState()
      if (/^[1-9]$/.test(e.key)) {
        const tabs = ['home', ...l.open.map((x) => x.id)]
        const t = tabs[Number(e.key) - 1]
        if (t) { e.preventDefault(); l.select(t) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { cancelled = true; off(); offMenu(); offProject(); window.removeEventListener('keydown', onKey) }
  }, [setPort, daemonDied, refreshState, toggle])
  const tones = useMemo(() => new Map(glueJobs.map((j) => [j.name, j.latestRun?.state === 'SUCCEEDED' ? 'ok' as const : j.latestRun && !isRunning(j.latestRun.state) ? 'err' as const : undefined])), [glueJobs])
  const tabs = [{ id: 'home', title: 'Jobs' }, ...lanes.open.map((l) => ({ id: l.id, title: l.title, busy: busyJobs.has(l.id), tone: tones.get(l.id) }))]
  return (
    <div className="app">
      {hasProject && <LaneTabs tabs={tabs} active={showSettings ? 'home' : lanes.active}
        onSelect={(id) => { toggle('showSettings', false); lanes.select(id) }} onClose={lanes.close} />}
      {!hasProject && <div className="tabs"><div className="brand"><Icon name="keel" size={16} /><span>SparData</span></div></div>}
      <div className="fill" style={{ minHeight: 0 }}>
        {!hasProject ? <Welcome onOpened={() => { setConnection('starting'); void refreshState() }} />
          : lane && !showSettings ? <JobPage key={lane.id} lane={lane} />
          : <Home onOpen={(job, run) => { lanes.openJob(job); if (run) setTimeout(() => void import('@/stores/job').then((m) => m.useJob.getState().select(job, run)), 800) }} />}
      </div>
      <div style={{ height: term.open ? 280 : 0, borderTop: term.open ? '1px solid var(--line)' : 'none', overflow: 'hidden', background: 'var(--well)' }}>
        {term.open && <TerminalPane key={term.nonce} run={term.run} />}
      </div>
      <StatusBar />
      <Palette />
      <OpsTray />
      <Toasts />
      <ConfirmSheet />
      <PromptSheet />
    </div>
  )
}

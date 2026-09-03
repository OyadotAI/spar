import { useState } from 'react'
import { JobsPage } from './JobsPage'
import { Monitoring } from './Monitoring'
import { Connections } from './Connections'
import { Profiles } from './Profiles'
import { SessionsPage } from './SessionsPage'
import { SettingsPage } from './Settings'
import { Sidebar, type NavItem } from '@/shell/Sidebar'
import { useApp } from '@/stores/app'

type Section = 'jobs' | 'monitoring' | 'sessions' | 'connections' | 'profiles' | 'settings'
const NAV: NavItem<Section>[] = [
  { id: 'jobs', label: 'Jobs', icon: 'runs' },
  { id: 'monitoring', label: 'Monitoring', icon: 'activity' },
  { id: 'sessions', label: 'Sessions', icon: 'cpu' },
  { id: 'connections', label: 'Connections', icon: 'link' },
  { id: 'profiles', label: 'Usage profiles', icon: 'gear' },
]
/** Settings is an account-level surface like the rest, so it lives here — named, not behind ⌘,. */
const FOOTER: NavItem<Section>[] = [{ id: 'settings', label: 'Settings', icon: 'gear', hint: 'AWS profile, script bucket, live updates (⌘,)' }]

/** The account-level surfaces, the way the Glue console's left nav groups them. */
export function Home({ onOpen }: { onOpen: (job: string, run?: string) => void }) {
  const { showSettings, toggle } = useApp()
  const [section, setSection] = useState<Section>(() => {
    // KEEL_OPEN=home:<section> must win here: it is read before the lane subscription fires, and
    // by then this initialiser has already run off localStorage.
    const [where, want] = (window.keel.openOnLaunch || '').split(':')
    if (where === 'home' && want && NAV.some((n) => n.id === want)) return want as Section
    try { return (localStorage.getItem('home.section') as Section) ?? 'jobs' } catch { return 'jobs' }
  })
  // ⌘,, the status-bar gear and "Connect AWS…" all set showSettings; it just forces the section.
  const active: Section = showSettings ? 'settings' : section
  const go = (s: Section) => {
    toggle('showSettings', s === 'settings')
    if (s === 'settings') return
    setSection(s)
    try { localStorage.setItem('home.section', s) } catch { /* ignore */ }
  }
  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <Sidebar items={NAV} footer={FOOTER} active={active} onSelect={go} storageKey="home" label="Account sections" />
      <main className="fill" role="tabpanel" aria-label={[...NAV, ...FOOTER].find((n) => n.id === active)!.label} style={{ minWidth: 0 }}>
        {active === 'jobs' && <JobsPage onOpen={(j) => onOpen(j.name)} />}
        {active === 'monitoring' && <Monitoring onOpen={onOpen} />}
        {active === 'sessions' && <SessionsPage />}
        {active === 'connections' && <Connections />}
        {active === 'profiles' && <Profiles />}
        {active === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

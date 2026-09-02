import { useState } from 'react'
import { JobsPage } from './JobsPage'
import { Monitoring } from './Monitoring'
import { Connections } from './Connections'
import { Entities } from './Entities'
import { Profiles } from './Profiles'
import { SessionsPage } from './SessionsPage'
import { Icon } from '@/shell/Icon'

type Section = 'jobs' | 'monitoring' | 'sessions' | 'connections' | 'entities' | 'profiles'
const NAV: [Section, string, string][] = [
  ['jobs', 'Jobs', 'runs'], ['monitoring', 'Monitoring', 'activity'], ['sessions', 'Sessions', 'cpu'],
  ['connections', 'Connections', 'link'], ['entities', 'Detection entities', 'pii'], ['profiles', 'Usage profiles', 'gear'],
]

/** The account-level surfaces, the way the Glue console's left nav groups them. */
export function Home({ onOpen }: { onOpen: (job: string, run?: string) => void }) {
  const [section, setSection] = useState<Section>(() => {
    try { return (localStorage.getItem('home.section') as Section) ?? 'jobs' } catch { return 'jobs' }
  })
  const go = (s: Section) => { setSection(s); try { localStorage.setItem('home.section', s) } catch { /* ignore */ } }
  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <div className="rail" style={{ width: 52 }}>
        {NAV.map(([s, label, icon]) => (
          <button key={s} className={section === s ? 'on' : ''} title={label} onClick={() => go(s)}><Icon name={icon} size={17} /></button>))}
      </div>
      <div className="fill" style={{ minWidth: 0 }}>
        {section === 'jobs' && <JobsPage onOpen={(j) => onOpen(j.name)} />}
        {section === 'monitoring' && <Monitoring onOpen={onOpen} />}
        {section === 'sessions' && <SessionsPage />}
        {section === 'connections' && <Connections />}
        {section === 'entities' && <Entities />}
        {section === 'profiles' && <Profiles />}
      </div>
    </div>
  )
}

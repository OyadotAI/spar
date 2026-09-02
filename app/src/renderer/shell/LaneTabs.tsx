import { useApp } from '@/stores/app'
import { Icon } from './Icon'

/** Tabs across the top: the jobs page, then one per open job. */
export function LaneTabs({ tabs, active, onSelect, onClose }:
  { tabs: { id: string; title: string; busy?: boolean; tone?: 'ok' | 'err' | 'info' }[]; active: string; onSelect: (id: string) => void; onClose?: (id: string) => void }) {
  const mac = useApp((s) => s.state?.os?.startsWith('Mac')) ?? navigator.platform.startsWith('Mac')
  return (
    <div className="tabs" style={{ ['--pad-left' as string]: mac ? '76px' : '8px' }}>
      <div className="brand"><Icon name="keel" size={16} /><span>Keel</span></div>
      {tabs.map((t) => (
        <div key={t.id} className={'tab' + (t.id === active ? ' active' : '')} onClick={() => onSelect(t.id)} title={t.title}>
          {t.id === 'home' ? <Icon name="home" size={13} style={{ color: 'var(--faint)' }} /> : t.busy ? <span className="dot live" style={{ color: 'var(--accent)' }} /> : t.tone ? <span className="dot" style={{ color: t.tone === 'ok' ? 'var(--add)' : t.tone === 'err' ? 'var(--del)' : 'var(--accent)' }} /> : null}
          <span className="title">{t.title}</span>
          {onClose && t.id !== 'home' && <span className="close" onClick={(e) => { e.stopPropagation(); onClose(t.id) }}><Icon name="x" size={11} /></span>}
        </div>
      ))}
    </div>
  )
}

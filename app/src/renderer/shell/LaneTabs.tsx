import { useApp } from '@/stores/app'
import { Icon } from './Icon'

export type LaneTab = { id: string; title: string; busy?: boolean; tone?: 'ok' | 'err' | 'info' }

/**
 * Level 1: the jobs page, then one tab per open job, then Settings when it is open. A real
 * tablist — arrow keys move, the close button is reachable without a mouse — and the strip
 * scrolls rather than crowding the brand out when many jobs are open.
 */
export function LaneTabs({ tabs, active, onSelect, onClose }:
  { tabs: LaneTab[]; active: string; onSelect: (id: string) => void; onClose?: (id: string) => void }) {
  const mac = useApp((s) => s.state?.os?.startsWith('Mac')) ?? navigator.platform.startsWith('Mac')
  return (
    <div className="tabs" role="tablist" aria-label="Open tabs" style={{ ['--pad-left' as string]: mac ? '76px' : '8px' }}>
      <div className="brand"><Icon name="keel" size={16} /><span>SparData</span></div>
      {tabs.map((t, i) => (
        <button key={t.id} role="tab" aria-selected={t.id === active} tabIndex={t.id === active ? 0 : -1}
          className={'tab' + (t.id === active ? ' active' : '')} onClick={() => onSelect(t.id)} title={t.title}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault()
              const next = tabs[Math.min(tabs.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))]
              if (next) onSelect(next.id)
            } else if ((e.key === 'Backspace' || e.key === 'Delete') && onClose && t.id !== 'home') {
              e.preventDefault(); onClose(t.id)
            }
          }}>
          {t.id === 'home' ? <Icon name="home" size={13} style={{ color: 'var(--faint)' }} />
            : t.id === 'settings' ? <Icon name="gear" size={13} style={{ color: 'var(--faint)' }} />
            : t.busy ? <span className="dot live" style={{ color: 'var(--accent)' }} />
            : t.tone ? <span className="dot" style={{ color: t.tone === 'ok' ? 'var(--add)' : t.tone === 'err' ? 'var(--del)' : 'var(--accent)' }} /> : null}
          <span className="title">{t.title}</span>
          {onClose && t.id !== 'home' && (
            <span role="button" tabIndex={-1} className="close" aria-label={`Close ${t.title}`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}><Icon name="x" size={11} /></span>)}
        </button>))}
    </div>
  )
}

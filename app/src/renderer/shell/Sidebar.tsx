import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export type NavItem<T extends string> = { id: T; label: string; icon: string; badge?: ReactNode; hint?: string }

/**
 * The one level-2 navigation. Both lanes use it — the jobs lane for its account surfaces, a job
 * lane for its sections — so "where am I" means the same thing everywhere. It replaces the two
 * icon rails and the seven-button tab row that used to stack on top of each other.
 *
 * A real tablist: arrow keys move, Home/End jump, and only the active item is in the tab order.
 */
export function Sidebar<T extends string>({ items, footer = [], active, onSelect, storageKey, label }: {
  items: NavItem<T>[]; footer?: NavItem<T>[]; active: T; onSelect: (id: T) => void; storageKey: string; label: string
}) {
  const all = [...items, ...footer]
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(`nav.collapsed.${storageKey}`) === '1' } catch { return false }
  })
  const collapse = (v: boolean) => { setCollapsed(v); try { localStorage.setItem(`nav.collapsed.${storageKey}`, v ? '1' : '0') } catch { /* private mode */ } }
  const move = (from: number, delta: number) => {
    const next = all[Math.min(all.length - 1, Math.max(0, from + delta))]
    if (next) onSelect(next.id)
  }
  // one keyboard order over both groups, so arrowing down runs past the gap into the footer
  const item = (it: NavItem<T>, i: number) => (
        <button key={it.id} role="tab" aria-selected={it.id === active} tabIndex={it.id === active ? 0 : -1}
          className={'navitem' + (it.id === active ? ' on' : '')}
          title={collapsed ? it.label : it.hint} aria-label={collapsed ? it.label : undefined}
          onClick={() => onSelect(it.id)}
          onKeyDown={(e) => {
            const k = e.key
            if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Home' && k !== 'End') return
            e.preventDefault()
            if (k === 'Home') move(0, 0); else if (k === 'End') move(all.length - 1, 0)
            else move(i, k === 'ArrowDown' ? 1 : -1)
          }}>
          <Icon name={it.icon} size={16} />
          <span className="label">{it.label}</span>
          {!collapsed && it.badge != null && <><span className="fill" />{it.badge}</>}
        </button>)
  return (
    <nav className={'nav' + (collapsed ? ' collapsed' : '')} role="tablist" aria-orientation="vertical" aria-label={label}>
      {items.map((it, i) => item(it, i))}
      <span className="gap" />
      {footer.map((it, i) => item(it, items.length + i))}
      <button className="navitem" onClick={() => collapse(!collapsed)}
        aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
        <Icon name="chevron" size={16} style={{ transform: collapsed ? undefined : 'rotate(180deg)' }} />
        <span className="label">Collapse</span>
      </button>
    </nav>
  )
}

import type { ReactNode } from 'react'
import type { Fault } from '@/api/client'
import { Icon } from './Icon'

/** A blank pane says which reason it is. Never render an empty box. */
export function EmptyState({
  title,
  children,
  actions,
  icon,
}: {
  title: string
  children?: ReactNode
  actions?: ReactNode
  icon?: string
}) {
  return (
    <div className="empty">
      {icon && (
        <div className="empty-icon">
          <Icon name={icon} size={22} />
        </div>
      )}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="row" style={{ marginTop: 8, gap: 8 }}>{actions}</div>}
    </div>
  )
}

export function FaultState({ fault, retry }: { fault: Fault; retry?: () => void }) {
  return (
    <EmptyState
      icon="warn"
      title={`Could not read ${fault.what}`}
      actions={retry && <button className="primary" onClick={retry}><Icon name="refresh" />Try again</button>}>
      {fault.why}{fault.fix ? ` — ${fault.fix}` : ''}
    </EmptyState>
  )
}

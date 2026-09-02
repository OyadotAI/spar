import type { ReactNode } from 'react'
import type { Fault } from '@/api/client'

/** A blank pane says which reason it is. Never render an empty box. */
export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="row" style={{ marginTop: 4 }}>{actions}</div>}
    </div>
  )
}

export function FaultState({ fault, retry }: { fault: Fault; retry?: () => void }) {
  return (
    <EmptyState title={`Could not read ${fault.what}`} actions={retry && <button onClick={retry}>Try again</button>}>
      {fault.why}{fault.fix ? ` — ${fault.fix}` : ''}
    </EmptyState>
  )
}

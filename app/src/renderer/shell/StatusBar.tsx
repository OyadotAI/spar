import { useApp } from '@/stores/app'
import { useTerminal } from '@/stores/terminal'
import { Icon } from './Icon'

export function StatusBar() {
  const { connection, state, deathReason, toggle } = useApp()
  const term = useTerminal()
  const live = state?.live
  return (
    <div className="status">
      {connection !== 'connected' && (
        <span className={'pill ' + (connection === 'dead' ? 'err' : 'warn')} title={deathReason}>
          {connection === 'starting' ? 'starting' : connection === 'reconnecting' ? 'reconnecting' : 'daemon down'}
        </span>
      )}
      {state?.profile ? <span className="row" style={{ gap: 5 }}><Icon name="gear" size={11} style={{ color: 'var(--faint)' }} />{state.profile}<span className="faint">·</span>{state.region ?? 'no region'}</span> : <span className="faint">no AWS profile</span>}
      {live && live.mode !== 'off' && (
        <span className="row" style={{ gap: 6 }} title={live.throttled ? 'AWS is throttling; polling slowed' : live.mode === 'push' ? 'EventBridge push is delivering' : `sweep every ${live.sweepSeconds}s`}>
          <span className={'dot' + (live.throttled ? '' : ' live')} style={{ color: live.throttled ? 'var(--warn)' : live.mode === 'push' ? 'var(--add)' : 'var(--accent)' }} />
          Live <span className="faint">·</span> {live.mode === 'push' ? 'push' : <span className="fig">polling {live.sweepSeconds}s</span>}{live.throttled ? ' (throttled)' : ''}
        </span>
      )}
      <span className="fill" />
      <span className="faint" title={state?.project}>{state?.project?.split(/[\\/]/).pop()}</span>
      <button className="quiet" onClick={() => toggle('showSettings')}><Icon name="gear" size={12} /></button>
      <button className={'quiet' + (term.open ? ' on' : '')} onClick={() => term.toggle()} title="Terminal ⌘⌥T"><Icon name="terminal" size={12} />Terminal</button>
    </div>
  )
}

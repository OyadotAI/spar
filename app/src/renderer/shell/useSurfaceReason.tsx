import type { ReactNode } from 'react'
import { useApp } from '@/stores/app'
import { useGlue } from '@/stores/glue'
import { useTerminal } from '@/stores/terminal'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'

/**
 * "An empty pane says which reason it is. Never a blank." — the rule this app is built on.
 *
 * The jobs page was the only screen that actually kept it. Every other AWS-backed screen fell
 * through to a fault, so visiting Connections with no profile read "Could not read the
 * connections — 400 Bad Request" instead of "No AWS profile selected". This is that ladder,
 * once, for all of them.
 *
 * Returns a pane to render *instead of* the screen, or null when there is nothing in the way.
 * `what` names the thing the screen is for, so the copy can be specific ("connections", "sessions").
 */
export function useSurfaceReason(what: string): ReactNode | null {
  const { state, connection, deathReason, toggle } = useApp()
  const auth = useGlue((s) => s.auth)
  const openTerminal = useTerminal((s) => s.openWith)

  if (connection === 'dead') return <EmptyState title="The daemon stopped">{deathReason ?? 'It exited without saying why. Restarting Keel starts it again.'}</EmptyState>
  if (connection === 'reconnecting') return <EmptyState title="Reconnecting to the daemon">Nothing is lost — {what} come back on their own as soon as it answers.</EmptyState>
  if (!state || connection !== 'connected') return <EmptyState title="Starting…">Waiting for the daemon.</EmptyState>
  if (!state.tools.aws.installed) return (
    <EmptyState title="The aws CLI is not on PATH">
      Keel uses it to read {what}. Install it from aws.amazon.com/cli, then restart Keel.
    </EmptyState>)
  if (auth.kind === 'noProfile') return (
    <EmptyState title="No AWS profile selected"
      actions={<button className="primary" onClick={() => toggle('showSettings', true)}><Icon name="gear" />Connect AWS…</button>}>
      {what[0]!.toUpperCase() + what.slice(1)} live in your AWS account, so this screen needs a profile.
      Building a pipeline, generating its code and running it on samples all work without one.
    </EmptyState>)
  if (auth.kind === 'expired') return (
    <EmptyState title={`Sign in to ${state.profile}`}
      actions={<button className="primary" onClick={() => openTerminal(auth.fix)}><Icon name="terminal" />Sign in</button>}>
      The SSO session has expired. Signing in runs <code>{auth.fix}</code> in the terminal;
      the {what} fill in on their own once it succeeds.
    </EmptyState>)
  return null
}

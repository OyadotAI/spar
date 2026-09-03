import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { TurnCard } from '@/chat/TurnCard'
import { newTurn } from '@/wire/decoder'
import { useTerminal } from '@/stores/terminal'

describe('TurnCard error handling', () => {
  beforeEach(() => { cleanup() })
  it('renders a sign in button when Claude Code is not logged in', () => {
    const turn = newTurn('create a pipeline')
    turn.running = false
    turn.error = 'claude exited with code 1:\nNot logged in · Please run /login'

    render(<TurnCard turn={turn} index={1} />)

    expect(screen.getByText('Not signed in to Claude Code')).toBeTruthy()
    const btn = screen.getByText('Sign in (claude login)')
    expect(btn).toBeTruthy()

    fireEvent.click(btn)
    expect(useTerminal.getState().open).toBe(true)
    expect(useTerminal.getState().run).toBe('claude login')
  })

  it('renders an install button when Claude Code is not found', () => {
    const turn = newTurn('create a pipeline')
    turn.running = false
    turn.error = 'could not start claude: not found. Is Claude Code installed and on PATH?'

    render(<TurnCard turn={turn} index={1} />)

    expect(screen.getByText('Claude Code is not installed')).toBeTruthy()
    const btn = screen.getByText('Install Claude Code')
    expect(btn).toBeTruthy()

    fireEvent.click(btn)
    expect(useTerminal.getState().open).toBe(true)
    expect(useTerminal.getState().run).toBe('npm i -g @anthropic-ai/claude-code')
  })

  it('detects login issue from step text even if error message is generic', () => {
    const turn = newTurn('create a pipeline')
    turn.running = false
    turn.steps.push({ kind: 'text', text: 'Not logged in · Please run /login' })
    turn.error = 'claude exited with code 1 and printed nothing. Try `claude -p hi` in the terminal.'

    render(<TurnCard turn={turn} index={1} />)

    expect(screen.getByText('Not signed in to Claude Code')).toBeTruthy()
    expect(screen.getByText('Sign in (claude login)')).toBeTruthy()
  })
})

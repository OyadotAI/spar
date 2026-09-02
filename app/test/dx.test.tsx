import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { OpsTray, useOps } from '@/shell/Ops'

const root = join(__dirname, '../src/renderer')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const sources = walk(root).filter((f) => /\.tsx?$/.test(f))

describe('DX guards', () => {
  it('no native dialogs anywhere in the renderer', () => {
    for (const f of sources) {
      const code = readFileSync(f, 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
      expect(code, f.slice(root.length + 1)).not.toMatch(/\bwindow\.(alert|confirm|prompt)\s*\(/)
    }
  })

  it('the operations tray shows what is running and how long it has run', () => {
    useOps.getState().start('Deploying orders-etl')
    render(<OpsTray />)
    expect(screen.getByText('Deploying orders-etl')).toBeTruthy()
    expect(screen.getByText(/^\d+s$/)).toBeTruthy()
  })

  it('no store selector builds a fresh array or object', () => {
    // `useX((s) => s.a[b]?.c ?? [])` returns a new reference every call, so React re-renders until
    // it throws "Maximum update depth exceeded" and the window goes white. It has happened twice.
    const bad = /use[A-Z]\w*\(\s*\((?:s|state)\)\s*=>[^)\n]*\?\?\s*(\[\]|\{\})/
    for (const f of sources) {
      const code = readFileSync(f, 'utf8')
      expect(code, f.slice(root.length + 1)).not.toMatch(bad)
    }
  })

  it('the three calls that outlive 90s pass their own timeout', () => {
    const long = [
      ['authoring/store.ts', /\/deploy`, \{ create \}, 'the deploy', 4 \* 60_000\)/],
      ['dag/NodePanel.tsx', /'the preview', 15 \* 60_000\)/],
      ['pages/SessionsPage.tsx', /'the statement', 16 \* 60_000\)/],
    ] as const
    for (const [rel, re] of long) expect(readFileSync(join(root, rel), 'utf8'), rel).toMatch(re)
  })
})

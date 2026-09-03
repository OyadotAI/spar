import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

  // ---- design-system guards. The stylesheet is the contract; these keep the app honest to it.

  it('every CSS variable the renderer uses is defined in theme.css', () => {
    // --err, --ok and --bg-sunken were referenced nine times and defined nowhere, so the tests
    // pane drew a pass and a fail in the same colour and four panes had no background.
    const theme = readFileSync(join(root, 'theme.css'), 'utf8')
    const defined = new Set([...theme.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))
    for (const f of [...sources, join(root, 'theme.css')]) {
      const code = readFileSync(f, 'utf8')
      for (const m of code.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        expect(defined.has(m[1]!), `${f.slice(root.length + 1)} uses ${m[1]}, which theme.css does not define`).toBe(true)
      }
    }
  })

  it('no component hardcodes a font size', () => {
    // 480 inline style objects is where the type scale used to drift; sizes come from the tokens.
    for (const f of sources) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (line.includes('style={{')) expect(line.trim(), f.slice(root.length + 1)).not.toMatch(/fontSize:\s*['"]?\d/)
      }
    }
  })

  it('nothing renders text below 11px', () => {
    const theme = readFileSync(join(root, 'theme.css'), 'utf8')
    for (const m of theme.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      expect(Number(m[1]), `theme.css has ${m[0]}`).toBeGreaterThanOrEqual(11)
    }
    for (const m of theme.matchAll(/--(?:micro|small|body|reading|title|display):\s*(\d+)px/g)) {
      expect(Number(m[1]), `the type scale has ${m[0]}`).toBeGreaterThanOrEqual(11)
    }
  })

  it('an icon-only button says what it does', () => {
    for (const f of sources) {
      const code = readFileSync(f, 'utf8')
      for (const m of code.matchAll(/<button((?:[^>]|\n)*?)>\s*<Icon[^>]*\/>\s*<\/button>/g)) {
        expect(/aria-label/.test(m[1]!), `${f.slice(root.length + 1)}: ${m[0].slice(0, 90)}… needs an aria-label`).toBe(true)
      }
    }
  })

  it('navigation is two levels: there is no .tabbtn idiom any more', () => {
    // window tabs, then one sidebar. Inside a pane, switching is a <Seg> and nothing else.
    const theme = readFileSync(join(root, 'theme.css'), 'utf8')
    expect(theme).not.toMatch(/\.tabbtn/)
    for (const f of sources) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
      expect(code, f.slice(root.length + 1)).not.toMatch(/tabbtn|subtabs/)
    }
  })

  it('the app ships an icon electron-builder can find', () => {
    // buildResources is `build`, so these three names are what electron-builder picks up. Without
    // them it falls back to the stock Electron logo with only a warning in the log.
    const dir = join(__dirname, '../build')
    for (const f of ['icon.png', 'icon.icns', 'icon.ico']) expect(existsSync(join(dir, f)), f).toBe(true)
    const png = readFileSync(join(dir, 'icon.png'))
    expect(png.subarray(1, 4).toString(), 'icon.png is not a PNG').toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], 'icon.png must be 1024x1024').toEqual([1024, 1024])
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

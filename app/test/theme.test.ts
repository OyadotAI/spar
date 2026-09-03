import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../src/renderer/theme.css'), 'utf8')

/** The light tokens come from the first `:root`; the dark ones override them inside the media query. */
function tokens(dark: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  const blocks = dark
    ? [css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')), css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))]
    : [css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'))]
  for (const b of blocks) for (const [, k, v] of b.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) out[k] = v
  return out
}

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number]
  return (a + 0.05) / (b + 0.05)
}

/** [foreground, background, minimum]. 4.5 is AA body text; 3 is AA large text and non-text marks. */
const PAIRS: [string, string, number][] = [
  ['--text', '--bg', 4.5], ['--text', '--surface', 4.5], ['--text', '--chrome', 4.5],
  ['--text', '--raised', 4.5], ['--text', '--well', 4.5],
  ['--dim', '--bg', 4.5], ['--dim', '--surface', 4.5], ['--dim', '--raised', 4.5], ['--dim', '--well', 4.5],
  ['--dim', '--info-bg', 4.5],                                        // .offline-note
  // --faint is the eyebrow / log timestamp / empty-state hint colour. It was 3.17:1.
  ['--faint', '--bg', 4.5], ['--faint', '--surface', 4.5], ['--faint', '--raised', 4.5], ['--faint', '--well', 4.5],
  ['--accent', '--bg', 4.5], ['--accent', '--raised', 4.5], ['--accent', '--surface', 4.5],
  ['--accent', '--info-bg', 4.5],                                     // .pill.info
  ['--add', '--add-bg', 4.5], ['--add', '--bg', 4.5], ['--add', '--raised', 4.5],
  ['--del', '--del-bg', 4.5], ['--del', '--bg', 4.5], ['--del', '--raised', 4.5],
  ['--warn', '--warn-bg', 4.5], ['--warn', '--bg', 4.5], ['--warn', '--raised', 4.5],
  ['--accent-fg', '--accent', 4.5],                                   // button.primary
  // WCAG 1.4.11 non-text contrast: the focus indicator must be visible on every surface it lands on.
  ['--focus', '--bg', 3], ['--focus', '--surface', 3], ['--focus', '--raised', 3],
  ['--focus', '--chrome', 3], ['--focus', '--well', 3],
]

for (const dark of [false, true]) {
  describe(`palette · ${dark ? 'dark' : 'light'}`, () => {
    const t = tokens(dark)
    it('defines every token the pairs name', () => {
      for (const [fg, bg] of PAIRS) { expect(t[fg], fg).toBeTruthy(); expect(t[bg], bg).toBeTruthy() }
    })
    for (const [fg, bg, min] of PAIRS) {
      it(`${fg} on ${bg} >= ${min}:1`, () => {
        const r = contrast(t[fg]!, t[bg]!)
        expect(Number(r.toFixed(2)), `${t[fg]} on ${t[bg]}`).toBeGreaterThanOrEqual(min)
      })
    }
  })
}

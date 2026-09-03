import { describe, expect, it } from 'vitest'
import { lineage, edgeId } from '@/dag/lineage'

//  a ─┐
//     ├─> c ─> d ─> e
//  b ─┘              (f is unrelated)
const EDGES = [
  { from: 'a', to: 'c' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'd', to: 'e' },
  { from: 'f', to: 'g' },
]

describe('lineage', () => {
  it('takes everything upstream and downstream of the anchor', () => {
    const l = lineage(EDGES, ['c'])
    expect([...l.nodes].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(l.nodes.has('f')).toBe(false)
    expect(l.edges.has(edgeId({ from: 'a', to: 'c' }))).toBe(true)
    expect(l.edges.has(edgeId({ from: 'f', to: 'g' }))).toBe(false)
  })
  it('a leaf keeps its whole ancestry', () => {
    expect([...lineage(EDGES, ['e']).nodes].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('a root keeps its whole descent but not its siblings', () => {
    const l = lineage(EDGES, ['a'])
    expect([...l.nodes].sort()).toEqual(['a', 'c', 'd', 'e'])
    expect(l.nodes.has('b')).toBe(false)          // b feeds c, but it is not a's lineage
  })
  it('multiple anchors union their neighbourhoods', () => {
    expect([...lineage(EDGES, ['a', 'f']).nodes].sort()).toEqual(['a', 'c', 'd', 'e', 'f', 'g'])
  })
  it('no anchor means no dimming at all', () => {
    expect(lineage(EDGES, []).nodes.size).toBe(0)
  })
  it('survives a cycle rather than looping for ever', () => {
    const cyc = [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }]
    expect([...lineage(cyc, ['x']).nodes].sort()).toEqual(['x', 'y'])
  })
})

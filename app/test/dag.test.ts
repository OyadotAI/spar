import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/api/client', () => ({ api: { get: vi.fn(), put: vi.fn(async () => ({ ok: true, value: { rev: 2 } })), post: vi.fn(), del: vi.fn() }, setBase: () => {}, baseUrl: () => '', wsUrl: (p: string) => p }))
vi.mock('@/events', () => ({ onEvent: () => () => {} }))

import { useDag, derive, type Raw } from '@/dag/store'
import { autoLayout } from '@/dag/layout'
import { SCHEMA, PALETTE, template } from '@/dag/schema'

const fixture = JSON.parse(readFileSync(join(__dirname, '../../daemon/src/test/resources/fixtures/dag-simple.json'), 'utf8')) as Raw

function seed(job: string, raw: Raw) {
  const d = derive(raw)
  useDag.setState({ jobs: { [job]: { raw, ...d, layout: autoLayout(d.nodes, d.edges), rev: 1, loaded: true, imported: true, selection: [], undo: [], redo: [], dirtyLayout: false } } })
}

describe('dag store', () => {
  beforeEach(() => { vi.useFakeTimers(); seed('orders', structuredClone(fixture)) })

  it('derives nodes and edges and keeps unknown fields through an edit', () => {
    const d = useDag.getState().get('orders')
    expect(d.nodes).toHaveLength(7)
    expect(d.edges).toContainEqual({ from: 'n-paid', to: 'n-join' })
    ;(fixture['n-orders']!.S3CsvSource as Record<string, unknown>).Mystery = { deep: [1, 2] }
    seed('orders', structuredClone(fixture))
    useDag.getState().setField('orders', 'n-paid', 'LogicalOperator', 'OR')
    const after = useDag.getState().get('orders')
    expect(after.raw['n-orders']!.S3CsvSource!.Mystery).toEqual({ deep: [1, 2] })
    expect(after.raw['n-paid']!.Filter!.LogicalOperator).toBe('OR')
    expect(after.undo).toHaveLength(1)
  })

  it('removing a node strips it from every Inputs; undo restores', () => {
    useDag.getState().remove('orders', ['n-customers'])
    let d = useDag.getState().get('orders')
    expect(d.raw['n-customers']).toBeUndefined()
    expect((d.raw['n-join']!.Join!.Inputs as string[])).toEqual(['n-paid'])
    useDag.getState().undo('orders')
    d = useDag.getState().get('orders')
    expect(d.raw['n-customers']).toBeDefined()
    expect((d.raw['n-join']!.Join!.Inputs as string[])).toEqual(['n-paid', 'n-customers'])
    expect(d.redo).toHaveLength(1)
  })

  it('connect refuses sources as targets and replaces a single input', () => {
    const s = useDag.getState()
    expect(s.connect('orders', 'n-map', 'n-orders')).toMatch(/source/)
    expect(s.connect('orders', 'n-out', 'n-agg')).toMatch(/target/)
    expect(s.connect('orders', 'n-customers', 'n-paid')).toBeNull()
    expect(useDag.getState().get('orders').raw['n-paid']!.Filter!.Inputs).toEqual(['n-customers'])
  })

  it('caps undo at 50 and ignores its own rev on remoteChanged', () => {
    for (let i = 0; i < 55; i++) useDag.getState().rename('orders', 'n-map', `m${i}`)
    expect(useDag.getState().get('orders').undo).toHaveLength(50)
  })

  it('adds a node from a template at a position and selects it', () => {
    const id = useDag.getState().add('orders', 'SparkSQL', { x: 10, y: 20 })
    const d = useDag.getState().get('orders')
    expect(d.layout[id]).toEqual({ x: 10, y: 20 })
    expect(d.selection).toEqual([id])
    expect(d.raw[id]!.SparkSQL!.Inputs).toEqual([])
  })
})

describe('layout', () => {
  it('is deterministic, left to right, without overlaps', () => {
    const d = derive(fixture)
    const a = autoLayout(d.nodes, d.edges), b = autoLayout([...d.nodes].reverse(), [...d.edges].reverse())
    expect(a).toEqual(b)
    expect(a['n-orders']!.x).toBeLessThan(a['n-map']!.x)
    expect(a['n-agg']!.x).toBeLessThan(a['n-out']!.x)
    const pts = Object.values(a).map((p) => `${p.x},${p.y}`)
    expect(new Set(pts).size).toBe(pts.length)
  })
  it('terminates on a cycle', () => {
    const raw: Raw = { a: { Filter: { Name: 'A', Inputs: ['b'] } }, b: { Filter: { Name: 'B', Inputs: ['a'] } } }
    const d = derive(raw)
    expect(Object.keys(autoLayout(d.nodes, d.edges))).toEqual(['a', 'b'])
  })
})

describe('schema', () => {
  it('every palette type has a schema and a template whose keys the schema knows', () => {
    for (const g of PALETTE) for (const t of g.types) {
      expect(SCHEMA[t], t).toBeDefined()
      const keys = new Set(['Name', 'Inputs', 'OutputSchemas', ...SCHEMA[t]!.flatMap((f) => [f.key, ...(f.alsoWrites ?? [])])])
      for (const k of Object.keys(template(t, 'x'))) expect(keys.has(k), `${t}.${k}`).toBe(true)
    }
  })
})

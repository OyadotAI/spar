import { describe, expect, it } from 'vitest'
import { score, subsequence, within } from '@/dag/search'
import { CATALOG, KEYWORDS, uiName } from '@/dag/catalog'

/** The whole catalogue, ranked, the way the palette ranks it. */
function find(q: string): string[] {
  return CATALOG.flatMap((f) => f.types)
    .map(([t, n]) => ({ t, s: score(q, n, t, KEYWORDS[t]) }))
    .filter((x): x is { t: string; s: number } => x.s != null)
    .sort((a, b) => b.s - a.s).map((x) => x.t)
}

describe('typo tolerance', () => {
  it('absorbs a transposition, which plain includes() cannot', () => {
    expect(within('cvs', 'csv')).toBe(true)
    expect(within('parquest', 'parquet', 2)).toBe(true)
    expect(within('abc', 'xyz')).toBe(false)
    expect(within('a', 'abcd')).toBe(false)          // too far apart in length
  })
  it('matches out-of-order-free subsequences', () => {
    expect(subsequence('aplymap', 'apply mapping')).toBe(true)
    expect(subsequence('zzz', 'apply mapping')).toBe(false)
  })
})

describe('finding a node type', () => {
  it('finds CSV from the transposition the user actually typed', () => {
    expect(find('cvs')).toContain('S3CsvSource')
    expect(find('csv')[0]).toBe('S3CsvSource')
  })
  it('finds a node by the word people use, not the word Glue uses', () => {
    expect(find('dedupe')).toContain('DropDuplicates')
    expect(find('where')).toContain('Filter')
    expect(find('group by')).toContain('Aggregate')
    expect(find('mask')).toContain('PIIDetection')
    expect(find('sql')).toContain('SparkSQL')
    expect(find('write')).toContain('S3DirectTarget')
  })
  it('ranks an exact name first', () => {
    expect(find('join')[0]).toBe('Join')
    expect(find('filter')[0]).toBe('Filter')
  })
  it('an empty query keeps the whole catalogue', () => {
    expect(find('').length).toBe(CATALOG.flatMap((f) => f.types).length)
  })
  it('nonsense still matches nothing, so the pane can say so', () => {
    expect(find('qqqqzzzz')).toEqual([])
  })
  it('every keyword list names a type that exists', () => {
    const types = new Set(CATALOG.flatMap((f) => f.types).map(([t]) => t))
    for (const k of Object.keys(KEYWORDS)) expect(types.has(k), `${k} (${uiName(k)})`).toBe(true)
  })
})

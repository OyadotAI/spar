import { describe, expect, it } from 'vitest'
import { parseSparkOutput } from '@/sessions/sparkTable'
import { dpu, idleLeftMin, money, perHour, shortName, spent } from '@/sessions/model'
import type { SessionInfo } from '@/wire/types'

const s = (p: Partial<SessionInfo> = {}): SessionInfo => ({ id: 'keel-8f3a-41207', status: 'READY', workerType: 'G.1X', numberOfWorkers: 2, idleTimeout: 30, ...p })

describe('session cost', () => {
  it('prices a session by worker size and count', () => {
    expect(dpu('G.1X', 2)).toBe(2)
    expect(dpu('G.2X', 5)).toBe(10)
    expect(dpu('G.025X', 4)).toBe(1)
    expect(dpu(undefined, undefined)).toBe(2)          // Glue's own defaults
    expect(perHour(s())).toBeCloseTo(0.88, 2)          // the number the header shows
    expect(perHour(s({ workerType: 'G.8X', numberOfWorkers: 10 }))).toBeCloseTo(35.2, 1)
  })
  it('spends what Glue says it billed, not what we guessed', () => {
    expect(spent(s({ dpuSeconds: 3600 }))).toBeCloseTo(0.44, 2)
    expect(spent(s())).toBe(0)
    expect(money(0)).toBe('$0')
    expect(money(0.88)).toBe('$0.88')
  })
})

describe('idle countdown', () => {
  const now = Date.parse('2026-09-02T12:00:00Z')
  it('counts from the last statement, not from creation', () => {
    const st = [{ id: 1, state: 'AVAILABLE', completedOn: '2026-09-02T11:50:00Z' }] as never
    expect(idleLeftMin(s({ createdOn: '2026-09-02T09:00:00Z' }), st, now)).toBe(20)
  })
  it('falls back to creation when nothing has run', () => {
    expect(idleLeftMin(s({ createdOn: '2026-09-02T11:45:00Z' }), [], now)).toBe(15)
  })
  it('never guesses: no timestamp, or not live, means no countdown', () => {
    expect(idleLeftMin(s(), [], now)).toBeNull()
    expect(idleLeftMin(s({ status: 'STOPPED', createdOn: '2026-09-02T11:45:00Z' }), [], now)).toBeNull()
  })
  it('clamps at zero rather than going negative', () => {
    expect(idleLeftMin(s({ createdOn: '2026-09-02T10:00:00Z' }), [], now)).toBe(0)
  })
})

describe('session names', () => {
  it('makes the two machine-generated id shapes readable', () => {
    expect(shortName(s())).toBe('Keel session 41207')
    expect(shortName(s({ id: 'glue-studio-datapreview-16c0627a-ad79-4a11-99b8-8ef7cc2a69ba' }))).toBe('Glue Studio data preview')
    expect(shortName(s({ id: 'my-own-session' }))).toBe('my-own-session')
  })
})

describe('spark output', () => {
  it('turns a show() box back into rows', () => {
    const out = parseSparkOutput([
      'some log line',
      '+---+-----+',
      '| id| name|',
      '+---+-----+',
      '|  1|  bob|',
      '|  2|alice|',
      '+---+-----+',
      'only showing top 20 rows',
    ].join('\n'))
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ kind: 'text', text: 'some log line' })
    expect(out[1]).toEqual({ kind: 'table', cols: ['id', 'name'], rows: [['1', 'bob'], ['2', 'alice']] })
    expect(out[2]).toEqual({ kind: 'text', text: 'only showing top 20 rows' })
  })
  it('handles an empty result set and plain text with no table at all', () => {
    expect(parseSparkOutput('+---+\n| id|\n+---+\n+---+')).toEqual([{ kind: 'table', cols: ['id'], rows: [] }])
    expect(parseSparkOutput('just text')).toEqual([{ kind: 'text', text: 'just text' }])
    expect(parseSparkOutput('')).toEqual([])
  })
})

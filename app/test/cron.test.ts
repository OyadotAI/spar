import { describe as d, expect, it } from 'vitest'
import { build, describe as english, fields, nextRuns, toSpec, unwrap, DEFAULT_SPEC } from '@/job/cron'

const at = (s: string) => new Date(s)
const iso = (dates: Date[]) => dates.map((x) => x.toISOString().slice(0, 16) + 'Z')

d('reading a schedule', () => {
  it('unwraps the cron(...) Glue hands back', () => {
    expect(unwrap('cron(0 8 ? * MON-FRI *)')).toBe('0 8 ? * MON-FRI *')
    expect(unwrap('0 8 ? * MON-FRI *')).toBe('0 8 ? * MON-FRI *')
  })
  it('rejects anything that is not six fields', () => {
    expect(fields('0 8 * * *')).toBeNull()
    expect(english('0 8 * * *')).toBe('Custom schedule')
    expect(nextRuns('nonsense', at('2026-09-02T10:00:00Z'))).toEqual([])
  })
})

d('next runs', () => {
  const now = at('2026-09-02T10:30:00Z')          // a Wednesday
  it('daily', () => {
    expect(iso(nextRuns('0 6 * * ? *', now))).toEqual(['2026-09-03T06:00Z', '2026-09-04T06:00Z', '2026-09-05T06:00Z'])
  })
  it('later the same day when the time has not passed', () => {
    expect(iso(nextRuns('0 18 * * ? *', now, 1))).toEqual(['2026-09-02T18:00Z'])
  })
  it('weekdays only skips the weekend', () => {
    expect(iso(nextRuns('0 8 ? * MON-FRI *', now, 4)))
      .toEqual(['2026-09-03T08:00Z', '2026-09-04T08:00Z', '2026-09-07T08:00Z', '2026-09-08T08:00Z'])
  })
  it('hourly', () => {
    expect(iso(nextRuns('0 * * * ? *', now, 2))).toEqual(['2026-09-02T11:00Z', '2026-09-02T12:00Z'])
  })
  it('a step in the hour field', () => {
    expect(iso(nextRuns('30 */6 * * ? *', now, 3))).toEqual(['2026-09-02T12:30Z', '2026-09-02T18:30Z', '2026-09-03T00:30Z'])
  })
  it('monthly on the 1st rolls to the next month', () => {
    expect(iso(nextRuns('0 0 1 * ? *', now, 2))).toEqual(['2026-10-01T00:00Z', '2026-11-01T00:00Z'])
  })
  it('gives up rather than hanging on something that can never fire', () => {
    expect(nextRuns('0 0 30 2 ? *', now)).toEqual([])       // 30 February
  })
})

d('plain English', () => {
  it('names the shapes people actually use', () => {
    expect(english('0 6 * * ? *')).toBe('Every day at 06:00 UTC')
    expect(english('0 8 ? * MON-FRI *')).toBe('Every weekday at 08:00 UTC')
    expect(english('0 0 ? * SAT,SUN *')).toBe('At weekends at 00:00 UTC')
    expect(english('0 0 ? * MON *')).toBe('Every Monday at 00:00 UTC')
    expect(english('0 0 1 * ? *')).toBe('Monthly on the 1st at 00:00 UTC')
    expect(english('15 * * * ? *')).toBe('Hourly at :15')
    expect(english('*/5 * * * ? *')).toBe('Every 5 minutes')
  })
})

d('building and reading back', () => {
  it('round-trips every frequency the builder offers', () => {
    for (const spec of [
      { ...DEFAULT_SPEC, every: 'hour' as const, minute: 15 },
      { ...DEFAULT_SPEC, every: 'day' as const, hour: 6, minute: 30 },
      { ...DEFAULT_SPEC, every: 'week' as const, hour: 8, minute: 0, days: [2, 4, 6] },
      { ...DEFAULT_SPEC, every: 'month' as const, hour: 0, minute: 0, dayOfMonth: 15 },
    ]) {
      const back = toSpec(build(spec))
      expect(back, build(spec)).not.toBeNull()
      expect(back!.every).toBe(spec.every)
      expect(back!.minute).toBe(spec.minute)
      if (spec.every !== 'hour') expect(back!.hour).toBe(spec.hour)
      if (spec.every === 'week') expect(back!.days).toEqual(spec.days)
      if (spec.every === 'month') expect(back!.dayOfMonth).toBe(spec.dayOfMonth)
    }
  })
  it('builds what Glue expects, with exactly one ? between day-of-month and day-of-week', () => {
    expect(build({ ...DEFAULT_SPEC, every: 'week', hour: 8, minute: 0, days: [2, 3, 4, 5, 6] })).toBe('0 8 ? * MON,TUE,WED,THU,FRI *')
    expect(build({ ...DEFAULT_SPEC, every: 'day', hour: 6, minute: 0 })).toBe('0 6 * * ? *')
  })
  it('says so when an expression is too complex for the builder', () => {
    expect(toSpec('0 1,13 * * ? *')).toBeNull()
  })
})

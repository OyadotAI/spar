import { describe, expect, it } from 'vitest'
import { duration, isRunning, stateTone } from '@/shell/format'
import { filteredJobs } from '@/stores/glue'

describe('format', () => {
  it('maps states to tones and running-ness', () => {
    expect(stateTone('SUCCEEDED')).toBe('ok'); expect(stateTone('FAILED')).toBe('err'); expect(stateTone('RUNNING')).toBe('info')
    expect(isRunning('STARTING')).toBe(true); expect(isRunning('STOPPED')).toBe(false); expect(isRunning(undefined)).toBe(false)
  })
  it('formats durations and grows a running one from startedOn', () => {
    expect(duration(65)).toBe('1m 5s'); expect(duration(3700)).toBe('1h 1m'); expect(duration(0)).toBe('—')
    const started = new Date(Date.now() - 120_000).toISOString()
    expect(duration(0, started, true)).toMatch(/^2m/)
  })
  it('filters jobs by name or state', () => {
    const jobs = [{ name: 'orders-etl', latestRun: { id: '1', state: 'FAILED' } }, { name: 'customers' }]
    expect(filteredJobs(jobs, 'ORDER').map((j) => j.name)).toEqual(['orders-etl'])
    expect(filteredJobs(jobs, 'failed').map((j) => j.name)).toEqual(['orders-etl'])
    expect(filteredJobs(jobs, '')).toHaveLength(2)
  })
})

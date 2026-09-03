import { beforeEach, describe, expect, it } from 'vitest'
import { accountKey, useGlue } from '@/stores/glue'
import type { GlueJob } from '@/wire/types'

const JOBS = [{ name: 'a' }, { name: 'b' }] as GlueJob[]
const fill = () => useGlue.setState({ jobs: JOBS, loaded: true, refreshedAt: 'x', stale: true })

describe('switching account or region', () => {
  beforeEach(() => { useGlue.setState({ jobs: [], loaded: false, refreshedAt: undefined, stale: false, account: null }) })

  it('keys a listing by profile and region together', () => {
    expect(accountKey('default', 'us-east-2')).toBe('default@us-east-2')
    expect(accountKey(undefined, undefined)).toBe('@')
    expect(accountKey('default', 'us-east-2')).not.toBe(accountKey('default', 'eu-west-1'))
  })

  it('keeps the listing when nothing about the account changed', () => {
    const g = useGlue.getState()
    g.accountChanged('default', 'us-east-2')   // first sighting: not a change
    fill()
    g.accountChanged('default', 'us-east-2')
    expect(useGlue.getState().jobs).toHaveLength(2)
    expect(useGlue.getState().loaded).toBe(true)
  })

  it('drops the listing when the region changes', () => {
    const g = useGlue.getState()
    g.accountChanged('default', 'us-east-2')
    fill()
    g.accountChanged('default', 'eu-west-1')
    // these jobs are from the region we just left; showing them would be a lie
    expect(useGlue.getState().jobs).toEqual([])
    expect(useGlue.getState().loaded).toBe(false)
    expect(useGlue.getState().refreshedAt).toBeUndefined()
    expect(useGlue.getState().stale).toBe(false)
  })

  it('drops the listing when the profile changes', () => {
    const g = useGlue.getState()
    g.accountChanged('default', 'us-east-2')
    fill()
    g.accountChanged('other', 'us-east-2')
    expect(useGlue.getState().jobs).toEqual([])
  })

  it('does not clear on the very first state it ever sees', () => {
    fill()
    useGlue.getState().accountChanged('brand-new', 'us-east-2')
    expect(useGlue.getState().jobs).toHaveLength(2)
  })
})

describe('what a region switch invalidates', () => {
  it('every screen that reads from AWS depends on the account key', async () => {
    // an effect that loads from /api/glue/... but does not list `account` in its dependencies
    // will keep showing the previous region's answer — that was the bug.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(__dirname, '../src/renderer')
    const region: [string, string][] = [
      ['pages/Connections.tsx', 'the connections'], ['pages/Profiles.tsx', 'the usage profiles'],
      ['pages/Monitoring.tsx', 'run history'], ['pages/SessionsPage.tsx', 'the sessions'],
      ['job/Schedules.tsx', 'the schedules'], ['job/UpgradeTab.tsx', 'the upgrade check'],
      ['job/JobDetails.tsx', 'the job definition'],
    ]
    for (const [file] of region) {
      const code = readFileSync(join(root, file), 'utf8')
      expect(code, `${file} must read the account`).toMatch(/const account = useAccount\(\)/)
      expect(code, `${file}: its load effect must depend on it`).toMatch(/\[[^\]]*\baccount\b[^\]]*\]\)/)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Nothing in a store polls. The daemon pushes; the only timers allowed are the ones named here. */
const ALLOWED: Record<string, number> = {
  'api/sse.ts': 2,          // the silence watchdog + nothing else
  'events.ts': 1,           // reconnect backoff
  'api/client.ts': 1,       // the request timeout
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
}

describe('no polling', () => {
  it('stores and api modules own no timers beyond the allowed list', () => {
    const root = join(__dirname, '../src/renderer')
    for (const file of walk(root).filter((f) => /\/(stores|api)\/|\/events\.ts$/.test(f) && /\.ts$/.test(f))) {
      const rel = file.slice(root.length + 1)
      const n = (readFileSync(file, 'utf8').match(/set(Interval|Timeout)\(/g) ?? []).length
      expect(n, `${rel} has ${n} timer(s)`).toBeLessThanOrEqual(ALLOWED[rel] ?? 0)
    }
  })
})

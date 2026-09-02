import { baseUrl } from './client'

/**
 * An SSE subscription with the two clocks v1 learned it needs: `lastEventAt` (anything at all,
 * including the daemon's keep-alive comment — 60 s of silence means the stream is dead) and
 * `lastProgressAt` (a real event). EventSource hides comment lines, so we read the stream with
 * fetch and parse it ourselves — same wire, and we see the heartbeats.
 */
export type SseHandler = { on: (name: string, data: string) => void; end: (reason: string) => void }
export type Sse = { close: () => void; lastEventAt: () => number; lastProgressAt: () => number }

export function subscribe(path: string, h: SseHandler, opts: { silenceMs?: number; method?: string; body?: unknown } = {}): Sse {
  const ctl = new AbortController()
  let lastEvent = Date.now(), lastProgress = Date.now(), closed = false
  const silence = opts.silenceMs ?? 60_000
  const watchdog = setInterval(() => {
    if (Date.now() - lastEvent > silence) { finish(`no frames for ${Math.round(silence / 1000)}s`) }
  }, 5_000)
  function finish(reason: string): void {
    if (closed) return
    closed = true
    clearInterval(watchdog)
    ctl.abort()
    h.end(reason)
  }
  ;(async () => {
    try {
      const r = await fetch(baseUrl() + path, {
        method: opts.method ?? 'GET', signal: ctl.signal,
        headers: { accept: 'text/event-stream', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      })
      if (!r.ok || !r.body) { finish(`${r.status} ${r.statusText}`); return }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2)
          lastEvent = Date.now()
          let name = 'message'; const data: string[] = []; let comment = false
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) { comment = true; continue }
            if (line.startsWith('event:')) name = line.slice(6).trim()
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
          }
          if (data.length === 0 && comment) continue
          if (data.length === 0) continue
          lastProgress = Date.now()
          if (!closed) h.on(name, data.join('\n'))
        }
      }
      finish('ended')
    } catch (e) {
      finish(closed ? 'closed' : (e as Error).message)
    }
  })()
  return { close: () => finish('closed'), lastEventAt: () => lastEvent, lastProgressAt: () => lastProgress }
}

/** One HTTP client. Every call has a 90 s ceiling and returns a Result, so a pane can say *why* it is empty. */
export type Fault = { what: string; why: string; status?: number; fix?: string }
export type Result<T> = { ok: true; value: T } | { ok: false; fault: Fault }

let base = ''
export function setBase(port: number): void { base = port ? `http://127.0.0.1:${port}` : '' }
export function baseUrl(): string { return base }
export function wsUrl(path: string): string { return base.replace(/^http/, 'ws') + path }

async function call<T>(method: string, path: string, body: unknown, what: string, timeoutMs: number = 90_000): Promise<Result<T>> {
  if (!base) return { ok: false, fault: { what, why: 'the daemon is not running yet' } }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(base + path, {
      method, signal: ctl.signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    let json: unknown = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    if (!r.ok) {
      const e = (json ?? {}) as { error?: string; fix?: string }
      return { ok: false, fault: { what, why: e.error ?? `${r.status} ${r.statusText}`, status: r.status, fix: e.fix } }
    }
    return { ok: true, value: json as T }
  } catch (e) {
    const why = (e as Error).name === 'AbortError' ? `no answer in ${Math.round(timeoutMs / 1000)}s` : (e as Error).message
    return { ok: false, fault: { what, why } }
  } finally { clearTimeout(t) }
}

/** Deploy, preview and session statements outlive the default ceiling, so those call sites pass their own. */
export const api = {
  get: <T>(path: string, what: string, timeoutMs?: number) => call<T>('GET', path, undefined, what, timeoutMs),
  post: <T>(path: string, body: unknown, what: string, timeoutMs?: number) => call<T>('POST', path, body ?? {}, what, timeoutMs),
  put: <T>(path: string, body: unknown, what: string, timeoutMs?: number) => call<T>('PUT', path, body, what, timeoutMs),
  del: <T>(path: string, what: string, timeoutMs?: number) => call<T>('DELETE', path, undefined, what, timeoutMs),
}

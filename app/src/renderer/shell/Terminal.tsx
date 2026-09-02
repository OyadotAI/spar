import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { wsUrl } from '@/api/client'
import { useApp } from '@/stores/app'

/** One xterm over the daemon's pty WebSocket. `run` types a command for the person (e.g. `aws sso login`). */
export function TerminalPane({ cwd, run }: { cwd?: string; run?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const port = useApp((s) => s.port)
  useEffect(() => {
    if (!box.current || !port) return
    const term = new XTerm({ fontFamily: 'var(--mono)', fontSize: 12, cursorBlink: true, theme: { background: '#0c0d0f' }, allowProposedApi: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(box.current)
    fit.fit()
    const q = new URLSearchParams({ cwd: cwd ?? '', cols: String(term.cols), rows: String(term.rows) })
    if (run) q.set('run', run)
    const ws = new WebSocket(wsUrl('/ws/term?' + q.toString()))
    ws.binaryType = 'arraybuffer'
    ws.onmessage = (e) => { if (typeof e.data === 'string') return; term.write(new Uint8Array(e.data)) }
    ws.onclose = () => term.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n')
    const enc = new TextEncoder()
    const d1 = term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(d)) })
    const d2 = term.onResize(({ cols, rows }) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ resize: { cols, rows } })) })
    const ro = new ResizeObserver(() => { try { fit.fit() } catch { /* not laid out yet */ } })
    ro.observe(box.current)
    term.focus()
    return () => { ro.disconnect(); d1.dispose(); d2.dispose(); ws.close(); term.dispose() }
  }, [port, cwd, run])
  return <div ref={box} style={{ height: '100%', width: '100%', background: '#0c0d0f', padding: '4px 0 0 6px' }} />
}

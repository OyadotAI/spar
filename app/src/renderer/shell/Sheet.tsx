import { useEffect, useRef, type ReactNode } from 'react'
import { useEscape } from './useEscape'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * The one modal. Five hand-written copies of `.sheet-backdrop` used to exist, none of them a
 * dialog: Tab walked straight out into the page behind, focus never came back to whatever opened
 * them, and a stray click on the backdrop threw away typed run arguments without asking.
 *
 * `dirty` says the sheet holds unsaved input. A dirty sheet ignores backdrop clicks — Escape and
 * Cancel still close it, because those are deliberate. That is the whole guard; a confirmation
 * dialog on top of a dialog would be worse than the problem.
 */
export function Sheet({ children, onClose, label, width, dirty = false }:
  { children: ReactNode; onClose: () => void; label: string; width?: number; dirty?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEscape(true, onClose)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    const el = box.current
    // autoFocus has already run by now; only reach for the first control if nothing took focus
    if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => opener.current?.focus?.()
  }, [])
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !dirty) onClose() }}>
      <div ref={box} className="sheet" role="dialog" aria-modal="true" aria-label={label}
        style={width ? { width } : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return
          const items = [...box.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
          if (!items.length) return
          const first = items[0]!, last = items[items.length - 1]!
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        }}>{children}</div>
    </div>
  )
}

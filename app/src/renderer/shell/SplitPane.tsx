import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Two children with a draggable handle between them.
 *
 * `initial` is a *fraction* of the container, not pixels, and that is the whole point: sizes used
 * to be computed once at mount from window.innerWidth and stored in px, so resizing the window
 * never reflowed them and a narrow window could squeeze the DAG canvas to nothing.
 *
 * `min`/`minB` are pixel floors, honoured against the live container size. When the container is
 * too narrow to satisfy both, `b` becomes an overlay on top of `a` rather than crushing it — the
 * canvas keeps its floor and the inspector stays usable.
 *
 * The handle is a real `separator`: arrow keys move it, Home/End snap, double-click resets.
 */
export function SplitPane({ a, b, initial, min = 160, minB = 200, storageKey, vertical = false, canOverlay = false }:
  { a: ReactNode; b: ReactNode; initial: number; min?: number; minB?: number; storageKey: string; vertical?: boolean; canOverlay?: boolean }) {
  const [frac, setFrac] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('split.' + storageKey))
      // values > 1 are the old pixel format; drop them rather than honour a meaningless number
      if (v > 0 && v < 1) return v
    } catch { /* no storage */ }
    return initial
  })
  const [dragging, setDragging] = useState(false)
  const [total, setTotal] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { try { localStorage.setItem('split.' + storageKey, String(frac)) } catch { /* ignore */ } }, [frac, storageKey])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    // measure on the next frame: resizing inside the callback is what makes Chrome complain
    // about "ResizeObserver loop completed with undelivered notifications"
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setTotal(vertical ? el.clientHeight : el.clientWidth))
    })
    ro.observe(el)
    setTotal(vertical ? el.clientHeight : el.clientWidth)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [vertical])

  const overlay = canOverlay && total > 0 && total < min + minB
  // clamp the fraction against the live container so a window resize reflows instead of freezing
  const size = overlay ? total : Math.max(min, Math.min(total - minB, frac * total))
  // Before the observer has measured, size in percent. Handing the first paint `0px` starves
  // anything that measures itself on mount — React Flow renders nothing in a zero-width box.
  const basis = total === 0 ? `${frac * 100}%` : `${size}px`
  const nudge = (px: number) => setFrac((f) => {
    if (!total) return f
    return Math.max(min / total, Math.min((total - minB) / total, (f * total + px) / total))
  })
  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const rect = box.current!.getBoundingClientRect()
    const span = vertical ? rect.height : rect.width
    const move = (ev: MouseEvent) => {
      const pos = vertical ? ev.clientY - rect.top : ev.clientX - rect.left
      setFrac(Math.max(min / span, Math.min((span - minB) / span, pos / span)))
    }
    const up = () => { setDragging(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [min, minB, vertical])

  return (
    <div ref={box} className={'split' + (vertical ? ' v' : '')} style={overlay ? { position: 'relative' } : undefined}>
      <div style={{ flex: `0 0 ${basis}`, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>{a}</div>
      {!overlay && (
        <div className={'handle' + (dragging ? ' on' : '')} role="separator" tabIndex={0}
          aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-label="Resize"
          aria-valuenow={Math.round((size / (total || 1)) * 100)} aria-valuemin={0} aria-valuemax={100}
          onMouseDown={onDown} onDoubleClick={() => setFrac(initial)}
          onKeyDown={(e) => {
            const back = vertical ? 'ArrowUp' : 'ArrowLeft', fwd = vertical ? 'ArrowDown' : 'ArrowRight'
            if (e.key === back) { e.preventDefault(); nudge(e.shiftKey ? -64 : -16) }
            else if (e.key === fwd) { e.preventDefault(); nudge(e.shiftKey ? 64 : 16) }
            else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setFrac(initial) }
          }} />)}
      <div className={overlay ? undefined : 'fill'}
        style={overlay
          ? { position: 'absolute', top: 0, right: 0, bottom: 0, width: minB, zIndex: 6, overflow: 'hidden', boxShadow: 'var(--e3)', background: 'var(--surface)' }
          : { overflow: 'hidden' }}>{b}</div>
    </div>
  )
}

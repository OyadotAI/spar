import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Two children with a draggable handle between them. `size` is the first child's px size and is
 * remembered under `storageKey`. Vertical when `vertical`. Double-click resets to `initial`.
 */
export function SplitPane({ a, b, initial, min = 160, minB = 200, storageKey, vertical = false }:
  { a: ReactNode; b: ReactNode; initial: number; min?: number; minB?: number; storageKey: string; vertical?: boolean }) {
  const [size, setSize] = useState<number>(() => {
    try { const v = localStorage.getItem('split.' + storageKey); if (v) return Number(v) } catch { /* no storage */ }
    return initial
  })
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { try { localStorage.setItem('split.' + storageKey, String(size)) } catch { /* ignore */ } }, [size, storageKey])
  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const rect = box.current!.getBoundingClientRect()
    const move = (ev: MouseEvent) => {
      const total = vertical ? rect.height : rect.width
      const pos = (vertical ? ev.clientY - rect.top : ev.clientX - rect.left)
      setSize(Math.max(min, Math.min(total - minB, pos)))
    }
    const up = () => { setDragging(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [min, minB, vertical])
  return (
    <div ref={box} className={'split' + (vertical ? ' v' : '')}>
      <div style={{ flex: `0 0 ${size}px`, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>{a}</div>
      <div className={'handle' + (dragging ? ' on' : '')} onMouseDown={onDown} onDoubleClick={() => setSize(initial)} />
      <div className="fill" style={{ overflow: 'hidden' }}>{b}</div>
    </div>
  )
}

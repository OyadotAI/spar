import { useEffect } from 'react'

/** Esc closes a sheet. Capture phase, so an open sheet wins over the toast dismisser on the same key. */
export function useEscape(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, close])
}

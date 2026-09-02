import { useState } from 'react'
import { create } from 'zustand'
import { useEscape } from './useEscape'

type Ask = { title: string; body?: string; label?: string; value?: string; placeholder?: string; mono?: boolean; confirmLabel?: string; resolve: (v: string | null) => void }
type Store = { ask: Ask | null; open: (a: Omit<Ask, 'resolve'>) => Promise<string | null>; close: (v: string | null) => void }

/** In-app text prompt, replacing `window.prompt` (commit messages, a clone's name). */
export const usePrompt = create<Store>((set, get) => ({
  ask: null,
  open: (a) => new Promise<string | null>((resolve) => set({ ask: { ...a, resolve } })),
  close: (v) => { const a = get().ask; set({ ask: null }); a?.resolve(v) },
}))

export const prompt = (a: Omit<Ask, 'resolve'>): Promise<string | null> => usePrompt.getState().open(a)

export function PromptSheet() {
  const { ask, close } = usePrompt()
  const [v, setV] = useState('')
  const [seen, setSeen] = useState<Ask | null>(null)
  useEscape(!!ask, () => close(null))
  if (!ask) return null
  if (seen !== ask) { setSeen(ask); setV(ask.value ?? ''); return null }
  return (
    <div className="sheet-backdrop" onClick={() => close(null)}>
      <div className="sheet" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>{ask.title}</h2>
        {ask.body && <p className="dim" style={{ marginTop: 0 }}>{ask.body}</p>}
        <input autoFocus className={ask.mono ? 'mono' : ''} style={{ width: '100%' }} placeholder={ask.placeholder} value={v}
          onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) close(v); if (e.key === 'Escape') close(null) }} />
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={() => close(null)}>Cancel</button>
          <button className="primary" disabled={!v.trim()} onClick={() => close(v)}>{ask.confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  )
}

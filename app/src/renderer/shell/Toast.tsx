import { create } from 'zustand'
import { useEffect } from 'react'
import { Icon } from './Icon'
import type { Fault } from '@/api/client'

export type Note = { id: string; kind: 'ok' | 'bad' | 'info'; title: string; detail?: string; action?: { label: string; run: () => void } }

type Store = {
  notes: Note[]
  push: (n: Omit<Note, 'id'>) => void
  fail: (what: string, f: Fault) => void
  done: (title: string, detail?: string) => void
  dismiss: (id: string) => void
}

/**
 * One place a result becomes visible. Before this, ~42 call sites did `if (r.ok)` with no else, so
 * a failed Run from the jobs table did nothing at all on screen.
 */
export const useToast = create<Store>((set, get) => ({
  notes: [],
  push: (n) => {
    const id = Math.random().toString(36).slice(2)
    set({ notes: [...get().notes, { ...n, id }] })
    if (n.kind !== 'bad') setTimeout(() => get().dismiss(id), 4000)
  },
  fail: (what, f) => get().push({ kind: 'bad', title: `Could not ${what}`, detail: `${f.why}${f.fix ? ` — ${f.fix}` : ''}` }),
  done: (title, detail) => get().push({ kind: 'ok', title, detail }),
  dismiss: (id) => set({ notes: get().notes.filter((n) => n.id !== id) }),
}))

export function Toasts() {
  const { notes, dismiss } = useToast()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && notes.length) dismiss(notes[notes.length - 1]!.id) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notes, dismiss])
  if (!notes.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {notes.map((n) => (
        <div key={n.id} className={'toast ' + n.kind}>
          <Icon name={n.kind === 'ok' ? 'ok' : n.kind === 'bad' ? 'bad' : 'info'} size={15} />
          <div className="fill">
            <div className="t">{n.title}</div>
            {n.detail && <div className="d">{n.detail}</div>}
          </div>
          {n.action && <button className="quiet" onClick={() => { n.action!.run(); dismiss(n.id) }}>{n.action.label}</button>}
          <button className="quiet" aria-label="Dismiss" onClick={() => dismiss(n.id)}><Icon name="x" size={12} /></button>
        </div>))}
    </div>
  )
}

/** `await tell('start orders-etl', api.post(...))` — reports the failure, returns the value or null. */
export async function tell<T>(what: string, p: Promise<{ ok: true; value: T } | { ok: false; fault: Fault }>, okMessage?: string): Promise<T | null> {
  const r = await p
  if (!r.ok) { useToast.getState().fail(what, r.fault); return null }
  if (okMessage) useToast.getState().done(okMessage)
  return r.value
}

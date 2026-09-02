import { useState } from 'react'
import { create } from 'zustand'
import { useEscape } from './useEscape'
import { Icon } from './Icon'

type Ask = { title: string; body?: string; confirmLabel?: string; danger?: boolean; typeToConfirm?: string; resolve: (ok: boolean) => void }
type Store = { ask: Ask | null; open: (a: Omit<Ask, 'resolve'>) => Promise<boolean>; close: (ok: boolean) => void }

/**
 * In-app confirmation, replacing `window.confirm`. Irreversible AWS actions pass `typeToConfirm`,
 * so deleting a job in someone's account takes the same deliberate act the AWS console asks for.
 */
export const useConfirm = create<Store>((set, get) => ({
  ask: null,
  open: (a) => new Promise<boolean>((resolve) => set({ ask: { ...a, resolve } })),
  close: (ok) => { const a = get().ask; set({ ask: null }); a?.resolve(ok) },
}))

export const confirm = (a: Omit<Ask, 'resolve'>): Promise<boolean> => useConfirm.getState().open(a)

export function ConfirmSheet() {
  const { ask, close } = useConfirm()
  const [typed, setTyped] = useState('')
  useEscape(!!ask, () => close(false))
  if (!ask) return null
  const need = ask.typeToConfirm
  const ready = !need || typed === need
  return (
    <div className="sheet-backdrop" onClick={() => close(false)}>
      <div className="sheet" style={{ width: 460 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter' && ready) { setTyped(''); close(true) } }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
          <Icon name={ask.danger ? 'warn' : 'info'} size={18} style={{ color: ask.danger ? 'var(--del)' : 'var(--accent)', marginTop: 2 }} />
          <h2 style={{ margin: 0 }}>{ask.title}</h2>
        </div>
        {ask.body && <p className="dim" style={{ marginTop: 0 }}>{ask.body}</p>}
        {need && (
          <label className="col" style={{ gap: 4, fontSize: 12, color: 'var(--dim)' }}>
            Type <b className="mono">{need}</b> to confirm
            <input autoFocus className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>)}
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={() => { setTyped(''); close(false) }}>Cancel</button>
          <button className={ask.danger ? 'danger' : 'primary'} disabled={!ready} onClick={() => { setTyped(''); close(true) }}>{ask.confirmLabel ?? 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}

import { create } from 'zustand'

/** The terminal drawer: open/closed, and an optional command to type on the next open. */
type T = { open: boolean; run?: string; nonce: number; toggle: () => void; openWith: (run: string) => void; close: () => void }
export const useTerminal = create<T>((set, get) => ({
  open: false, nonce: 0,
  toggle: () => set({ open: !get().open, run: undefined }),
  openWith: (run) => set({ open: true, run, nonce: get().nonce + 1 }),
  close: () => set({ open: false, run: undefined }),
}))

import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { Icon } from './Icon'
import { useEscape } from './useEscape'
import { useLanes, activeLane } from '@/stores/lanes'
import { useGlue } from '@/stores/glue'
import { useApp } from '@/stores/app'
import { useJob } from '@/stores/job'
import { useTerminal } from '@/stores/terminal'
import { useAuthoring } from '@/authoring/store'

export type Command = { id: string; label: string; hint?: string; icon?: string; keys?: string; run: () => void }
type Store = { open: boolean; toggle: (v?: boolean) => void }
export const usePalette = create<Store>((set, get) => ({ open: false, toggle: (v) => set({ open: v ?? !get().open }) }))

/** ⌘K. The menu has advertised this since the first build and nothing handled it. */
export function Palette() {
  const { open, toggle } = usePalette() // ⌘K arrives from the app menu (main/menu.ts), so no key listener here
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const box = useRef<HTMLInputElement>(null)
  useEscape(open, () => toggle(false))
  const lanes = useLanes()
  const jobs = useGlue((s) => s.jobs)
  const local = useGlue((s) => s.local)
  const app = useApp()
  const lane = activeLane(lanes)
  const commands = useMemo<Command[]>(() => {
    const c: Command[] = []
    if (lane) {
      const job = lane.id
      c.push({ id: 'run', label: `Run ${job}`, icon: 'play', keys: '⌘R', run: () => void useJob.getState().start(job) })
      c.push({ id: 'tests', label: `Run tests for ${job}`, icon: 'tests', run: () => useAuthoring.getState().runTests(job) })
      c.push({ id: 'generate', label: `Generate code for ${job}`, icon: 'refresh', run: () => void useAuthoring.getState().generate(job) })
      c.push({ id: 'deploy', label: `Deploy ${job}`, icon: 'deploy', keys: '⇧⌘D', run: () => void useAuthoring.getState().deploy(job) })
      for (const [t, label] of [['authoring', 'Visual'], ['script', 'Script'], ['details', 'Job details'], ['console', 'Runs'], ['dq', 'Data quality'], ['schedules', 'Schedules'], ['upgrade', 'Upgrade']] as const)
        c.push({ id: 'tab-' + t, label: `Go to ${label}`, icon: 'chevron', run: () => lanes.setTab(job, t) })
      c.push({ id: 'close', label: `Close ${job}`, icon: 'x', keys: '⌘W', run: () => lanes.close(job) })
    }
    c.push({ id: 'home', label: 'Jobs page', icon: 'home', keys: '⌘⇧H', run: () => lanes.select('home') })
    c.push({ id: 'settings', label: 'Settings', icon: 'gear', keys: '⌘,', run: () => app.toggle('showSettings', true) })
    c.push({ id: 'terminal', label: 'Terminal', icon: 'terminal', keys: '⌘⌥T', run: () => useTerminal.getState().toggle() })
    c.push({ id: 'project', label: 'Open another project…', icon: 'folder', keys: '⌘O', run: () => void window.keel.pickProject().then((d) => { if (d) void window.keel.openProject(d) }) })
    for (const j of jobs.slice(0, 40)) c.push({ id: 'open-' + j.name, label: j.name, hint: 'open job', icon: 'runs', run: () => lanes.openJob(j.name) })
    for (const l of local) if (!jobs.some((j) => j.name === l.name)) c.push({ id: 'open-local-' + l.name, label: l.name, hint: 'local draft', icon: 'runs', run: () => lanes.openJob(l.name) })
    return c
  }, [lane, lanes, jobs, local, app])
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return commands.slice(0, 12)
    return commands.filter((c) => c.label.toLowerCase().includes(n) || (c.hint ?? '').includes(n)).slice(0, 12)
  }, [q, commands])
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => box.current?.focus(), 10) } }, [open])
  if (!open) return null
  const go = (c?: Command) => { if (!c) return; toggle(false); c.run() }
  return (
    <div className="sheet-backdrop" style={{ alignItems: 'flex-start', paddingTop: '14vh' }} onClick={() => toggle(false)}>
      <div className="palette-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
          <Icon name="search" size={15} style={{ color: 'var(--faint)' }} />
          <input ref={box} className="fill" style={{ border: 'none', background: 'transparent', fontSize: 15 }} placeholder="Jobs and commands" value={q}
            onChange={(e) => { setQ(e.target.value); setI(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') toggle(false)
              else if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); go(hits[i]) }
            }} />
        </div>
        <div style={{ maxHeight: 380, overflow: 'auto', padding: 4 }}>
          {hits.length === 0 && <div className="faint small" style={{ padding: 12 }}>Nothing matches.</div>}
          {hits.map((c, n) => (
            <div key={c.id} className={'palette-row' + (n === i ? ' on' : '')} onMouseEnter={() => setI(n)} onClick={() => go(c)}>
              <Icon name={c.icon ?? 'chevron'} size={14} style={{ color: 'var(--dim)' }} />
              <span className="fill">{c.label}</span>
              {c.hint && <span className="faint small">{c.hint}</span>}
              {c.keys && <span className="faint mono" style={{ fontSize: 11 }}>{c.keys}</span>}
            </div>))}
        </div>
      </div>
    </div>
  )
}

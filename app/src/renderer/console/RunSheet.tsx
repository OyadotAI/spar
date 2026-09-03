import { useState } from 'react'
import { Sheet } from '@/shell/Sheet'

/** Arguments for a run: `--key value` pairs, prefilled from the run being retried. */
export function RunSheet({ initial, onRun, onClose }: { initial: Record<string, string>; onRun: (args: Record<string, string>) => void; onClose: () => void }) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() => [...Object.entries(initial).map(([k, v]) => ({ k, v })), { k: '', v: '' }])
  const update = (i: number, k: string, v: string) => { const next = rows.slice(); next[i] = { k, v }; if (i === rows.length - 1 && (k || v)) next.push({ k: '', v: '' }); setRows(next) }
  const args = Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]))
  const typed = rows.some((r) => r.k.trim() || r.v.trim())
  return (
    <Sheet label="Run with arguments" onClose={onClose} dirty={typed}>
      <h2>Run with arguments</h2>
      <p className="dim" style={{ marginTop: 0 }}>Keys as Glue expects them, e.g. <code>--input_path</code>. Empty = the job&apos;s defaults.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 6, maxHeight: 300, overflow: 'auto' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <input className="mono" placeholder="--key" aria-label={`Argument name ${i + 1}`} value={r.k} onChange={(e) => update(i, e.target.value, r.v)} />
            <input className="mono" placeholder="value" aria-label={`Argument value ${i + 1}`} value={r.v} onChange={(e) => update(i, r.k, e.target.value)} />
          </div>))}
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => onRun(args)}>Run</button>
      </div>
    </Sheet>
  )
}

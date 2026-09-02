import { useState } from 'react'

/** Arguments for a run: `--key value` pairs, prefilled from the run being retried. */
export function RunSheet({ initial, onRun, onClose }: { initial: Record<string, string>; onRun: (args: Record<string, string>) => void; onClose: () => void }) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() => [...Object.entries(initial).map(([k, v]) => ({ k, v })), { k: '', v: '' }])
  const update = (i: number, k: string, v: string) => { const next = rows.slice(); next[i] = { k, v }; if (i === rows.length - 1 && (k || v)) next.push({ k: '', v: '' }); setRows(next) }
  const args = Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]))
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>Run with arguments</h2>
        <p className="dim" style={{ margin: '0 0 12px' }}>Keys as Glue expects them, e.g. <code>--input_path</code>. Empty = the job's defaults.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 6, maxHeight: 300, overflow: 'auto' }}>
          {rows.map((r, i) => <><input key={'k' + i} className="mono" placeholder="--key" value={r.k} onChange={(e) => update(i, e.target.value, r.v)} />
            <input key={'v' + i} className="mono" placeholder="value" value={r.v} onChange={(e) => update(i, r.k, e.target.value)} /></>)}
        </div>
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onRun(args)}>Run</button></div>
      </div>
    </div>
  )
}

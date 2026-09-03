import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { Icon } from '@/shell/Icon'
import { cmTheme } from '@/authoring/CodePane'
import { parseSparkOutput } from './sparkTable'
import { SNIPPETS } from './snippets'
import type { StatementResult } from '@/wire/types'

export type Cell = { key: string; code: string; n?: number; state: 'queued' | 'running' | 'ok' | 'error' | 'cancelled'; ms?: number; result?: StatementResult; error?: string }

/** Glue's statement states, as cells. */
export function toCell(s: StatementResult): Cell {
  const t0 = Number(s.startedOn ?? 0), t1 = Number(s.completedOn ?? 0)
  const bad = s.state === 'ERROR' || s.output?.status === 'error'
  return {
    key: `s${s.id}`, n: s.id, code: s.code ?? '',
    state: s.state === 'CANCELLED' ? 'cancelled' : bad ? 'error' : s.state === 'AVAILABLE' ? 'ok' : 'running',
    ms: t0 && t1 ? t1 - t0 : undefined,
    result: s,
  }
}

const took = (ms?: number) => (ms == null ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

/** One statement: what was run, what came back, and what you can do about it. */
function CellView({ cell, onRerun, onEdit, onCancel }: { cell: Cell; onRerun: () => void; onEdit: () => void; onCancel: () => void }) {
  const [showTrace, setShowTrace] = useState(false)
  const out = cell.result?.output
  const blocks = useMemo(() => (out?.text ? parseSparkOutput(out.text) : []), [out?.text])
  const running = cell.state === 'running' || cell.state === 'queued'
  return (
    <div className={'cell ' + cell.state}>
      <div className="cell-head">
        <span className="cell-n fig">{cell.n != null ? `[${cell.n}]` : '[ ]'}</span>
        {running && <span className="row dim micro" style={{ gap: 5 }}><span className="dot live" style={{ color: 'var(--accent)' }} />{cell.state === 'queued' ? 'queued' : 'running'}</span>}
        {cell.state === 'error' && <span className="pill err">error</span>}
        {cell.state === 'cancelled' && <span className="pill">cancelled</span>}
        {cell.ms != null && <span className="faint fig micro">{took(cell.ms)}</span>}
        <span className="fill" />
        {running
          ? <button className="quiet danger" onClick={onCancel}><Icon name="stop" size={12} />Cancel</button>
          : <>
              <button className="quiet" aria-label="Copy this code" title="Copy" onClick={() => void navigator.clipboard.writeText(cell.code)}><Icon name="copy" size={12} /></button>
              <button className="quiet" title="Put this code back in the composer" onClick={onEdit}><Icon name="edit" size={12} />Edit</button>
              <button className="quiet" title="Run it again" onClick={onRerun}><Icon name="retry" size={12} />Re-run</button>
            </>}
      </div>
      <pre className="cell-code mono">{cell.code}</pre>
      {cell.error && <pre className="err" style={{ margin: 0, borderRadius: 0 }}>{cell.error}</pre>}
      {out?.errorValue && (
        <div className="cell-error">
          <div className="mono"><b>{out.errorName}</b>: {out.errorValue}</div>
          {out.traceback?.length ? (
            <>
              <button className="quiet micro" onClick={() => setShowTrace(!showTrace)}>
                <Icon name="chevron" size={11} style={{ transform: showTrace ? 'rotate(90deg)' : undefined }} />
                {showTrace ? 'Hide' : 'Show'} traceback
              </button>
              {showTrace && <pre className="mono cell-trace">{out.traceback.join('')}</pre>}
            </>) : null}
        </div>)}
      {blocks.map((b, i) => (b.kind === 'table'
        ? (
          <div key={i} className="cell-table">
            <table className="preview">
              <thead><tr>{b.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((v, k) => <td key={k}>{v}</td>)}</tr>)}</tbody>
            </table>
            {b.rows.length === 0 && <div className="faint small" style={{ padding: 'var(--s2) var(--s3)' }}>No rows.</div>}
          </div>)
        : <pre key={i} className="cell-out mono">{b.text}</pre>))}
    </div>
  )
}

export function Notebook({ cells, ready, busy, onRun, onCancel, hint, lost }: {
  cells: Cell[]; ready: boolean; busy: boolean; hint?: string
  /** set when Glue will not serve the history — a stopped session's statements are unrecoverable */
  lost?: string
  onRun: (code: string) => void; onCancel: (cell: Cell) => void
}) {
  const [code, setCode] = useState('')
  const [snips, setSnips] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [cells.length])
  const run = (c = code) => { if (c.trim() && ready && !busy) { onRun(c); setCode('') } }
  // ⌘↵ inside the editor; CodeMirror owns the keys, so the binding has to outrank its own map
  const submit = useMemo(() => Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { run(); return true } }])), [code, ready, busy]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col fill" style={{ minHeight: 0 }}>
      <div ref={scroller} className="fill notebook">
        {cells.length === 0 && lost && (
          <div className="notebook-intro">
            <h3>This session's history is gone</h3>
            <p className="dim">{lost} This one has ended, so whatever it ran cannot be read back —
              not by Keel and not by the AWS console. Start a new session to run something.</p>
          </div>)}
        {cells.length === 0 && !lost && (
          <div className="notebook-intro">
            <h3>Nothing has run in this session yet</h3>
            <p className="dim">
              Statements share one Spark context, so a variable you set in one is there in the next —
              like notebook cells. <code>spark</code> and <code>sc</code> are already bound.
            </p>
            <div className="snip-grid">
              {SNIPPETS.map((s) => (
                <button key={s.label} className="snip" onClick={() => setCode(s.code)} disabled={!ready}>
                  <b>{s.label}</b><span className="dim micro">{s.hint}</span>
                </button>))}
            </div>
          </div>)}
        {cells.map((c) => (
          <CellView key={c.key} cell={c} onCancel={() => onCancel(c)} onEdit={() => setCode(c.code)} onRerun={() => run(c.code)} />))}
      </div>
      <div className="composer-bar">
        <div className="row" style={{ padding: '6px 10px 0' }}>
          <span className="eyebrow">Statement</span>
          <button className="quiet micro" aria-expanded={snips} onClick={() => setSnips(!snips)}>
            <Icon name="magic" size={12} />Snippets
          </button>
          <span className="fill" />
          <span className="faint micro">{hint}</span>
        </div>
        {snips && (
          <div className="snip-row">
            {SNIPPETS.map((s) => (
              <button key={s.label} className="quiet micro" title={s.hint} onClick={() => { setCode(s.code); setSnips(false) }}>{s.label}</button>))}
          </div>)}
        <CodeMirror value={code} height="128px" extensions={[python(), submit]} theme={cmTheme()} onChange={setCode}
          placeholder="spark.sql(&quot;SHOW DATABASES&quot;).show()" basicSetup={{ lineNumbers: false, foldGutter: false }} />
        <div className="row" style={{ padding: '6px 10px 10px' }}>
          <span className="faint micro">{ready ? 'Runs in the session you have open. ⌘↵' : 'The session must be READY before a statement runs.'}</span>
          <span className="fill" />
          <button className="primary" disabled={!ready || busy || !code.trim()} onClick={() => run()}>
            <Icon name={busy ? 'spinner' : 'play'} className={busy ? 'spin' : ''} />{busy ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  )
}

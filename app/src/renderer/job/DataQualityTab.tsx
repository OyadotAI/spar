import { useEffect, useState } from 'react'
import { api, type Fault } from '@/api/client'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { Icon } from '@/shell/Icon'
import { when } from '@/shell/format'

type Rule = { name: string; description?: string; result: string; evaluationMessage?: string; evaluatedMetrics?: Record<string, number> }
type Result = { resultId: string; runId?: string; startedOn?: string; score?: number; evaluationContext?: string; rulesetName?: string; rules: Rule[]; analyzers: { name: string; description: string; evaluatedMetrics: Record<string, number> }[] }

/** Glue Studio's Data quality tab: what Evaluate Data Quality nodes published for this job's runs. */
export function DataQualityTab({ job }: { job: string }) {
  const [list, setList] = useState<Result[] | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const load = async () => { const r = await api.get<Result[]>(`/api/glue/jobs/${encodeURIComponent(job)}/dq`, 'data quality results'); if (r.ok) { setList(r.value); setFault(null); if (!sel && r.value[0]) setSel(r.value[0].resultId) } else setFault(r.fault) }
  useEffect(() => { void load() }, [job]) // eslint-disable-line react-hooks/exhaustive-deps
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading data quality results…" />
  if (list.length === 0) return <EmptyState title="No data quality results yet">Add an <b>Evaluate Data Quality</b> node on the Visual tab with a DQDL ruleset; each run then publishes a score and per-rule outcomes here.</EmptyState>
  const cur = list.find((r) => r.resultId === sel) ?? list[0]!
  const tone = (s: number | undefined) => (s == null ? undefined : s >= 0.99 ? 'var(--add)' : s >= 0.8 ? 'var(--warn)' : 'var(--del)')
  return (
    <div className="row" style={{ height: '100%', gap: 0, alignItems: 'stretch' }}>
      <div className="panel" style={{ width: 300, flex: 'none' }}>
        <div className="panel-head"><span className="eyebrow">Results</span><span className="fill" /><button className="quiet" onClick={() => void load()}><Icon name="refresh" size={12} /></button></div>
        <div className="fill" style={{ overflow: 'auto' }}>
          {list.map((r) => (
            <div key={r.resultId} className={'panel-row' + (r.resultId === cur.resultId ? ' on' : '')} style={{ height: 'auto', padding: '6px 12px', alignItems: 'flex-start' }} onClick={() => setSel(r.resultId)}>
              <span className="fig" style={{ color: tone(r.score), fontWeight: 600, width: 44 }}>{r.score == null ? '—' : `${Math.round(r.score * 100)}%`}</span>
              <div className="col fill" style={{ gap: 2 }}><span className="mono small">{r.runId ? r.runId.slice(3, 15) + '…' : r.evaluationContext ?? r.resultId.slice(0, 12)}</span><span className="faint fig" style={{ fontSize: 10 }}>{when(r.startedOn)}</span></div>
            </div>))}
        </div>
      </div>
      <div className="fill details" style={{ overflow: 'auto' }}>
        <div className="facts" style={{ padding: 0, marginBottom: 12 }}>
          <div className="fact"><span className="eyebrow">Score</span><span className="v" style={{ color: tone(cur.score), fontSize: 20 }}>{cur.score == null ? '—' : `${Math.round(cur.score * 100)}%`}</span></div>
          <div className="fact"><span className="eyebrow">Rules</span><span className="v">{cur.rules.filter((r) => r.result === 'PASS').length} / {cur.rules.length} passed</span></div>
          {cur.evaluationContext && <div className="fact"><span className="eyebrow">Context</span><span className="v">{cur.evaluationContext}</span></div>}
          {cur.runId && <div className="fact"><span className="eyebrow">Run</span><span className="v">{cur.runId.slice(3, 19)}…</span></div>}
        </div>
        <h2>Rules</h2>
        {cur.rules.map((r) => (
          <div key={r.name} className="card row" style={{ padding: '8px 12px', marginBottom: 6, alignItems: 'flex-start' }}>
            <Icon name={r.result === 'PASS' ? 'ok' : r.result === 'FAIL' ? 'bad' : 'info'} style={{ color: r.result === 'PASS' ? 'var(--add)' : r.result === 'FAIL' ? 'var(--del)' : 'var(--dim)', marginTop: 2 }} />
            <div className="fill"><div className="mono small">{r.description ?? r.name}</div>{r.evaluationMessage && <div className="dim small">{r.evaluationMessage}</div>}
              {r.evaluatedMetrics && Object.keys(r.evaluatedMetrics).length > 0 && <div className="faint fig" style={{ fontSize: 11, marginTop: 2 }}>{Object.entries(r.evaluatedMetrics).map(([k, v]) => `${k.split('.').pop()} = ${v}`).join(' · ')}</div>}</div>
            <span className={'pill ' + (r.result === 'PASS' ? 'ok' : r.result === 'FAIL' ? 'err' : '')}>{r.result.toLowerCase()}</span>
          </div>))}
        {cur.analyzers.length > 0 && <><h2>Statistics</h2>{cur.analyzers.map((a) => <div key={a.name} className="card" style={{ padding: '8px 12px', marginBottom: 6 }}><div className="mono small">{a.description || a.name}</div><div className="faint fig" style={{ fontSize: 11 }}>{Object.entries(a.evaluatedMetrics).map(([k, v]) => `${k.split('.').pop()} = ${v}`).join(' · ')}</div></div>)}</>}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { useAuthoring } from './store'
import { SplitPane } from '@/shell/SplitPane'
import { Icon } from '@/shell/Icon'

export function TestsPane({ job, node }: { job: string; node?: string }) {
  const a = useAuthoring((s) => s.jobs[job])
  const { runTests, stopTests } = useAuthoring()
  const file = useMemo(() => {
    const tests = a?.tests ?? []
    if (node) { const f = tests.find((t) => t.path === `tests/test_${node}.py`); if (f) return f }
    return tests.find((t) => t.path === 'tests/test_pipeline.py') ?? tests[0]
  }, [a?.tests, node])
  const ext = useMemo(() => [python()], [])
  const cases = (a?.result?.cases ?? []).filter((c) => !node || c.node === node || c.node === 'pipeline')
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row" style={{ padding: '0 12px', height: 32, borderBottom: '1px solid var(--line)', fontSize: 'var(--small)', background: 'var(--surface)' }}>
        <span className="mono dim">{file?.path ?? 'no tests yet — generate first'}</span>
        <span className="fill" />
        {a?.result && <span className={'pill ' + (a.result.status === 'passed' ? 'ok' : a.result.status === 'failed' ? 'err' : 'warn')}>{a.result.passed}✓ {a.result.failed + a.result.errors}✗ {a.result.skipped}↷</span>}
        {a?.running ? <button className="danger" onClick={() => void stopTests(job)}><Icon name="stop" />Stop</button> : <button className="primary" disabled={!a?.tests.length} onClick={() => runTests(job)}><Icon name="play" />Run tests</button>}
      </div>
      <div className="fill" style={{ minHeight: 0 }}>
        <SplitPane storageKey="tests.split" initial={0.45} min={240} minB={240}
          a={file ? <CodeMirror value={file.content} height="100%" style={{ height: '100%' }} extensions={ext} theme={cmTheme()} readOnly basicSetup={{ lineNumbers: true }} /> : <div className="faint" style={{ padding: 12 }}>Tests appear here once the DAG is generated. Run them in AWS's Glue 5 image (Docker).</div>}
          b={<div className="col" style={{ height: '100%' }}>
            {cases.length > 0 && <div style={{ maxHeight: '45%', overflow: 'auto', borderBottom: '1px solid var(--line)', fontSize: 'var(--small)' }}>
              {cases.map((c) => <div key={c.name} className="row" style={{ padding: '2px 8px', alignItems: 'flex-start' }}>
                <span style={{ color: c.status === 'pass' ? 'var(--add)' : c.status === 'skip' ? 'var(--warn)' : 'var(--del)', width: 14 }}>{c.status === 'pass' ? '✓' : c.status === 'skip' ? '↷' : '✗'}</span>
                <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                {c.message && <span className="faint" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} title={c.message}>{c.message.split('\n')[0]}</span>}
              </div>)}
            </div>}
            {a?.result?.message && <div className="dim" style={{ padding: '4px 8px', fontSize: 'var(--small)', whiteSpace: 'pre-wrap' }}>{a.result.message}</div>}
            <pre className="fill mono" style={{ margin: 0, padding: 8, overflow: 'auto', background: 'var(--well)', fontSize: 'var(--small)', whiteSpace: 'pre-wrap' }}>
              {(a?.output ?? []).join('\n') || (a?.running ? 'starting the Glue container…' : 'pytest output appears here')}
            </pre>
          </div>} />
      </div>
    </div>
  )
}

/** CodeMirror's theme follows the OS, like the rest of the window. */
export function cmTheme(): 'dark' | 'light' { return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }

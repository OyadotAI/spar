import { useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { useToast } from '@/shell/Toast'

type What = 'metrics' | 'insights' | 'sparkui'

const LABEL: Record<What, string> = {
  metrics: 'Turn on job metrics',
  insights: 'Turn on job insights',
  sparkui: 'Turn on the Spark UI',
}

/**
 * The fix for an empty Metrics, Insights or Spark UI pane, in the pane itself.
 *
 * All three are empty for the same reason — a flag that is off — and the honest answer is not a
 * sentence telling somebody to open another tab and find it. What a click cannot do is change the
 * run already on screen, so the button says what it changes and what it does not.
 */
export function EnableFlag({ job, what, onDone }: { job: string; what: What; onDone?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    const r = await api.post<{ changed: string[]; note: string }>(
      `/api/glue/jobs/${encodeURIComponent(job)}/observability?what=${what}`, {}, 'the job setting', 60_000)
    setBusy(false)
    if (!r.ok) { useToast.getState().fail(LABEL[what].toLowerCase(), r.fault); return }
    setNote(r.value.note)
    useToast.getState().done(`${job}: ${r.value.changed.length ? r.value.changed.join(', ') : 'already on'}`, r.value.note)
    onDone?.()
  }
  return (
    <div className="col" style={{ gap: 6, padding: '10px 14px' }}>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => void go()}>
          <Icon name={busy ? 'spinner' : 'wrench'} className={busy ? 'spin' : ''} />{busy ? 'Setting…' : LABEL[what]}
        </button>
        <span className="faint small">changes the job, not this run</span>
      </div>
      {note && <div className="dim small" style={{ maxWidth: 68 * 8 }}>{note}</div>}
    </div>
  )
}

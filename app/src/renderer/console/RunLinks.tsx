import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'

/** The links a run has in Glue Studio: the console page, CloudWatch output/error/all logs, metrics. */
export function RunLinks({ job, runId }: { job: string; runId: string }) {
  const [links, setLinks] = useState<Record<string, string> | null>(null)
  useEffect(() => { setLinks(null); void api.get<Record<string, string>>(`/api/glue/jobs/${encodeURIComponent(job)}/runs/${encodeURIComponent(runId)}/links`, 'run links').then((r) => { if (r.ok) setLinks(r.value) }) }, [job, runId])
  if (!links) return null
  const L = ({ k, label }: { k: string; label: string }) => links[k] ? <button className="quiet" onClick={() => void window.keel.openExternal(links[k]!)}><Icon name="external" size={12} />{label}</button> : null
  return <span className="row" style={{ gap: 2 }}><L k="console" label="Console" /><L k="output" label="Output logs" /><L k="error" label="Error logs" /><L k="allLogs" label="All logs" /><L k="metrics" label="Metrics" /></span>
}

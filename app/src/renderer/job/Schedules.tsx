import { useEffect, useState } from 'react'
import { api, type Fault } from '@/api/client'
import { onEvent } from '@/events'
import { Icon } from '@/shell/Icon'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import type { Schedule } from '@/wire/types'

const PRESETS: [string, string][] = [['Hourly', '0 * * * ? *'], ['Daily at 00:00 UTC', '0 0 * * ? *'], ['Daily at 06:00 UTC', '0 6 * * ? *'], ['Weekdays at 08:00 UTC', '0 8 ? * MON-FRI *'], ['Weekly, Monday 00:00 UTC', '0 0 ? * MON *'], ['Monthly, the 1st', '0 0 1 * ? *'], ['Custom', '']]

/** Glue Studio's Schedules tab: SCHEDULED triggers that start this job, with cron in UTC. */
export function Schedules({ job }: { job: string }) {
  const [list, setList] = useState<Schedule[] | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const [adding, setAdding] = useState(false)
  const [preset, setPreset] = useState(1)
  const [cron, setCron] = useState(PRESETS[1]![1])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [editCron, setEditCron] = useState('')
  const save = async () => { if (!editing) return; const r = await api.put(`/api/glue/schedules/${encodeURIComponent(editing.name)}`, { cron: editCron }, 'updating the schedule'); if (!r.ok) { setErr(r.fault.why); return } setEditing(null); void load() }
  const load = async () => { const r = await api.get<Schedule[]>(`/api/glue/jobs/${encodeURIComponent(job)}/schedules`, 'the schedules'); if (r.ok) { setList(r.value); setFault(null) } else setFault(r.fault) }
  useEffect(() => { void load(); return onEvent((k, d) => { if (k === 'job.changed' && (d as { name?: string })?.name === job) void load() }) }, [job]) // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    setErr(null)
    const r = await api.post<Schedule>(`/api/glue/jobs/${encodeURIComponent(job)}/schedules`, { name: name || undefined, cron, description: desc || undefined, start: true }, 'the schedule')
    if (!r.ok) { setErr(r.fault.why); return }
    setAdding(false); setName(''); setDesc(''); void load()
  }
  const act = async (s: Schedule, what: 'start' | 'stop' | 'delete') => {
    if (what === 'delete') { if (!window.confirm(`Delete the schedule "${s.name}"?`)) return; await api.del(`/api/glue/schedules/${encodeURIComponent(s.name)}`, 'deleting the schedule') }
    else await api.post(`/api/glue/schedules/${encodeURIComponent(s.name)}/${what}`, {}, `${what} schedule`)
    void load()
  }
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading schedules…" />
  return (
    <div className="details" style={{ overflow: 'auto', height: '100%' }}>
      <div className="row" style={{ marginBottom: 12 }}><h2 style={{ margin: 0 }}>Schedules</h2><span className="fill" /><button className="primary" onClick={() => setAdding(true)}><Icon name="plus" />Create schedule</button></div>
      {list.length === 0 && !adding && <p className="dim">No schedule starts this job. Runs are manual, or come from a workflow or event trigger.</p>}
      {list.map((s) => (
        <div key={s.name} className="card row" style={{ padding: '10px 14px', marginBottom: 8 }}>
          <Icon name="schedule" style={{ color: 'var(--dim)' }} />
          <div className="fill">
            <div className="row"><b>{s.name}</b><span className={'pill ' + (s.state === 'ACTIVATED' ? 'ok' : '')}>{s.state.toLowerCase()}</span></div>
            <div className="dim small mono">{s.schedule}{s.description ? ` · ${s.description}` : ''}{Object.keys(s.arguments).length ? ` · ${Object.keys(s.arguments).length} arguments` : ''}</div>
          </div>
          <button className="quiet" onClick={() => { setEditing(s); setEditCron(s.schedule.replace(/^cron\((.*)\)$/, '$1')) }}><Icon name="edit" />Edit</button>
          {s.state === 'ACTIVATED' ? <button onClick={() => void act(s, 'stop')}>Pause</button> : <button onClick={() => void act(s, 'start')}>Resume</button>}
          <button className="quiet danger" onClick={() => void act(s, 'delete')}><Icon name="trash" /></button>
        </div>))}
      {editing && (
        <div className="card" style={{ padding: 16, marginTop: 8 }}>
          <h3 style={{ marginBottom: 8 }}>Edit {editing.name}</h3>
          <label className="col" style={{ gap: 4, fontSize: 12, color: 'var(--dim)' }}>Cron expression (UTC)<input className="mono" value={editCron} onChange={(e) => setEditCron(e.target.value)} /></label>
          {err && <div className="small" style={{ color: 'var(--del)', margin: '8px 0' }}>{err}</div>}
          <div className="row" style={{ marginTop: 10 }}><span className="fill" /><button onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={() => void save()}>Update schedule</button></div>
        </div>)}
      {adding && (
        <div className="card" style={{ padding: 16, marginTop: 8 }}>
          <div className="grid">
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${job}-schedule`} /></label>
            <label>Frequency<select value={preset} onChange={(e) => { const i = Number(e.target.value); setPreset(i); if (PRESETS[i]![1]) setCron(PRESETS[i]![1]) }}>{PRESETS.map((p, i) => <option key={p[0]} value={i}>{p[0]}</option>)}</select></label>
            <label style={{ gridColumn: '1 / -1' }}>Cron expression (UTC) <span className="faint">minutes hours day-of-month month day-of-week year</span><input className="mono" value={cron} onChange={(e) => { setCron(e.target.value); setPreset(PRESETS.length - 1) }} /></label>
            <label style={{ gridColumn: '1 / -1' }}>Description<input value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          </div>
          {err && <div className="small" style={{ color: 'var(--del)', marginBottom: 8 }}>{err}</div>}
          <div className="row"><span className="fill" /><button onClick={() => setAdding(false)}>Cancel</button><button className="primary" onClick={() => void create()}>Create and activate</button></div>
        </div>)}
      <p className="faint small" style={{ marginTop: 16 }}>Glue cron: six fields, UTC. <code>0 12 * * ? *</code> is every day at noon; <code>?</code> stands in for day-of-month or day-of-week.</p>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/stores/glue'
import { api, type Fault } from '@/api/client'
import { onEvent } from '@/events'
import { Icon } from '@/shell/Icon'
import { Seg } from '@/shell/Seg'
import { Sheet } from '@/shell/Sheet'
import { confirm } from '@/shell/Confirm'
import { tell } from '@/shell/Toast'
import { EmptyState, FaultState } from '@/shell/EmptyState'
import { useSurfaceReason } from '@/shell/useSurfaceReason'
import { build, describe, DEFAULT_SPEC, nextRuns, toSpec, unwrap, WEEKDAYS, type Every, type Spec } from './cron'
import type { Schedule } from '@/wire/types'

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const utc = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const local = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const offset = new Date().getTimezoneOffset() !== 0

/**
 * The schedules that start this job.
 *
 * Glue speaks EventBridge cron, and a page that answers "when does this run" with
 * `0 8 ? * MON-FRI *` has not answered. Every schedule here says it in English, gives the next
 * three firing times in UTC and in your own zone, and is built with a frequency picker rather than
 * typed — with the raw expression still on show, because that is what actually gets deployed.
 */
export function Schedules({ job }: { job: string }) {
  const account = useAccount()
  const [list, setList] = useState<Schedule[] | null>(null)
  const [fault, setFault] = useState<Fault | null>(null)
  const [editor, setEditor] = useState<null | { of?: Schedule }>(null)

  const load = async () => {
    const r = await api.get<Schedule[]>(`/api/glue/jobs/${encodeURIComponent(job)}/schedules`, 'the schedules')
    if (r.ok) { setList(r.value); setFault(null) } else setFault(r.fault)
  }
  useEffect(() => { void load(); return onEvent((k, d) => { if (k === 'job.changed' && (d as { name?: string })?.name === job) void load() }) }, [job, account]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (s: Schedule, what: 'start' | 'stop' | 'delete') => {
    if (what === 'delete') {
      if (!await confirm({ title: `Delete the schedule "${s.name}"?`, danger: true, confirmLabel: 'Delete',
        body: 'Deleting it stops this job running on that cron. The job itself, and its run history, stay.' })) return
      await tell('delete the schedule', api.del(`/api/glue/schedules/${encodeURIComponent(s.name)}`, 'deleting the schedule'), 'Schedule deleted')
    } else {
      await tell(`${what} the schedule`, api.post(`/api/glue/schedules/${encodeURIComponent(s.name)}/${what}`, {}, `${what} schedule`),
        what === 'start' ? 'Schedule resumed' : 'Schedule paused')
    }
    void load()
  }

  const reason = useSurfaceReason('schedules')
  if (reason) return reason
  if (fault) return <FaultState fault={fault} retry={() => void load()} />
  if (!list) return <EmptyState title="Reading schedules…" />

  const active = list.filter((s) => s.state === 'ACTIVATED').length
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="page-head" style={{ padding: 'var(--s5) var(--s5) var(--s3)' }}>
        <div>
          <h1>Schedules</h1>
          <div className="sub">
            {list.length === 0 ? 'Nothing starts this job on a clock' : `${list.length} schedule${list.length > 1 ? 's' : ''}, ${active} active`}
            {offset && <> · times shown in UTC and <span className="fig">{TZ}</span></>}
          </div>
        </div>
        <span className="fill" />
        <button className="primary" onClick={() => setEditor({})}><Icon name="plus" />New schedule</button>
      </div>

      <div className="fill" style={{ overflow: 'auto', padding: '0 var(--s5) var(--s5)' }}>
        {list.length === 0
          ? (
            <EmptyState title="No schedule starts this job"
              actions={<button className="primary" onClick={() => setEditor({})}><Icon name="plus" />New schedule</button>}>
              Runs are manual for now, or come from a workflow or an event trigger. A schedule is an
              EventBridge rule in your account — it starts the deployed job, not the local one.
            </EmptyState>)
          : list.map((s) => <Row key={s.name} s={s} onEdit={() => setEditor({ of: s })} onAct={(w) => void act(s, w)} />)}
      </div>

      {editor && <Editor job={job} of={editor.of} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load() }} />}
    </div>
  )
}

function Row({ s, onEdit, onAct }: { s: Schedule; onEdit: () => void; onAct: (w: 'start' | 'stop' | 'delete') => void }) {
  const expr = unwrap(s.schedule)
  const on = s.state === 'ACTIVATED'
  const runs = useMemo(() => (on ? nextRuns(expr, new Date(), 3) : []), [expr, on])
  const args = Object.keys(s.arguments ?? {}).length
  return (
    <div className="sched">
      <div className="sched-main">
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <b className="sched-name">{s.name}</b>
          <span className={'pill ' + (on ? 'ok' : '')}>{on ? 'active' : 'paused'}</span>
          {args > 0 && <span className="pill" title={Object.keys(s.arguments).join('\n')}>{args} argument{args > 1 ? 's' : ''}</span>}
        </div>
        <div className="sched-when">{describe(expr)}</div>
        {s.description && <div className="dim small">{s.description}</div>}
        <code className="faint micro">{expr}</code>
      </div>
      <div className="sched-next">
        <span className="eyebrow">{on ? 'Next runs' : 'Paused'}</span>
        {on
          ? (runs.length
            ? runs.map((t, i) => (
              <div key={i} className={'sched-run' + (i === 0 ? ' first' : '')}>
                <span className="fig">{utc(t)} UTC</span>
                {offset && <span className="faint fig">{local(t)}</span>}
              </div>))
            : <span className="faint small">This expression never fires.</span>)
          : <span className="faint small">It will not run until you resume it.</span>}
      </div>
      <div className="sched-acts">
        <button className="quiet" onClick={onEdit}><Icon name="edit" size={12} />Edit</button>
        <button className="quiet" onClick={() => onAct(on ? 'stop' : 'start')}>
          <Icon name={on ? 'stop' : 'play'} size={12} />{on ? 'Pause' : 'Resume'}
        </button>
        <button className="quiet danger" aria-label={`Delete ${s.name}`} onClick={() => onAct('delete')}><Icon name="trash" size={12} /></button>
      </div>
    </div>
  )
}

const EVERY: readonly (readonly [Every | 'custom', string])[] = [['hour', 'Hourly'], ['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['custom', 'Custom cron']] as const

function Editor({ job, of, onClose, onSaved }: { job: string; of?: Schedule; onClose: () => void; onSaved: () => void }) {
  const existing = of ? unwrap(of.schedule) : null
  const [spec, setSpec] = useState<Spec>(() => (existing ? toSpec(existing) : null) ?? DEFAULT_SPEC)
  // an expression the builder cannot represent stays in the custom box rather than being rewritten
  const [mode, setMode] = useState<Every | 'custom'>(() => (existing ? (toSpec(existing)?.every ?? 'custom') : 'day'))
  const [raw, setRaw] = useState(existing ?? build(DEFAULT_SPEC))
  const [name, setName] = useState(of?.name ?? '')
  const [desc, setDesc] = useState(of?.description ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const expr = mode === 'custom' ? raw : build({ ...spec, every: mode })
  const runs = useMemo(() => nextRuns(expr, new Date(), 3), [expr])
  const set = <K extends keyof Spec>(k: K, v: Spec[K]) => setSpec({ ...spec, [k]: v })

  const save = async () => {
    setBusy(true); setErr(null)
    const r = of
      ? await api.put(`/api/glue/schedules/${encodeURIComponent(of.name)}`, { cron: expr }, 'updating the schedule')
      : await api.post(`/api/glue/jobs/${encodeURIComponent(job)}/schedules`, { name: name || undefined, cron: expr, description: desc || undefined, start: true }, 'the schedule')
    setBusy(false)
    if (!r.ok) { setErr(`${r.fault.why}${r.fault.fix ? ` — ${r.fault.fix}` : ''}`); return }
    onSaved()
  }

  return (
    <Sheet label={of ? `Edit ${of.name}` : 'New schedule'} width={560} onClose={onClose} dirty={!of && !!name}>
      <h2>{of ? `Edit ${of.name}` : 'New schedule'}</h2>
      {!of && (
        <label className="col" style={{ gap: 4, marginTop: 'var(--s3)' }}>
          <span className="eyebrow">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${job}-schedule`} />
          <span className="faint micro">The EventBridge rule's name. Left empty, Keel picks one.</span>
        </label>)}

      <div style={{ marginTop: 'var(--s4)' }}>
        <span className="eyebrow">Runs</span>
        <div style={{ marginTop: 6 }}><Seg label="Frequency" value={mode} onChange={setMode} options={EVERY} /></div>
      </div>

      <div className="sched-builder">
        {mode === 'custom'
          ? (
            <label className="col fill" style={{ gap: 4 }}>
              <span className="faint micro">minute · hour · day-of-month · month · day-of-week · year — UTC, and exactly one of the two day fields is <code>?</code></span>
              <input className="mono" value={raw} onChange={(e) => setRaw(e.target.value)} />
            </label>)
          : (<>
            {mode === 'week' && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {WEEKDAYS.map(([n, l]) => (
                  <button key={n} className={'day-chip' + (spec.days.includes(n) ? ' on' : '')}
                    aria-pressed={spec.days.includes(n)}
                    onClick={() => set('days', spec.days.includes(n) ? spec.days.filter((d) => d !== n) : [...spec.days, n])}>{l}</button>))}
              </div>)}
            {mode === 'month' && (
              <label className="row" style={{ gap: 6 }}>day
                <input type="number" min={1} max={28} style={{ width: 64 }} value={spec.dayOfMonth}
                  onChange={(e) => set('dayOfMonth', Math.min(28, Math.max(1, Number(e.target.value))))} />
                <span className="faint micro">of the month — 29 to 31 skip the months that are shorter</span>
              </label>)}
            <label className="row" style={{ gap: 6 }}>
              {mode === 'hour' ? 'at minute' : 'at'}
              {mode !== 'hour' && (
                <select value={spec.hour} onChange={(e) => set('hour', Number(e.target.value))} style={{ width: 74 }}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
                </select>)}
              {mode !== 'hour' && <span>:</span>}
              <select value={spec.minute} onChange={(e) => set('minute', Number(e.target.value))} style={{ width: 74 }}>
                {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
              </select>
              <span className="faint micro">UTC</span>
            </label>
          </>)}
      </div>

      <div className="sched-preview">
        <div className="row"><Icon name="clock" size={13} /><b>{describe(expr)}</b><span className="fill" /><code className="faint micro">{expr}</code></div>
        {runs.length === 0
          ? <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>This expression never fires — check the day and month fields.</div>
          : <div className="sched-preview-runs">
              {runs.map((t, i) => <div key={i}><span className="fig">{utc(t)} UTC</span>{offset && <span className="faint fig"> · {local(t)}</span>}</div>)}
            </div>}
      </div>

      {!of && (
        <label className="col" style={{ gap: 4, marginTop: 'var(--s3)' }}>
          <span className="eyebrow">Description</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this schedule is for" />
        </label>)}

      {err && <div className="small" role="alert" style={{ color: 'var(--del)', marginTop: 'var(--s2)' }}>{err}</div>}
      <div className="row" style={{ marginTop: 'var(--s4)', justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || runs.length === 0} onClick={() => void save()}>
          {busy ? 'Saving…' : of ? 'Update schedule' : 'Create and activate'}
        </button>
      </div>
    </Sheet>
  )
}

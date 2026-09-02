import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/shell/Icon'
import { useEscape } from '@/shell/useEscape'

type Entry = { name: string; uri: string; dir: boolean; size?: number; modified?: string }

/** Glue Studio's "Browse S3": buckets, then one prefix level at a time. Picks a prefix (for sources) or an object. */
export function S3Browser({ initial, onPick, onClose }: { initial?: string; onPick: (uri: string) => void; onClose: () => void }) {
  const [uri, setUri] = useState(initial && initial.startsWith('s3://') ? initial.replace(/[^/]*$/, '') : 's3://')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setEntries(null); setErr(null)
    void api.get<{ entries: Entry[]; uri: string }>(`/api/s3/ls?uri=${encodeURIComponent(uri)}`, 'S3').then((r) => { if (r.ok) setEntries(r.value.entries); else setErr(r.fault.why) })
  }, [uri])
  useEscape(true, onClose)
  const up = () => { if (uri === 's3://') return; const parts = uri.replace(/\/$/, '').split('/'); parts.pop(); const u = parts.join('/') + '/'; setUri(u === 's3:/' + '/' ? 's3://' : u.replace(/^s3:\/\/$/, 's3://')) }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="quiet" onClick={up} disabled={uri === 's3://'}><Icon name="chevron" style={{ transform: 'rotate(180deg)' }} />Up</button>
          <input className="mono fill" value={uri} onChange={(e) => setUri(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setUri((e.target as HTMLInputElement).value) }} />
          <button className="primary" onClick={() => onPick(uri)} disabled={uri === 's3://'}>Use this prefix</button>
        </div>
        <div style={{ height: 360, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
          {err && <div className="small" style={{ padding: 12, color: 'var(--del)' }}>{err}</div>}
          {!entries && !err && <div className="faint small" style={{ padding: 12 }}>Listing…</div>}
          {entries?.length === 0 && <div className="faint small" style={{ padding: 12 }}>Empty.</div>}
          {entries?.map((e) => (
            <div key={e.uri} className="panel-row" style={{ cursor: 'default' }} onDoubleClick={() => (e.dir ? setUri(e.uri) : onPick(e.uri))} onClick={() => { if (!e.dir) onPick(e.uri) }}>
              <Icon name={e.dir ? 'folder' : 'files'} size={14} style={{ color: e.dir ? 'var(--warn)' : 'var(--dim)' }} />
              <span className="fill mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}{e.dir ? '/' : ''}</span>
              {e.size != null && <span className="faint fig">{e.size > 1e6 ? (e.size / 1e6).toFixed(1) + ' MB' : e.size > 1e3 ? (e.size / 1e3).toFixed(0) + ' KB' : e.size + ' B'}</span>}
              {e.dir && <button className="quiet" onClick={(ev) => { ev.stopPropagation(); setUri(e.uri) }}>Open</button>}
            </div>))}
        </div>
        <div className="row" style={{ marginTop: 10 }}><span className="faint small">Double-click a folder to open it; single-click a file to use it.</span><span className="fill" /><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}

type Db = { name: string }; type Tbl = { name: string; columns: { Name: string; Type: string }[]; location: string }

/** Database and table dropdowns backed by the Data Catalog. */
export function CatalogPicker({ database, table, onChange }: { database: string; table: string; onChange: (db: string, table: string, columns?: { Name: string; Type: string }[]) => void }) {
  const [dbs, setDbs] = useState<Db[] | null>(null)
  const [tables, setTables] = useState<Tbl[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { void api.get<Db[]>('/api/glue/catalog/databases', 'databases').then((r) => { if (r.ok) { setDbs(r.value); setErr(null) } else { setDbs([]); setErr(r.fault.status === 400 ? 'Connect an AWS profile to browse the Data Catalog. You can still type a database and table.' : r.fault.why) } }) }, [])
  useEffect(() => { setTables(null); if (database) void api.get<Tbl[]>(`/api/glue/catalog/tables?database=${encodeURIComponent(database)}`, 'tables').then((r) => { if (r.ok) setTables(r.value); else setTables([]) }) }, [database])
  return (
    <div className="col" style={{ gap: 6 }}>
      <select value={database} onChange={(e) => onChange(e.target.value, '')}>
        <option value="">database…</option>
        {dbs?.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
        {database && !dbs?.some((d) => d.name === database) && <option value={database}>{database}</option>}
      </select>
      <select value={table} onChange={(e) => { const t = tables?.find((x) => x.name === e.target.value); onChange(database, e.target.value, t?.columns) }} disabled={!database}>
        <option value="">table…</option>
        {tables?.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        {table && !tables?.some((t) => t.name === table) && <option value={table}>{table}</option>}
      </select>
      {err && <span className="faint small">{err}</span>}
      {!err && dbs && dbs.length === 0 && <span className="faint small">No databases in this region's Data Catalog.</span>}
      {(err || (dbs && dbs.length === 0)) && (
        <div className="row" style={{ gap: 4 }}>
          <input className="mono" placeholder="database" defaultValue={database} onBlur={(e) => onChange(e.target.value, table)} />
          <input className="mono" placeholder="table" defaultValue={table} onBlur={(e) => onChange(database, e.target.value)} />
        </div>)}
    </div>
  )
}

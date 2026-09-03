/**
 * The only way a pane switches between views. Below the sidebar there is no other tab idiom —
 * `.tabbtn` and its four hand-copied call sites are gone.
 */
export function Seg<T extends string>({ options, value, onChange, label }: {
  options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string
}) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(([id, text], i) => (
        <button key={id} role="tab" aria-selected={id === value} tabIndex={id === value ? 0 : -1}
          className={id === value ? 'on' : ''} onClick={() => onChange(id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const next = options[Math.min(options.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))]
            if (next) onChange(next[0])
          }}>{text}</button>))}
    </div>
  )
}

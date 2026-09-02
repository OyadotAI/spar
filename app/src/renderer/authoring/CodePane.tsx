import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { StateField, StateEffect } from '@codemirror/state'

const setRange = StateEffect.define<[number, number] | null>()
const rangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) if (e.is(setRange)) {
      if (!e.value) return Decoration.none
      const [a, b] = e.value; const marks = []
      for (let l = a; l <= Math.min(b, tr.state.doc.lines); l++) marks.push(Decoration.line({ class: 'cm-keel-hl' }).range(tr.state.doc.line(l).from))
      return Decoration.set(marks)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** Read-only Python with the selected node's function highlighted and scrolled into view. */
export function CodePane({ code, range }: { code: string; range?: [number, number] }) {
  const ref = useRef<ReactCodeMirrorRef>(null)
  const ext = useMemo(() => [python(), rangeField, EditorView.editable.of(false), EditorView.theme({ '.cm-keel-hl': { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)' } })], [])
  useEffect(() => {
    const view = ref.current?.view; if (!view) return
    view.dispatch({ effects: setRange.of(range ?? null) })
    if (range) { const line = view.state.doc.line(Math.min(range[0], view.state.doc.lines)); view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }) }) }
  }, [range, code])
  return <CodeMirror ref={ref} value={code} height="100%" style={{ height: '100%' }} extensions={ext} theme={cmTheme()} readOnly basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }} />
}

/** CodeMirror's theme follows the OS, like the rest of the window. */
export function cmTheme(): 'dark' | 'light' { return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }

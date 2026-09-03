/**
 * Unified diff, parsed.
 *
 * `git diff` is the record of what the agent actually did to the lane, but a wall of `+`/`-` text
 * is not review — you want it per file, with hunk headers, and with the line numbers on both sides
 * so a change can be found in the editor next to it.
 */
export type Line = { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string; a?: number; b?: number }
export type FileDiff = { path: string; old?: string; status: 'added' | 'deleted' | 'renamed' | 'modified'; binary?: boolean; adds: number; dels: number; lines: Line[] }

const strip = (p: string) => p.replace(/^[ab]\//, '')

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  let f: FileDiff | null = null
  let a = 0, b = 0
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw)
      f = { path: m ? m[2]! : raw.slice(11), old: m ? m[1]! : undefined, status: 'modified', adds: 0, dels: 0, lines: [] }
      files.push(f)
      continue
    }
    if (!f) continue
    if (raw.startsWith('new file')) { f.status = 'added'; continue }
    if (raw.startsWith('deleted file')) { f.status = 'deleted'; continue }
    if (raw.startsWith('rename to ')) { f.status = 'renamed'; f.path = raw.slice(10); continue }
    if (raw.startsWith('rename from ')) { f.status = 'renamed'; f.old = raw.slice(12); continue }
    if (raw.startsWith('Binary files')) { f.binary = true; continue }
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      if (raw.startsWith('+++ ') && raw !== '+++ /dev/null') f.path = strip(raw.slice(4))
      continue
    }
    if (raw.startsWith('index ') || raw.startsWith('similarity ') || raw.startsWith('old mode') || raw.startsWith('new mode')) continue
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
      if (m) { a = Number(m[1]); b = Number(m[2]); f.lines.push({ kind: 'hunk', text: m[3]!.trim() }) }
      continue
    }
    if (raw.startsWith('\\')) continue          // "\ No newline at end of file"
    if (raw.startsWith('+')) { f.lines.push({ kind: 'add', text: raw.slice(1), b }); f.adds++; b++ }
    else if (raw.startsWith('-')) { f.lines.push({ kind: 'del', text: raw.slice(1), a }); f.dels++; a++ }
    else if (raw.startsWith(' ')) { f.lines.push({ kind: 'ctx', text: raw.slice(1), a, b }); a++; b++ }
  }
  return files
}

export const totals = (files: FileDiff[]): { adds: number; dels: number } =>
  files.reduce((t, f) => ({ adds: t.adds + f.adds, dels: t.dels + f.dels }), { adds: 0, dels: 0 })

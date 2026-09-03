/**
 * Spark's `.show()` draws a table in ASCII. The statement API hands it back as `text/plain`, so
 * the old page rendered it in an 11px `<pre>` and left you counting pipes. This turns the box
 * drawing back into rows, so it can be a real table again — selectable, alignable, scrollable.
 *
 *   +---+-----+        ->  { cols: ['id', 'name'], rows: [['1', 'bob']] }
 *   | id| name|
 *   +---+-----+
 *   |  1|  bob|
 *   +---+-----+
 *   only showing top 20 rows
 */
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'table'; cols: string[]; rows: string[][] }

const isRule = (l: string) => /^\+[-+]*\+$/.test(l.trim())
const isRow = (l: string) => l.trimStart().startsWith('|') && l.trimEnd().endsWith('|')
const cells = (l: string) => l.trim().slice(1, -1).split('|').map((c) => c.trim())

export function parseSparkOutput(text: string): Block[] {
  const lines = text.split('\n')
  const out: Block[] = []
  let buf: string[] = []
  const flush = () => { const t = buf.join('\n').replace(/^\n+|\n+$/g, ''); if (t) out.push({ kind: 'text', text: t }); buf = [] }

  for (let i = 0; i < lines.length; i++) {
    // a table is: rule, header row, rule, body rows, rule
    if (isRule(lines[i]!) && isRow(lines[i + 1] ?? '') && isRule(lines[i + 2] ?? '')) {
      const cols = cells(lines[i + 1]!)
      const rows: string[][] = []
      let j = i + 3
      for (; j < lines.length && isRow(lines[j]!); j++) rows.push(cells(lines[j]!))
      if (isRule(lines[j] ?? '')) j++            // closing rule
      flush()
      out.push({ kind: 'table', cols, rows })
      i = j - 1
      continue
    }
    buf.push(lines[i]!)
  }
  flush()
  return out
}

/**
 * Finding a node type by name.
 *
 * Plain `includes()` was the whole search, which fails two ways that matter: a transposed letter
 * ("cvs" for CSV) matches nothing, and the word you actually have in your head is rarely the word
 * on the button — you think "dedupe", Glue calls it Drop Duplicates; you think "where", Glue calls
 * it Filter. So: substring, then subsequence, then one typo, and a keyword list for the synonyms.
 */

/** Damerau-Levenshtein, but only asking "is it within `max`" — the strings here are one word long. */
export function within(a: string, b: string, max = 1): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > max) return false
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      // the transposition case: "cvs" -> "csv"
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2]![j - 2]! + 1)
      rows[i]![j] = v
      best = Math.min(best, v)
    }
    if (best > max) return false          // whole row already over budget
  }
  return rows[a.length]![b.length]! <= max
}

/** Is every character of `q` present in `text`, in order? "aplymap" finds "Apply Mapping". */
export function subsequence(q: string, text: string): boolean {
  let i = 0
  for (const ch of text) if (ch === q[i] && ++i === q.length) return true
  return q.length === 0
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Higher is better; null means no match at all. */
export function score(query: string, name: string, type: string, keywords: string[] = []): number | null {
  const q = norm(query)
  if (!q) return 0
  const n = norm(name), t = norm(type), k = keywords.map(norm)

  const at = n.indexOf(q)
  if (at === 0) return 1000
  if (at > 0) return 900 - at
  if (t.includes(q)) return 800
  for (const w of k) { if (w === q) return 780; if (w.startsWith(q)) return 760; if (w.includes(q)) return 700 }
  if (subsequence(q, n)) return 600
  if (subsequence(q, t)) return 550
  // a single typo, against each word of the name, the bare type, and the keywords
  const words = [...n.split(' '), t.replace(/ /g, ''), ...k]
  for (const w of words) if (within(q, w, q.length <= 4 ? 1 : 2)) return 500
  return null
}

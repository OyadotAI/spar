import type { DagEdge } from './store'

/**
 * The neighbourhood of one node: everything that feeds it, and everything it feeds.
 *
 * Selecting a node in a pipeline should answer "where does this come from and where does it go".
 * With the whole graph at one weight you have to trace edges by eye; anchoring on the selection
 * and dimming the rest is the pattern Databricks' lineage view uses, and it is the single most
 * useful thing a data DAG canvas can do.
 */
export type Lineage = { nodes: Set<string>; edges: Set<string> }

export const edgeId = (e: { from: string; to: string }): string => `${e.from}->${e.to}`

export function lineage(edges: DagEdge[], anchors: string[]): Lineage {
  const nodes = new Set<string>(anchors)
  const ids = new Set<string>()
  if (anchors.length === 0) return { nodes, edges: ids }

  const walk = (from: string, dir: 'up' | 'down') => {
    const queue = [from]
    const seen = new Set<string>([from])
    while (queue.length) {
      const at = queue.shift()!
      for (const e of edges) {
        const next = dir === 'up' ? (e.to === at ? e.from : null) : (e.from === at ? e.to : null)
        if (next == null) continue
        ids.add(edgeId(e))
        nodes.add(next)
        if (!seen.has(next)) { seen.add(next); queue.push(next) }
      }
    }
  }
  for (const a of anchors) { walk(a, 'up'); walk(a, 'down') }
  return { nodes, edges: ids }
}

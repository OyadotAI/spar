import dagre from '@dagrejs/dagre'
import type { DagNode, DagEdge } from './store'

export const NODE_W = 196, NODE_H = 68

/** Left to right, deterministic for the same graph. */
export function autoLayout(nodes: DagNode[], edges: DagEdge[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  // wider rank gap so the edge (and its arrowhead) is readable; taller node gap so the
  // bottom strip of one card never touches the top of the next
  g.setGraph({ rankdir: 'LR', nodesep: 56, ranksep: 150, marginx: 48, marginy: 48, ranker: 'network-simplex' })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const e of [...edges].sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to))) if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to)
  dagre.layout(g)
  const out: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) { const p = g.node(n.id); out[n.id] = { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) } }
  return out
}

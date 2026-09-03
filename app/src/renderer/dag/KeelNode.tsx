import { Handle, Position, type NodeProps } from '@xyflow/react'
import { label, supported } from './schema'
import { Icon, nodeIcon } from '@/shell/Icon'

export type KeelNodeData = {
  name: string; type: string; category: 'source' | 'transform' | 'target'
  inputs: number; maxInputs: number; columns?: number
  problems?: { level: string; message: string }[]
  /** true when something is selected and this node is not in its lineage */
  dim?: boolean
  onAddFrom?: (id: string, at: { x: number; y: number }) => void
}

/**
 * A node card.
 *
 * It used to carry a name and a type and nothing else, so the canvas could not tell you whether a
 * node was wired up, whether it knew its own schema, or which one the checks were complaining
 * about. The strip along the bottom is that: inputs against what the type allows, and the column
 * count from its output schema.
 *
 * The `+` on the output edge is the n8n move — you extend the pipeline from the node you just
 * placed instead of dragging from a palette and then drawing the edge by hand.
 */
export function KeelNode({ id, data, selected }: NodeProps & { data: KeelNodeData }) {
  const worst = data.problems?.some((p) => p.level === 'warn') ? 'warn' : data.problems?.length ? 'info' : null
  const needsInput = data.category !== 'source' && data.inputs === 0
  return (
    <div className={`knode ${data.category}${selected ? ' selected' : ''}${data.dim ? ' dim' : ''}${supported(data.type) ? '' : ' unsupported'}`}
      title={supported(data.type) ? undefined : 'Keel cannot generate code for this type yet; it deploys as-is'}>
      {data.category !== 'source' && <Handle type="target" position={Position.Left} />}
      <div className="knode-icon"><Icon name={nodeIcon(data.type)} size={16} /></div>
      <div className="knode-text">
        <div className="knode-name">{data.name}</div>
        <div className="knode-type">{label(data.type)}</div>
      </div>
      {worst && (
        <div className={'knode-badge ' + worst} title={data.problems!.map((p) => p.message).join('\n\n')}>
          <Icon name={worst === 'warn' ? 'warn' : 'info'} size={12} />
        </div>)}
      <div className="knode-foot">
        {needsInput
          ? <span className="knode-chip warn"><Icon name="warn" size={9} />no input</span>
          : data.category !== 'source' && <span className="knode-chip">{data.inputs}/{data.maxInputs > 4 ? '∞' : data.maxInputs} in</span>}
        {data.columns != null && <span className="knode-chip">{data.columns} col{data.columns === 1 ? '' : 's'}</span>}
      </div>
      {data.category !== 'target' && <Handle type="source" position={Position.Right} />}
      {data.category !== 'target' && data.onAddFrom && (
        <button className="knode-add" title="Add the next node here" aria-label={`Add a node after ${data.name}`}
          onClick={(e) => { e.stopPropagation(); data.onAddFrom!(id, { x: e.clientX, y: e.clientY }) }}>
          <Icon name="plus" size={11} />
        </button>)}
    </div>
  )
}

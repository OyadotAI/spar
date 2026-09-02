import { Handle, Position, type NodeProps } from '@xyflow/react'
import { label, supported } from './schema'
import { Icon, nodeIcon } from '@/shell/Icon'

export type KeelNodeData = { name: string; type: string; category: 'source' | 'transform' | 'target'; inputs: number }

export function KeelNode({ data, selected }: NodeProps & { data: KeelNodeData }) {
  return (
    <div className={`knode ${data.category}${selected ? ' selected' : ''}${supported(data.type) ? '' : ' unsupported'}`} title={supported(data.type) ? undefined : 'Keel cannot generate code for this type yet; it deploys as-is'}>
      {data.category !== 'source' && <Handle type="target" position={Position.Left} />}
      <div className="knode-icon"><Icon name={nodeIcon(data.type)} size={16} /></div>
      <div className="knode-text"><div className="knode-name">{data.name}</div><div className="knode-type">{label(data.type)}</div></div>
      {data.category !== 'target' && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

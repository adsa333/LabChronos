import { useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import ReactFlow, { Background, Controls, Handle, Position } from 'reactflow'
import type { Edge, Node, NodeProps, ReactFlowInstance } from 'reactflow'
import 'reactflow/dist/style.css'
import type { DiagnosisResult } from '../types/diagnosis'
import type { HypothesisScore } from '../lib/scoring'

interface CausalTreeProps {
  diagnosis: DiagnosisResult
  scores: HypothesisScore[]
  prunedIds: string[]
  lockedId: string | null
}

type NodeStatus = 'root' | 'active' | 'pruned' | 'locked'

interface TreeNodeData {
  eyebrow: string
  title: string
  status: NodeStatus
  probability?: number
}

const statusStyles: Record<NodeStatus, string> = {
  root: 'border-line bg-[#151E28] text-ink',
  active: 'border-suspect/45 bg-[#151E28] text-ink',
  pruned: 'border-line bg-panel text-pruned',
  locked: 'border-truth bg-truth/10 text-truth shadow-[0_0_24px_rgba(16,185,129,0.16)]',
}

function CauseNode({ data }: NodeProps<TreeNodeData>) {
  const isSubCause = data.probability === undefined && data.status !== 'root'
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: data.status === 'pruned' ? 0.38 : 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className={`relative rounded-lg border ${statusStyles[data.status]} ${data.status === 'root' ? 'w-[160px] px-4 py-3' : isSubCause ? 'w-[170px] px-2 py-1.5' : 'w-[190px] px-3 py-2'}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-pruned" />
      {!isSubCause && <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">{data.eyebrow}</div>}
      <div className={`${isSubCause ? 'line-clamp-3 text-[11px] leading-4' : 'text-[14px] leading-6'} font-medium`}>{data.title}</div>
      {data.probability !== undefined && (
        <div className="mt-2">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px]">
            <span className="opacity-60">PROBABILITY</span>
            <span className={data.status === 'locked' ? 'text-truth' : 'text-ink'}>{(data.probability * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
            <motion.div
              className={`h-full rounded-full ${data.status === 'locked' ? 'bg-truth' : data.status === 'pruned' ? 'bg-pruned' : 'bg-suspect'}`}
              animate={{ width: `${Math.max(2, data.probability * 100)}%` }}
              transition={{ duration: 0.35 }}
            />
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-pruned" />
    </motion.div>
  )
}

const nodeTypes = { cause: CauseNode }

export default function CausalTree({ diagnosis, scores, prunedIds, lockedId }: CausalTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<ReactFlowInstance | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer: number | undefined
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        flowRef.current?.fitView({ padding: 0.04, maxZoom: 1.15, minZoom: 0.7 })
      }, 120)
    })
    observer.observe(container)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  const { nodes, edges } = useMemo(() => {
    const scoreMap = new Map(scores.map((score) => [score.id, score]))
    const rootY = (diagnosis.hypotheses.length - 1) * 90 + 25
    const nextNodes: Node<TreeNodeData>[] = [{
      id: 'root',
      type: 'cause',
      position: { x: 0, y: rootY },
      draggable: false,
      data: { eyebrow: 'OBSERVED FAILURE', title: diagnosis.caseTitle, status: 'root' },
    }]
    const nextEdges: Edge[] = []

    diagnosis.hypotheses.forEach((hypothesis, hypothesisIndex) => {
      const y = hypothesisIndex * 145
      const pruned = prunedIds.includes(hypothesis.id)
      const locked = lockedId === hypothesis.id
      const status: NodeStatus = locked ? 'locked' : pruned ? 'pruned' : 'active'
      nextNodes.push({
        id: hypothesis.id,
        type: 'cause',
        position: { x: 180, y },
        draggable: false,
        data: {
          eyebrow: `${hypothesis.id} · HYPOTHESIS`,
          title: hypothesis.title,
          status,
          probability: scoreMap.get(hypothesis.id)?.probability ?? 0,
        },
      })
      nextEdges.push({
        id: `root-${hypothesis.id}`,
        source: 'root',
        target: hypothesis.id,
        type: 'smoothstep',
        animated: !pruned,
        style: { stroke: locked ? '#10B981' : pruned ? '#4B5563' : '#526474', strokeWidth: locked ? 2.5 : 1.5, opacity: pruned ? 0.35 : 0.9 },
      })

      if (!pruned) {
        hypothesis.subCauses.forEach((subCause, subIndex) => {
          const subId = `${hypothesis.id}-sub-${subIndex}`
          nextNodes.push({
            id: subId,
            type: 'cause',
            position: { x: 400, y: y + subIndex * 50 },
            draggable: false,
            data: { eyebrow: `${hypothesis.id}.${subIndex + 1} · SUB-CAUSE`, title: subCause, status },
          })
          nextEdges.push({
            id: `${hypothesis.id}-${subId}`,
            source: hypothesis.id,
            target: subId,
            type: 'smoothstep',
            animated: locked,
            style: { stroke: locked ? '#10B981' : '#3B4C5A', strokeWidth: 1.3, opacity: locked ? 1 : 0.7 },
          })
        })
      }
    })
    return { nodes: nextNodes, edges: nextEdges }
  }, [diagnosis, scores, prunedIds, lockedId])

  return (
    <div ref={containerRef} className="h-full min-h-[430px] overflow-hidden rounded-md border border-line bg-bg/60">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onInit={(instance) => { flowRef.current = instance }}
        fitViewOptions={{ padding: 0.04, maxZoom: 1.15 }}
        minZoom={0.7}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll
      >
        <Background color="#1E2A36" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

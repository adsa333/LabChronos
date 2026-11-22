import { useEffect, useMemo, useRef } from 'react'
import type { HypothesisScore } from '../lib/scoring'
import type { DiagnosisResult } from '../types/diagnosis'

interface CausalTreeProps {
  diagnosis: DiagnosisResult
  scores: HypothesisScore[]
  prunedIds: string[]
  lockedId: string | null
  theme: 'ink' | 'lumen'
}

function cssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

export default function CausalTree({ diagnosis, scores, prunedIds, lockedId, theme }: CausalTreeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ordered = useMemo(() => [...scores].sort((a, b) => b.probability - a.probability), [scores])
  const leading = ordered[0]
  const lockedScore = lockedId ? scores.find((item) => item.id === lockedId) : undefined
  const centerValue = lockedScore?.probability ?? leading?.probability ?? 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = 204 * dpr
    canvas.height = 204 * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, 204, 204)
    const ink = cssVar('--ink')
    const ink3 = cssVar('--ink3')
    const rule = cssVar('--rule')
    const seal = cssVar('--seal')
    const teal = cssVar('--teal')
    const amber = cssVar('--amber')
    const plate = cssVar('--bg-plate')
    const center = 102
    const radius = 78
    ctx.lineWidth = 16
    ctx.strokeStyle = rule
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.stroke()
    let start = -Math.PI / 2
    scores.forEach((score) => {
      const angle = Math.max(0.02, score.probability * Math.PI * 2)
      const isLocked = score.id === lockedId
      const isPruned = prunedIds.includes(score.id) || score.probability < 0.15
      ctx.strokeStyle = isLocked ? teal : isPruned ? rule : score.id === leading?.id ? seal : amber
      ctx.beginPath()
      ctx.arc(center, center, radius, start + 0.02, start + angle - 0.02)
      ctx.stroke()
      start += angle
    })
    ctx.fillStyle = plate
    ctx.beginPath()
    ctx.arc(center, center, 58, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = lockedId ? teal : ink
    ctx.font = '700 34px "Noto Serif SC", Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${(centerValue * 100).toFixed(1)}%`, center, center - 6)
    ctx.fillStyle = ink3
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillText(lockedId ? 'LOCKED' : 'LEADING', center, center + 22)
    if (lockedId) {
      ctx.save()
      ctx.translate(38, 170)
      ctx.rotate(-0.12)
      ctx.strokeStyle = seal
      ctx.lineWidth = 1.5
      ctx.strokeRect(-18, -12, 36, 24)
      ctx.fillStyle = seal
      ctx.font = '700 12px "Noto Serif SC", Georgia, serif'
      ctx.fillText('真因', 0, 1)
      ctx.restore()
    }
  }, [scores, prunedIds, lockedId, theme, centerValue, leading?.id])

  return (
    <section className="folio-card flex min-h-0 flex-col">
      <div className="section-bar flex h-11 shrink-0 items-center justify-between px-4">
        <h2 className="font-display text-sm font-semibold text-main">II · 因果墨环与假设分布</h2>
        <span className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">CAUSAL INK RING</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-4">
        <div className="shrink-0">
          <canvas ref={canvasRef} style={{ width: 204, height: 204 }} />
          <p className="mt-2 text-center font-mono-tab text-[9px] text-aux">墨环按概率分布 · 朱砂为 leading</p>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {ordered.map((score, index) => {
            const hypothesis = diagnosis.hypotheses.find((item) => item.id === score.id)
            if (!hypothesis) return null
            const isLocked = score.id === lockedId
            const isPruned = prunedIds.includes(score.id) || score.probability < 0.15
            return (
              <div key={score.id} className={`border p-2 ${isLocked ? 'rule-strong-border teal-soft-bg' : 'rule-border surface-plate'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono-tab text-[10px] text-aux">H{index + 1}</span>
                  <span className={`min-w-0 flex-1 truncate text-xs font-medium ${isPruned ? 'text-aux line-through decoration-dashed' : isLocked ? 'teal-text' : 'text-main'}`}>
                    {hypothesis.title}
                  </span>
                  <span className={`font-mono-tab text-xs ${isLocked ? 'teal-text' : 'text-sub'}`}>{(score.probability * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden surface-tint">
                  <div className="h-full" style={{ width: `${Math.max(2, score.probability * 100)}%`, background: isLocked ? 'var(--teal)' : isPruned ? 'var(--rule)' : 'var(--amber)' }} />
                </div>
                {!isPruned && (
                  <ul className="mt-1.5 space-y-0.5">
                    {hypothesis.subCauses.map((cause) => (
                      <li key={cause} className="truncate text-[10px] text-aux">· {cause}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

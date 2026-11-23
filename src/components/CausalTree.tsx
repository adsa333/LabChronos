import { useMemo } from 'react'
import InkRingCanvas from './InkRingCanvas'
import type { HypothesisScore } from '../lib/scoring'
import type { DiagnosisResult } from '../types/diagnosis'

interface CausalTreeProps {
  diagnosis: DiagnosisResult
  scores: HypothesisScore[]
  prunedIds: string[]
  lockedId: string | null
  answeredCount: number
  theme: 'ink' | 'lumen'
  hoveredSymptomId: string | null
  hoveredHypothesisId: string | null
  onHoverHypothesis: (id: string | null) => void
}

export default function CausalTree({ diagnosis, scores, prunedIds, lockedId, answeredCount, theme, hoveredSymptomId, hoveredHypothesisId, onHoverHypothesis }: CausalTreeProps) {
  const ordered = useMemo(() => [...scores].sort((a, b) => b.probability - a.probability), [scores])

  return (
    <section className="folio-card flex min-h-0 flex-col">
      <div className="section-bar flex h-11 shrink-0 items-center justify-between px-4">
        <h2 className="font-display text-sm font-semibold text-main">II · 因果墨环与假设分布</h2>
        <span className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">CAUSAL INK RING</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-wrap gap-4 p-4 xl:overflow-y-auto">
        <div className="shrink-0">
          <InkRingCanvas
            hypotheses={diagnosis.hypotheses}
            scores={scores}
            prunedIds={prunedIds}
            lockedId={lockedId}
            answeredCount={answeredCount}
            theme={theme}
            hoveredSymptomId={hoveredSymptomId}
            hoveredHypothesisId={hoveredHypothesisId}
          />
          <p className="mt-2 text-center font-mono-tab text-[9px] text-aux">墨环按概率分布 · 朱砂为联动高亮</p>
        </div>
        <div className="min-w-0 flex-[1_1_180px] space-y-2">
          {ordered.map((score) => {
            const hypothesis = diagnosis.hypotheses.find((item) => item.id === score.id)
            if (!hypothesis) return null
            const isLocked = score.id === lockedId
            const isPruned = !isLocked && answeredCount > 0 && prunedIds.includes(score.id)
            const linkedToSymptom = Boolean(hoveredSymptomId && hypothesis.evidenceFor.includes(hoveredSymptomId))
            const isHovered = score.id === hoveredHypothesisId || linkedToSymptom
            return (
              <div
                key={score.id}
                tabIndex={0}
                data-hypothesis-id={score.id}
                onFocus={() => onHoverHypothesis(score.id)}
                onBlur={() => onHoverHypothesis(null)}
                onPointerEnter={(event) => { if (event.pointerType === 'mouse') onHoverHypothesis(score.id) }}
                onPointerLeave={() => onHoverHypothesis(null)}
                className={`border p-2 transition-colors ${isHovered ? 'rule-strong-border seal-soft-bg' : isLocked ? 'rule-strong-border teal-soft-bg' : 'rule-border surface-plate'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono-tab text-[10px] uppercase text-aux">{score.id}</span>
                  <span className={`min-w-0 flex-1 truncate text-xs font-medium ${isPruned ? 'text-aux line-through decoration-dashed' : isHovered ? 'seal-text' : isLocked ? 'teal-text' : 'text-main'}`}>
                    {hypothesis.title}
                  </span>
                  <span className={`font-mono-tab text-xs ${isHovered ? 'seal-text' : isLocked ? 'teal-text' : 'text-sub'}`}>{(score.probability * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden surface-tint">
                  <div className="h-full" style={{ width: `${Math.max(2, score.probability * 100)}%`, background: isHovered ? 'var(--seal)' : isLocked ? 'var(--teal)' : isPruned ? 'var(--rule)' : 'var(--amber)' }} />
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
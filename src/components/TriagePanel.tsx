import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Check, CircleHelp, FlaskConical, Lock, RotateCcw } from 'lucide-react'
import type { Answers, HypothesisScore } from '../lib/scoring'
import type { DiagnosisResult } from '../types/diagnosis'
import PanelHeader from './PanelHeader'

interface TriagePanelProps {
  diagnosis: DiagnosisResult
  answers: Answers
  scores: HypothesisScore[]
  lockedId: string | null
  onAnswer: (questionId: string, optionIndex: number) => void
  onManualLock: () => void
  onReset: () => void
}

export default function TriagePanel({ diagnosis, answers, scores, lockedId, onAnswer, onManualLock, onReset }: TriagePanelProps) {
  const answeredCount = Object.keys(answers).length
  const lockedHypothesis = lockedId ? diagnosis.hypotheses.find((hypothesis) => hypothesis.id === lockedId) : undefined
  const lockedScore = lockedId ? scores.find((score) => score.id === lockedId) : undefined
  const lockedCardRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!lockedId) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    lockedCardRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [lockedId])

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <PanelHeader
        index="03"
        title="排查区"
        english="TRIAGE"
        action={
          <button type="button" onClick={onReset} className="flex items-center gap-1 text-[10px] text-ink-muted hover:text-truth">
            <RotateCcw size={12} />重置
          </button>
        }
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex items-center justify-between px-1 font-mono text-[10px] text-ink-muted">
          <span>已回答 {answeredCount}/{diagnosis.questions.length}</span>
          <span>p &lt; 15% 剪枝 · p ≥ 60% 锁定</span>
        </div>

        {diagnosis.questions.map((question, questionIndex) => (
          <article key={question.id} className="rounded-md border border-line bg-bg/60 p-3">
            <div className="mb-2 flex items-center gap-2 font-mono text-[9px] tracking-[0.14em] text-suspect">
              <CircleHelp size={14} />QUESTION {String(questionIndex + 1).padStart(2, '0')}
            </div>
            <h3 className="text-xs font-medium leading-5 text-ink">{question.prompt}</h3>
            <div className="mt-3 space-y-2">
              {question.options.map((option, optionIndex) => {
                const selected = answers[question.id] === optionIndex
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onAnswer(question.id, optionIndex)}
                    className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-[11px] leading-4 transition-colors ${selected ? 'border-truth/70 bg-truth/10 text-truth' : 'border-line bg-panel text-ink-muted hover:border-suspect/50 hover:text-ink'}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${selected ? 'border-truth' : 'border-pruned'}`}>
                      {selected ? <Check size={10} /> : String.fromCharCode(65 + optionIndex)}
                    </span>
                    <span>{option.label}</span>
                  </button>
                )
              })}
            </div>
            <details className="mt-3 border-t border-line pt-2 text-[10px] text-ink-muted">
              <summary className="cursor-pointer font-mono text-suspect/80">howToCheck · 怎么检查</summary>
              <p className="mt-2 leading-4">{question.howToCheck}</p>
            </details>
          </article>
        ))}

        {!lockedId && (
          <button type="button" onClick={onManualLock} className="flex w-full items-center justify-center gap-2 rounded-md border border-suspect/40 bg-suspect/5 px-3 py-2 text-[11px] text-suspect hover:bg-suspect/10">
            <Lock size={13} />直接锁定当前最高项
          </button>
        )}

        {lockedHypothesis && lockedScore && (
          <motion.article
            key={lockedHypothesis.id}
            ref={lockedCardRef}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-md border p-4 ${lockedScore.probability >= 0.6 ? 'border-truth/60 bg-truth/5' : 'border-suspect/50 bg-suspect/5'}`}
          >
            <div className={`flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] ${lockedScore.probability >= 0.6 ? 'text-truth' : 'text-suspect'}`}>
              <Lock size={13} />{lockedScore.probability >= 0.6 ? 'ROOT CAUSE LOCKED' : 'LOW CONFIDENCE · 证据不足'}
            </div>
            <h3 className="mt-2 text-sm font-semibold leading-6 text-ink">{lockedHypothesis.title}</h3>
            <div className="mt-1 font-mono text-lg text-truth">{(lockedScore.probability * 100).toFixed(1)}%</div>
            <p className="mt-2 text-[11px] leading-5 text-ink-muted">{lockedHypothesis.mechanism}</p>

            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-ink">
                <FlaskConical size={14} className="text-truth" />最小对照实验
              </div>
              <p className="text-[11px] leading-5 text-ink-muted">{lockedHypothesis.minimalControl.action}</p>
              <div className="mt-3 space-y-2">
                {lockedHypothesis.minimalControl.paramDiff.map((item) => (
                  <div key={item.key} className="rounded-md border border-line bg-panel p-2.5">
                    <div className="mb-2 font-mono text-[10px] text-ink-muted">{item.key}</div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[10px]">
                      <span className="rounded bg-red-400/10 px-2 py-1.5 text-red-300">{item.before}</span>
                      <span className="text-pruned">→</span>
                      <span className="rounded bg-truth/10 px-2 py-1.5 text-truth">{item.after}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-md border border-truth/20 bg-truth/5 p-3">
                <div className="mb-1 font-mono text-[9px] text-truth">EXPECTED OUTCOME</div>
                <p className="text-[11px] leading-5 text-ink-muted">{lockedHypothesis.minimalControl.expectedOutcome}</p>
              </div>
              {diagnosis.confidenceNote && <p className="mt-3 text-[10px] leading-4 text-suspect">{diagnosis.confidenceNote}</p>}
            </div>
          </motion.article>
        )}
      </div>
    </section>
  )
}

import { useEffect, useMemo } from 'react'
import { Archive, Download, Lock, RotateCcw } from 'lucide-react'
import type { Answers, HypothesisScore } from '../lib/scoring'
import type { DiagnosisResult } from '../types/diagnosis'

interface TriagePanelProps {
  diagnosis: DiagnosisResult
  answers: Answers
  scores: HypothesisScore[]
  lockedId: string | null
  onAnswer: (questionId: string, optionIndex: number) => void
  onManualLock: () => void
  onReset: () => void
  onExportRecap: () => void
  onSaveToVault: () => void
  vaulted: boolean
  recapBusy: boolean
}

function ExpectedCurve({ curve }: { curve: { x: number; before: number | null; after: number }[] }) {
  const width = 320
  const height = 104
  const pad = 16
  const xs = curve.map((point) => point.x)
  const ys = curve.flatMap((point) => [point.before, point.after]).filter((value): value is number => value !== null)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (width - pad * 2)
  const sy = (y: number) => height - pad - ((y - minY) / Math.max(0.001, maxY - minY)) * (height - pad * 2)
  const before = curve.filter((point) => point.before !== null).map((point) => `${sx(point.x)},${sy(point.before as number)}`).join(' ')
  const after = curve.map((point) => `${sx(point.x)},${sy(point.after)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="max-h-[104px] w-full">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--rule)" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="var(--rule)" strokeWidth="1" />
      {before && <polyline points={before} fill="none" stroke="var(--seal)" strokeWidth="1.5" strokeDasharray="4 3" />}
      <polyline points={after} fill="none" stroke="var(--teal)" strokeWidth="2" />
      <text x={width - pad} y={pad} textAnchor="end" fontSize="8" fill="var(--ink3)" fontFamily="JetBrains Mono, monospace">BEFORE / AFTER</text>
    </svg>
  )
}

export default function TriagePanel({ diagnosis, answers, scores, lockedId, onAnswer, onManualLock, onReset, onExportRecap, onSaveToVault, vaulted, recapBusy }: TriagePanelProps) {
  const answeredCount = Object.keys(answers).length
  const lockedHypothesis = lockedId ? diagnosis.hypotheses.find((item) => item.id === lockedId) : undefined
  const lockedScore = lockedId ? scores.find((item) => item.id === lockedId) : undefined
  const firstUnanswered = diagnosis.questions.findIndex((question) => answers[question.id] === undefined)
  const currentIndex = firstUnanswered === -1 ? diagnosis.questions.length - 1 : firstUnanswered
  const question = diagnosis.questions[currentIndex]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('[role="dialog"]')) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key.toLowerCase() === 'r') {
        onReset()
        return
      }
      if (lockedId) return
      const optionIndex = Number(event.key) - 1
      if (question && optionIndex >= 0 && optionIndex < question.options.length) {
        onAnswer(question.id, optionIndex)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [lockedId, question, onAnswer, onReset])

  const curve = lockedHypothesis?.minimalControl.expectedCurve
  const progress = useMemo(() => diagnosis.questions.map((item) => answers[item.id] !== undefined), [diagnosis.questions, answers])

  return (
    <section className="folio-card flex min-h-0 flex-col border-t-[1.5px] rule-top-strong">
      <div className="section-bar flex h-11 shrink-0 items-center justify-between px-4">
        <h2 className="font-display text-sm font-semibold text-main">III · {lockedId ? '最小对照处方' : '鉴别追问'}</h2>
        <button type="button" onClick={onReset} className="flex items-center gap-1 text-[10px] text-aux hover:seal-text">
          <RotateCcw size={11} />重置
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-20 min-[1400px]:pb-6">
        {!lockedId && question && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono-tab text-[10px] tracking-[0.16em] amber-text">QUESTION {String(currentIndex + 1).padStart(2, '0')}</span>
              <span className="flex gap-1">
                {progress.map((done, index) => (
                  <span key={index} className={`h-1.5 w-5 ${done ? 'teal-text' : index === currentIndex ? 'amber-text' : 'text-aux'}`} style={{ background: 'currentColor' }} aria-label={`第${index + 1}题`} />
                ))}
              </span>
            </div>
            <h3 className="font-display text-base font-semibold leading-6 text-main">{question.prompt}</h3>
            <div className="space-y-2">
              {question.options.map((option, optionIndex) => {
                const selected = answers[question.id] === optionIndex
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => onAnswer(question.id, optionIndex)}
                    className={`flex w-full items-start gap-2 border p-2 text-left text-xs leading-5 ${selected ? 'rule-strong-border teal-soft-bg teal-text' : 'rule-border surface-plate text-sub hover:seal-text'}`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center border rule-border font-mono-tab text-[10px]">{optionIndex + 1}</span>
                    <span>{option.label}</span>
                  </button>
                )
              })}
            </div>
            <details className="border-t rule-border pt-2 text-[11px] text-sub">
              <summary className="cursor-pointer font-mono-tab text-[10px] amber-text">查看排查核查方法</summary>
              <p className="mt-2 leading-5">{question.howToCheck}</p>
            </details>
            <button type="button" onClick={onManualLock} className="flex w-full items-center justify-center gap-2 border rule-border px-3 py-2 text-[11px] text-sub hover:seal-text hover:seal-soft-bg">
              <Lock size={12} />直接锁定当前最高项
            </button>
            <p className="font-mono-tab text-[9px] text-aux">键盘 1/2/3 作答 · R 重置 · 已答 {answeredCount}/{diagnosis.questions.length}</p>
          </div>
        )}

        {lockedId && lockedHypothesis && lockedScore && (
          <div className="space-y-2">
            <div className="border-l-[3px] pl-3" style={{ borderColor: 'var(--teal)' }}>
              <p className="font-mono-tab text-[10px] tracking-[0.16em] teal-text">ROOT CAUSE LOCKED</p>
              <h3 className="mt-1 font-display text-lg font-semibold leading-6 text-main">{lockedHypothesis.title}</h3>
              <p className="mt-1 font-display text-3xl teal-text">{(lockedScore.probability * 100).toFixed(1)}%</p>
              <p className="mt-2 text-[11px] leading-4 text-sub">{lockedHypothesis.mechanism}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 min-[1400px]:grid-cols-2">
              <div className="folio-card p-3">
                <p className="mb-2 font-mono-tab text-[10px] tracking-[0.16em] text-aux">单变量参数 DIFF</p>
                <div className="space-y-2">
                  {lockedHypothesis.minimalControl.paramDiff.map((item) => (
                    <div key={item.key} className="border rule-border surface-plate p-2">
                      <p className="font-mono-tab text-[10px] text-aux">{item.key}</p>
                      <div className="mt-1 flex items-center gap-2 font-mono-tab text-[11px]">
                        <span className="seal-text line-through">{item.before.replace(/^["'“”]+|["'“”]+$/g, '')}</span>
                        <span className="text-aux">→</span>
                        <span className="font-bold teal-text">{item.after.replace(/^["'“”]+|["'“”]+$/g, '')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {curve && curve.length > 1 ? (
                <div className="folio-card p-3">
                  <p className="mb-2 font-mono-tab text-[10px] tracking-[0.16em] text-aux">修复前后预期曲线</p>
                  <ExpectedCurve curve={curve} />
                </div>
              ) : (
                <div className="folio-card p-3">
                  <p className="mb-2 font-mono-tab text-[10px] tracking-[0.16em] text-aux">单变量预期结果</p>
                  <p className="text-[11px] leading-5 text-sub">{lockedHypothesis.minimalControl.expectedOutcome}</p>
                </div>
              )}
            </div>

            <p className="text-[11px] leading-5 text-sub">{lockedHypothesis.minimalControl.action}</p>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onExportRecap} disabled={recapBusy} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
                <Download size={13} />{recapBusy ? '渲染中…' : '导出复盘卡 PNG'}
              </button>
              <button type="button" onClick={onSaveToVault} disabled={vaulted} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
                <Archive size={13} />{vaulted ? '已存入往期' : '存入博物馆'}
              </button>
              <button type="button" onClick={onReset} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <RotateCcw size={13} />重新追问
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

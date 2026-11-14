import { useMemo, useState } from 'react'
import { Archive, FlaskConical, Plus } from 'lucide-react'
import CausalTree from '../components/CausalTree'
import EvidencePanel from '../components/EvidencePanel'
import PanelHeader from '../components/PanelHeader'
import TriagePanel from '../components/TriagePanel'
import { presets } from '../data/presets'
import { getAutomaticLockId, getLeadingHypothesis, getPrunedIds, scoreHypotheses } from '../lib/scoring'
import type { Answers } from '../lib/scoring'

export default function Workbench() {
  const [activeCaseId, setActiveCaseId] = useState(presets[0].id)
  const [answers, setAnswers] = useState<Answers>({})
  const [manualLockId, setManualLockId] = useState<string | null>(null)
  const activeCase = presets.find((preset) => preset.id === activeCaseId) ?? presets[0]
  const { diagnosis } = activeCase
  const scores = useMemo(() => scoreHypotheses(diagnosis, answers), [diagnosis, answers])
  const prunedIds = useMemo(() => getPrunedIds(scores, Object.keys(answers).length), [scores, answers])
  const automaticLockId = useMemo(() => getAutomaticLockId(diagnosis, answers, scores), [diagnosis, answers, scores])
  const lockedId = manualLockId ?? automaticLockId

  function selectCase(caseId: string) {
    setActiveCaseId(caseId)
    setAnswers({})
    setManualLockId(null)
  }

  function answerQuestion(questionId: string, optionIndex: number) {
    setAnswers((current) => ({ ...current, [questionId]: optionIndex }))
    setManualLockId(null)
  }

  function resetAnswers() {
    setAnswers({})
    setManualLockId(null)
  }

  return (
    <div className="h-screen min-w-[1180px] overflow-hidden bg-bg text-ink">
      <header className="grid h-14 grid-cols-[320px_minmax(0,1fr)_380px] items-center gap-3 border-b border-line px-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-truth/40 bg-truth/10 text-truth">
            <FlaskConical size={18} strokeWidth={1.8} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold tracking-tight text-ink">LabChronos</span>
              <span className="rounded border border-truth/40 bg-truth/10 px-1.5 py-px font-mono text-[10px] text-truth">M1</span>
            </div>
            <p className="mt-0.5 text-[10px] tracking-wide text-ink-muted">实验失败取证 <span className="text-pruned">·</span> Failure Forensics</p>
          </div>
        </div>

        <nav aria-label="病例选择" className="flex items-center justify-center gap-2">
          {presets.map((preset) => {
            const isActive = activeCase.id === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => selectCase(preset.id)}
                className={`h-8 whitespace-nowrap rounded-md border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-truth ${isActive ? 'border-truth/70 bg-truth/10 text-truth' : 'border-line bg-panel text-ink-muted hover:border-pruned hover:text-ink'}`}
              >
                {preset.label}
              </button>
            )
          })}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled className="flex h-8 items-center gap-1.5 rounded-md border border-truth/30 bg-truth/5 px-3 text-xs text-truth/50 disabled:cursor-not-allowed">
            <Plus size={14} />新建诊断
          </button>
          <button type="button" disabled className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-xs text-ink-muted/50 disabled:cursor-not-allowed">
            <Archive size={14} />翻车博物馆
          </button>
        </div>
      </header>

      <main className="grid h-[calc(100vh-56px)] grid-cols-[320px_minmax(0,1fr)_380px] gap-3 p-3">
        <EvidencePanel preset={activeCase} />
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
          <PanelHeader index="02" title={activeCase.label} english="CAUSAL TREE" />
          <div className="min-h-0 flex-1 p-3">
            <CausalTree
              key={activeCase.id}
              diagnosis={diagnosis}
              scores={scores}
              prunedIds={prunedIds}
              lockedId={lockedId}
            />
          </div>
          <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-3 font-mono text-[9px] text-ink-muted">
            <span>{lockedId ? `${lockedId} 已锁定 · 可重置后尝试其他路径` : '回答右侧问题，实时重算概率并剪枝'}</span>
            <span className="text-pruned">ROOT → HYPOTHESES → SUB-CAUSES</span>
          </div>
        </section>
        <TriagePanel
          diagnosis={diagnosis}
          answers={answers}
          scores={scores}
          lockedId={lockedId}
          onAnswer={answerQuestion}
          onManualLock={() => setManualLockId(getLeadingHypothesis(scores).id)}
          onReset={resetAnswers}
        />
      </main>
    </div>
  )
}

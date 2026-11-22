import { useMemo, useState } from 'react'
import { ClipboardList, FileText, Image as ImageIcon, Table2, X } from 'lucide-react'
import type { PresetCase } from '../data/presets'

interface EvidencePanelProps {
  preset: PresetCase
}

type EvidenceTab = 'symptoms' | 'log' | 'conditions'

function parseKeyValues(log: string): [string, string][] {
  const rows: [string, string][] = []
  log.split(/\r?\n/).forEach((line) => {
    const match = line.match(/([A-Za-z0-9_]+)\s*=\s*([^=]+)$/)
    if (match) rows.push([match[1], match[2].trim()])
  })
  return rows
}

export default function EvidencePanel({ preset }: EvidencePanelProps) {
  const [tab, setTab] = useState<EvidenceTab>('symptoms')
  const [activeId, setActiveId] = useState<string | null>(() => preset.diagnosis.observedSymptoms.find((item) => item.bbox)?.id ?? null)
  const [lightbox, setLightbox] = useState(false)
  const activeSymptom = preset.diagnosis.observedSymptoms.find((item) => item.id === activeId)
  const activeBBox = activeSymptom?.bbox
  const isCustom = preset.id.startsWith('custom-') || preset.id.startsWith('vault-')
  const keyValues = useMemo(() => parseKeyValues(preset.log), [preset.log])
  const conditionRows = preset.conditions.trim()
    ? preset.conditions.trim().split(/\r?\n/).map((line) => line.split(','))
    : keyValues.length > 0
      ? [['KEY', 'VALUE'], ...keyValues]
      : []

  const bboxOverlay = activeBBox && (
    <div
      className="pointer-events-none absolute border-2 transition-opacity duration-150"
      style={{
        borderColor: 'var(--seal)',
        background: 'var(--seal-soft)',
        left: `${activeBBox[0] * 100}%`,
        top: `${activeBBox[1] * 100}%`,
        width: `${activeBBox[2] * 100}%`,
        height: `${activeBBox[3] * 100}%`,
      }}
    >
      <span className="absolute -left-0.5 -top-0.5 h-2 w-2 border-l-2 border-t-2" style={{ borderColor: 'var(--seal)' }} />
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 border-r-2 border-t-2" style={{ borderColor: 'var(--seal)' }} />
      <span className="absolute -bottom-0.5 -left-0.5 h-2 w-2 border-b-2 border-l-2" style={{ borderColor: 'var(--seal)' }} />
      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 border-b-2 border-r-2" style={{ borderColor: 'var(--seal)' }} />
    </div>
  )

  return (
    <section className="flex min-h-0 flex-col border-r-[1.5px] rule-strong-border surface-folio">
      <div className="section-bar flex h-12 shrink-0 items-center justify-between px-4">
        <h2 className="font-display text-sm font-semibold text-main">I · 实验取证</h2>
        <span className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">EVIDENCE FOLIO</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-16">
        <p className="text-xs leading-5 text-sub">客观记录失败现象，不先把猜测写成事实。</p>
        {isCustom && (
          <div className="border rule-border seal-soft-bg px-3 py-2 text-[11px] leading-5 seal-text">
            科学边界：{preset.diagnosis.confidenceNote ?? '当前为本地推演结果，接入真实模型后将依据你的截图重新分析。'}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="folio-card p-3">
            <p className="font-display text-2xl text-main">{preset.diagnosis.observedSymptoms.length}</p>
            <p className="mt-1 text-[10px] text-aux">观测症状</p>
          </div>
          <div className="folio-card p-3">
            <p className="font-display text-2xl text-main">{preset.diagnosis.questions.length}</p>
            <p className="mt-1 text-[10px] text-aux">鉴别追问</p>
          </div>
          <div className="folio-card p-3">
            <p className="font-display text-lg teal-text">{preset.diagnosis.domain}</p>
            <p className="mt-1 text-[10px] text-aux">学科领域</p>
          </div>
        </div>

        <div className="plate-box folio-card p-3">
          <span className="plate-corner left-0 top-0 border-l-[1.5px] border-t-[1.5px]" />
          <span className="plate-corner right-0 top-0 border-r-[1.5px] border-t-[1.5px]" />
          <span className="plate-corner bottom-0 left-0 border-b-[1.5px] border-l-[1.5px]" />
          <span className="plate-corner bottom-0 right-0 border-b-[1.5px] border-r-[1.5px]" />
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs text-sub"><ImageIcon size={13} />图版 I</span>
            <span className="font-mono-tab text-[9px] text-aux">PLATE I</span>
          </div>
          {preset.image ? (
            <div className="flex justify-center surface-tint p-2">
              <button type="button" onClick={() => setLightbox(true)} className="relative inline-block cursor-zoom-in">
                <img src={preset.image} alt={preset.diagnosis.caseTitle} className="block max-h-[320px] w-auto max-w-full" />
                {bboxOverlay}
              </button>
            </div>
          ) : conditionRows.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 surface-tint p-3">
              {conditionRows.slice(0, 12).map((row, index) => (
                <div key={`${row[0]}-${index}`} className="border rule-border surface-plate px-2 py-1.5">
                  <p className="font-mono-tab text-[9px] text-aux">{row[0]}</p>
                  <p className="mt-0.5 break-words font-mono-tab text-[11px] text-main">{row[1]}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center border border-dashed rule-border surface-tint font-mono-tab text-xs text-aux">
              NO IMAGE
            </div>
          )}
        </div>

        <div className="folio-card">
          <div className="flex border-b rule-border">
            {([
              ['symptoms', '观测症状', ClipboardList],
              ['log', '原始日志', FileText],
              ['conditions', '条件表', Table2],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-[11px] ${tab === key ? 'seal-soft-bg seal-text' : 'text-sub hover:text-main'}`}
              >
                <Icon size={12} />{label}
              </button>
            ))}
          </div>
          <div className="max-h-[320px] overflow-y-auto p-3">
            {tab === 'symptoms' && (
              <div className="space-y-2">
                {preset.diagnosis.observedSymptoms.map((symptom) => (
                  <button
                    key={symptom.id}
                    type="button"
                    onClick={() => setActiveId(symptom.id)}
                    className={`block w-full border p-2 text-left ${activeId === symptom.id ? 'rule-strong-border seal-soft-bg' : 'rule-border surface-plate'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`font-mono-tab text-[9px] uppercase ${symptom.severity === 'critical' ? 'seal-text' : 'amber-text'}`}>
                        {symptom.id} · {symptom.severity}
                      </span>
                      <span className="font-mono-tab text-[9px] text-aux">{symptom.source}</span>
                    </span>
                    <span className="mt-1 block text-xs font-medium leading-5 text-main">{symptom.label}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-sub">{symptom.detail}</span>
                  </button>
                ))}
              </div>
            )}
            {tab === 'log' && (
              preset.log.trim() ? (
                <pre className="whitespace-pre-wrap break-words font-mono-tab text-[10px] leading-[1.7] text-sub">{preset.log}</pre>
              ) : (
                <p className="py-8 text-center text-xs text-aux">未提供实验日志</p>
              )
            )}
            {tab === 'conditions' && (
              conditionRows.length > 0 ? (
                <table className="w-full border-collapse text-[10px]">
                  <thead className="surface-tint text-aux">
                    <tr>
                      {conditionRows[0].map((cell) => <th key={cell} className="border-b rule-border px-2 py-2 text-left font-medium">{cell}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {conditionRows.slice(1).map((row, rowIndex) => (
                      <tr key={`${row[0]}-${rowIndex}`} className="border-b rule-border last:border-0">
                        {row.map((cell, cellIndex) => (
                          <td key={`${cellIndex}-${cell}`} className={`break-words px-2 py-1.5 align-top font-mono-tab ${cellIndex === 0 ? 'text-aux' : 'text-main'}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-8 text-center text-xs text-aux">该病例未提供条件表</p>
              )
            )}
          </div>
        </div>
      </div>

      {lightbox && preset.image && (
        <div className="scrim fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => setLightbox(false)}>
          <div className="relative max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <button type="button" aria-label="关闭图版" onClick={() => setLightbox(false)} className="absolute -top-8 right-0 text-[var(--bg-plate)]">
              <X size={18} />
            </button>
            <div className="relative inline-block">
              <img src={preset.image} alt={preset.diagnosis.caseTitle} className="max-h-[82vh] w-auto max-w-full" />
              {bboxOverlay}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

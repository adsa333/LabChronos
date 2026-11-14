import { useState } from 'react'
import { ClipboardList, FileText, Image as ImageIcon, Table2 } from 'lucide-react'
import type { PresetCase } from '../data/presets'
import PanelHeader from './PanelHeader'

interface EvidencePanelProps {
  preset: PresetCase
}

export default function EvidencePanel({ preset }: EvidencePanelProps) {
  const [activeTab, setActiveTab] = useState<'log' | 'conditions'>('log')
  const conditionRows = preset.conditions.trim().split(/\r?\n/).map((line) => line.split(','))

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <PanelHeader index="01" title="取证区" english="EVIDENCE" />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="overflow-hidden rounded-md border border-line bg-bg/70">
          <div className="flex h-9 items-center justify-between border-b border-line px-3">
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <ImageIcon size={14} />
              <span>失败图片</span>
            </div>
            <span className="font-mono text-[9px] tracking-wider text-pruned">SYNTHETIC EVIDENCE</span>
          </div>
          <div className="flex h-[245px] items-center justify-center bg-black/25 p-2">
            <img
              src={preset.image}
              alt={preset.diagnosis.caseTitle}
              className="h-full w-full rounded object-contain"
            />
          </div>
        </div>

        <div className="flex h-[255px] flex-col overflow-hidden rounded-md border border-line bg-bg/70">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-2">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('log')}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${activeTab === 'log' ? 'bg-truth/10 text-truth' : 'text-ink-muted hover:text-ink'}`}
              >
                <FileText size={13} />日志片段
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('conditions')}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] ${activeTab === 'conditions' ? 'bg-truth/10 text-truth' : 'text-ink-muted hover:text-ink'}`}
              >
                <Table2 size={13} />条件表
              </button>
            </div>
            <span className="font-mono text-[9px] text-pruned">{activeTab === 'log' ? 'LOG' : 'CSV'}</span>
          </div>
          {activeTab === 'log' ? (
            <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[9px] leading-[1.65] text-ink-muted">{preset.log}</pre>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-[10px]">
                <thead className="sticky top-0 bg-bg text-ink-muted">
                  <tr>
                    {conditionRows[0].map((cell) => <th key={cell} className="border-b border-line px-2 py-2 text-left font-medium">{cell}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {conditionRows.slice(1).map((row, rowIndex) => (
                    <tr key={`${row[0]}-${rowIndex}`} className="border-b border-line/60 last:border-0">
                      {row.map((cell, cellIndex) => (
                        <td key={`${cellIndex}-${cell}`} className={`px-2 py-1.5 align-top ${cellIndex === 2 ? 'text-ink' : 'text-ink-muted'}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 px-1 text-xs text-ink-muted">
            <ClipboardList size={14} />
            <span>症状卡片</span>
            <span className="ml-auto font-mono text-[9px] text-pruned">{preset.diagnosis.observedSymptoms.length} OBSERVED</span>
          </div>
          <div className="space-y-2">
            {preset.diagnosis.observedSymptoms.map((symptom) => (
              <article key={symptom.id} className={`rounded-md border bg-bg/60 p-3 ${symptom.severity === 'critical' ? 'border-red-400/30' : 'border-suspect/25'}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className={`font-mono text-[9px] uppercase ${symptom.severity === 'critical' ? 'text-red-300' : 'text-suspect'}`}>{symptom.id} · {symptom.severity}</span>
                  <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] text-ink-muted">{symptom.source}</span>
                </div>
                <h3 className="text-xs font-medium leading-5 text-ink">{symptom.label}</h3>
                <p className="mt-1 text-[10px] leading-4 text-ink-muted">{symptom.detail}</p>
                {symptom.bbox && <div className="mt-2 font-mono text-[9px] text-pruned">bbox [{symptom.bbox.join(', ')}]</div>}
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

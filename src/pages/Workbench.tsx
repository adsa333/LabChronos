import { useState } from 'react'
import {
  Archive,
  CircleHelp,
  ClipboardList,
  FileText,
  FlaskConical,
  GitBranch,
  Image,
  Plus,
} from 'lucide-react'

const cases = ['AI 训练崩盘', '凝胶电泳拖尾', '示波器波形振铃'] as const

type CaseName = (typeof cases)[number]

function M1Badge() {
  return (
    <span className="absolute right-2 top-2 rounded border border-pruned/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-muted">
      M1
    </span>
  )
}

export default function Workbench() {
  const [activeCase, setActiveCase] = useState<CaseName>(cases[0])

  return (
    <div className="h-screen min-w-[1120px] overflow-hidden bg-bg text-ink">
      <header className="grid h-14 grid-cols-[320px_minmax(0,1fr)_380px] items-center gap-3 border-b border-line px-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-truth/40 bg-truth/10 text-truth">
            <FlaskConical size={18} strokeWidth={1.8} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold tracking-tight text-ink">
                LabChronos
              </span>
              <span className="rounded border border-line px-1 py-px font-mono text-[10px] text-ink-muted">
                M0
              </span>
            </div>
            <p className="mt-0.5 text-[10px] tracking-wide text-ink-muted">
              实验失败取证 <span className="text-pruned">·</span> Failure Forensics
            </p>
          </div>
        </div>

        <nav aria-label="病例选择" className="flex items-center justify-center gap-2">
          {cases.map((caseName) => {
            const isActive = activeCase === caseName

            return (
              <button
                key={caseName}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveCase(caseName)}
                className={`h-8 whitespace-nowrap rounded-md border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-truth ${
                  isActive
                    ? 'border-truth/70 bg-truth/10 text-truth'
                    : 'border-line bg-panel text-ink-muted hover:border-pruned hover:text-ink'
                }`}
              >
                {caseName}
              </button>
            )
          })}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled
            className="flex h-8 items-center gap-1.5 rounded-md border border-truth/70 bg-truth/10 px-3 text-xs font-medium text-truth disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            新建诊断
          </button>
          <button
            type="button"
            disabled
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-xs text-ink-muted disabled:cursor-not-allowed"
          >
            <Archive size={14} />
            翻车博物馆
          </button>
        </div>
      </header>

      <main className="grid h-[calc(100vh-56px)] grid-cols-[320px_minmax(0,1fr)_380px] gap-3 p-3">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[10px] text-truth">01</span>
              <h2 className="text-sm font-medium tracking-wide">取证区</h2>
            </div>
            <span className="font-mono text-[10px] tracking-[0.18em] text-ink-muted">EVIDENCE</span>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[1.15fr_1fr_0.9fr] gap-3 p-3">
            <div className="relative flex min-h-0 items-center justify-center rounded-md border border-dashed border-line bg-bg/60 p-4">
              <M1Badge />
              <div className="flex flex-col items-center gap-3 text-center">
                <Image className="text-ink-muted" size={24} strokeWidth={1.4} />
                <p className="text-xs text-ink-muted">
                  失败图片 <span className="text-pruned">·</span> bbox 叠加层
                </p>
                <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted">IMAGE EVIDENCE</p>
              </div>
            </div>

            <div className="relative flex min-h-0 items-center justify-center rounded-md border border-dashed border-line bg-bg/60 p-4">
              <M1Badge />
              <div className="flex flex-col items-center gap-3 text-center">
                <FileText className="text-ink-muted" size={24} strokeWidth={1.4} />
                <p className="text-xs text-ink-muted">日志片段</p>
                <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted">LOG FRAGMENT</p>
              </div>
            </div>

            <div className="relative flex min-h-0 items-center justify-center rounded-md border border-dashed border-line bg-bg/60 p-4">
              <M1Badge />
              <div className="flex flex-col items-center gap-3 text-center">
                <ClipboardList className="text-ink-muted" size={24} strokeWidth={1.4} />
                <p className="text-xs text-ink-muted">症状卡片</p>
                <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted">SYMPTOM CARD</p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[10px] text-truth">02</span>
              <h2 className="text-sm font-medium tracking-wide">{activeCase}</h2>
            </div>
            <span className="font-mono text-[10px] tracking-[0.14em] text-ink-muted">CAUSAL TREE</span>
          </div>

          <div className="min-h-0 flex-1 p-3">
            <div className="relative flex h-full items-center justify-center rounded-md border border-dashed border-line bg-bg/60 p-6">
              <M1Badge />
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-panel text-ink-muted">
                  <GitBranch size={25} strokeWidth={1.3} />
                </div>
                <p className="text-sm text-ink-muted">React Flow 画布 · M1 接入三层因果树</p>
                <p className="font-mono text-[10px] tracking-[0.2em] text-ink-muted">CAUSAL TREE / OFFLINE</p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[10px] text-truth">03</span>
              <h2 className="text-sm font-medium tracking-wide">排查区</h2>
            </div>
            <span className="font-mono text-[10px] tracking-[0.18em] text-ink-muted">TRIAGE</span>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-2 gap-3 p-3">
            {[1, 2].map((question) => (
              <article
                key={question}
                className="relative flex min-h-0 flex-col justify-between overflow-hidden rounded-md border border-dashed border-line bg-bg/60 p-5"
              >
                <M1Badge />
                <div>
                  <div className="flex items-center gap-2 text-suspect">
                    <CircleHelp size={17} strokeWidth={1.5} />
                    <span className="font-mono text-[10px] tracking-[0.16em]">
                      QUESTION {String(question).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-medium text-ink">鉴别问题 {question}</h3>
                </div>
                <div className="border-t border-line pt-4">
                  <p className="font-mono text-xs text-ink-muted">howToCheck</p>
                  <p className="mt-2 text-[11px] text-pruned">等待鉴别流程接入</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

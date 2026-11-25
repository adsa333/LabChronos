import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

interface OnboardingGuideProps {
  open: boolean
  onExit: () => void
  onStepChange: (step: number) => void
}

interface SpotRect {
  top: number
  left: number
  width: number
  height: number
}

const STEPS = [
  {
    anchor: 'evidence',
    title: '01 · 客观取证与三向联动',
    body: '左侧先看实验图版与观测症状（支持点击放大和 KEY=VALUE 条件表）。鼠标悬停任意症状时，右侧水墨环与对应假设会同步朱砂高亮。',
  },
  {
    anchor: 'ring',
    title: '02 · 因果墨环与实时剪枝',
    body: '每段水墨弧对应一个候选假设，弧长与粗细反映实时后验概率；作答后概率低于 15% 的分支会自动剪枝淡出。',
  },
  {
    anchor: 'triage',
    title: '03 · 鉴别追问、处方与推送群馆',
    body: '点击选项或按键盘 1 / 2 / 3 快速排查。2–3 步锁定真因后，系统会给出「只改一个变量」的最小对照处方，支持导出复盘卡 PNG、存入独立馆，或一键「推送到课题组馆」与同门共享。',
  },
  {
    anchor: 'catalog',
    title: '04 · 病例目录与新建取证',
    body: '内置 3 个典型病例可零延迟切换；点击「+ 新建病例」可贴入你自己的实验日志与截图，调用 AI 实时生成因果故障树。',
  },
  {
    anchor: 'museum',
    title: '05 · 翻车博物馆与课题组共享馆',
    body: '点击进入翻车博物馆，可在「我的独立馆」「课题组共享馆（群馆）」「公共避坑库」间切换；加入课题组房间即可查看队友推送的失败存证并一键重演排查过程。',
  },
]

const CARD_W = 340
const GAP = 14
const MARGIN = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export default function OnboardingGuide({ open, onExit, onStepChange }: OnboardingGuideProps) {
  const [step, setStep] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)
  const [rect, setRect] = useState<SpotRect | null>(null)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [cardH, setCardH] = useState(220)
  const cardRef = useRef<HTMLDivElement>(null)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStep(0)
  }

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight)
  }, [step, rect, viewport, open])

  useEffect(() => {
    if (!open) return
    const measure = () => {
      const el = document.querySelector(`[data-tour="${STEPS[step].anchor}"]`)
      if (!el) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      setViewport({ w: window.innerWidth, h: window.innerHeight })
    }
    measure()
    const settle = window.setTimeout(() => {
      const el = document.querySelector(`[data-tour="${STEPS[step].anchor}"]`)
      el?.scrollIntoView({ block: 'nearest' })
      measure()
    }, 340)
    let frame = 0
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure() })
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      window.clearTimeout(settle)
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [open, step])

  useEffect(() => {
    if (!open) return
    onStepChange(step)
  }, [open, step, onStepChange])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'Escape') {
        onExit()
        return
      }
      if (event.key === 'ArrowRight') setStep((value) => Math.min(STEPS.length - 1, value + 1))
      if (event.key === 'ArrowLeft') setStep((value) => Math.max(0, value - 1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onExit])

  if (!open) return null

  const current = STEPS[step]
  const narrow = viewport.w < 1024
  let cardStyle: CSSProperties
  if (narrow || !rect) {
    cardStyle = { left: MARGIN, right: MARGIN, bottom: 84, width: 'auto' }
  } else {
    const right = rect.left + rect.width
    const bottom = rect.top + rect.height
    let left: number
    let top: number
    if (right + GAP + CARD_W <= viewport.w - MARGIN) {
      left = right + GAP
      top = clamp(rect.top, MARGIN, viewport.h - cardH - MARGIN)
    } else if (rect.left - GAP - CARD_W >= MARGIN) {
      left = rect.left - GAP - CARD_W
      top = clamp(rect.top, MARGIN, viewport.h - cardH - MARGIN)
    } else if (bottom + GAP + cardH <= viewport.h - MARGIN) {
      left = clamp(rect.left, MARGIN, viewport.w - CARD_W - MARGIN)
      top = bottom + GAP
    } else {
      left = clamp(rect.left, MARGIN, viewport.w - CARD_W - MARGIN)
      top = clamp(rect.top - GAP - cardH, MARGIN, viewport.h - cardH - MARGIN)
    }
    cardStyle = { left, top, width: CARD_W }
  }

  function next() {
    if (step === STEPS.length - 1) onExit()
    else setStep(step + 1)
  }

  return (
    <>
      {rect && (
        <div
          className="tour-spot"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
          aria-hidden="true"
        >
          <span className="plate-corner" style={{ top: -1, left: -1, borderWidth: '1.5px 0 0 1.5px', borderColor: 'var(--seal)' }} />
          <span className="plate-corner" style={{ top: -1, right: -1, borderWidth: '1.5px 1.5px 0 0', borderColor: 'var(--seal)' }} />
          <span className="plate-corner" style={{ bottom: -1, left: -1, borderWidth: '0 0 1.5px 1.5px', borderColor: 'var(--seal)' }} />
          <span className="plate-corner" style={{ bottom: -1, right: -1, borderWidth: '0 1.5px 1.5px 0', borderColor: 'var(--seal)' }} />
        </div>
      )}
      <div ref={cardRef} role="region" aria-label="新手导览" className="tour-card border-[1.5px] rule-strong-border surface-plate p-4" style={cardStyle}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono-tab text-[10px] tracking-[0.16em] seal-text">
            {String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
          </span>
          <button type="button" onClick={onExit} className="btn-ghost px-2 py-1 text-[10px]">跳过引导</button>
        </div>
        <h3 className="mt-2 font-display text-sm font-semibold text-main">{current.title}</h3>
        <p className="mt-1.5 text-[11px] leading-5 text-sub">{current.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2 border-t rule-border pt-3">
          <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0} className="btn-ghost px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            上一步
          </button>
          <button type="button" onClick={next} className="btn-primary px-3 py-1.5 text-xs">
            {step === STEPS.length - 1 ? '开始实操' : '下一步'}
          </button>
        </div>
        <p className="mt-2 font-mono-tab text-[9px] text-aux">Esc 跳过 · ← / → 切换步骤</p>
      </div>
    </>
  )
}
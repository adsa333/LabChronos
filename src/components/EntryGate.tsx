import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { presets } from '../data/presets'
import { getLeadingHypothesis, scoreHypotheses } from '../lib/scoring'
import type { Answers } from '../lib/scoring'

interface EntryGateProps {
  theme: 'ink' | 'lumen'
  onToggleTheme: () => void
  onEnterCase: (presetId: string) => void
  onEnterNewCase: () => void
}

const DEMO_ANSWERS: Record<string, Answers> = {
  'ai-training-nan': { q1: 1, q2: 0 },
  'gel-electrophoresis-smearing': { q1: 0, q2: 1 },
  'oscilloscope-ringing': { q1: 1, q2: 0 },
}

const TAGS = ['Loss → NaN', '500 ng 过载', '25 MHz 谐振']
const SIZE = 340
const CENTER = SIZE / 2
const R = 116
const TAU = Math.PI * 2

function random(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function hexRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function css(color: [number, number, number]): string {
  return `rgb(${color[0] | 0},${color[1] | 0},${color[2] | 0})`
}

function readPalette() {
  const styles = getComputedStyle(document.body)
  const value = (name: string) => hexRgb(styles.getPropertyValue(name).trim())
  return { ink: value('--ink'), teal: value('--teal'), seal: value('--seal') }
}

function AiPlate() {
  return (
    <svg viewBox="0 0 120 44" className="h-auto w-full">
      <line x1="6" y1="38" x2="114" y2="38" className="pl-hair" />
      <polyline className="pl-line" points="8,14 26,22 44,28 62,33 74,8" />
      <circle cx="74" cy="8" r="2.5" style={{ fill: 'var(--seal)' }} />
      <line x1="74" y1="6" x2="74" y2="38" className="pl-seal" strokeDasharray="2 2" />
      <polyline className="pl-teal" strokeDasharray="2 2" points="62,33 88,35 112,36" />
    </svg>
  )
}

function GelPlate() {
  return (
    <svg viewBox="0 0 120 44" className="h-auto w-full">
      <defs>
        <linearGradient id="entry-gel-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" className="pl-stop" stopOpacity=".75" />
          <stop offset="1" className="pl-stop" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="6" y="4" width="108" height="36" className="pl-hair" />
      <rect x="18" y="28" width="14" height="3" className="pl-fill" opacity=".7" />
      <rect x="44" y="10" width="16" height="22" fill="url(#entry-gel-grad)" />
      <rect x="43" y="27" width="18" height="5" rx="2" className="pl-fill" />
      <rect x="68" y="10" width="16" height="22" fill="url(#entry-gel-grad)" />
      <rect x="67" y="27" width="18" height="5" rx="2" className="pl-fill" />
      <rect x="92" y="28" width="14" height="3" className="pl-fill" opacity=".7" />
      <rect x="40" y="8" width="48" height="27" className="pl-seal" strokeDasharray="2 2" />
    </svg>
  )
}

function ScopePlate() {
  return (
    <svg viewBox="0 0 120 44" className="h-auto w-full">
      <line x1="6" y1="22" x2="114" y2="22" className="pl-hair" strokeDasharray="2 2" />
      <polyline className="pl-line" points="8,34 12,8 17,28 22,12 27,24 32,16 38,20 46,18 64,18 68,38 73,20 78,34 84,24 90,32 100,30 112,30" />
      <rect x="9" y="6" width="26" height="24" className="pl-seal" strokeDasharray="2 2" />
    </svg>
  )
}

const PLATES = [AiPlate, GelPlate, ScopePlate]

export default function EntryGate({ theme, onToggleTheme, onEnterCase, onEnterNewCase }: EntryGateProps) {
  const [activeId, setActiveId] = useState(presets[0].id)
  const [pruned, setPruned] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mouseRef = useRef({ x: CENTER, y: CENTER, active: false })
  const stateRef = useRef({ activeId, pruned, theme, reducedMotion })
  const exitTimerRef = useRef(0)

  const data = useMemo(() => presets.map((preset) => ({
    prior: scoreHypotheses(preset.diagnosis, {}),
    post: scoreHypotheses(preset.diagnosis, DEMO_ANSWERS[preset.id] ?? {}),
  })), [])

  useLayoutEffect(() => {
    stateRef.current = { activeId, pruned, theme, reducedMotion }
  }, [activeId, pruned, theme, reducedMotion])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => () => window.clearTimeout(exitTimerRef.current), [])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const dx = event.clientX - cx
      const dy = event.clientY - cy
      const deg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360
      const rad = Math.min(1, Math.hypot(dx, dy) / Math.hypot(cx, cy))
      if (readoutRef.current) readoutRef.current.textContent = `θ ${deg.toFixed(1).padStart(5, '0')}° · r ${rad.toFixed(2)}`
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [])

  function beginExit(action: () => void) {
    if (exiting) return
    setExiting(true)
    exitTimerRef.current = window.setTimeout(action, reducedMotion ? 150 : 550)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || exiting) return
      const target = event.target as HTMLElement | null
      if (target && ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      beginExit(() => onEnterCase(activeId))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const segments = presets.map((_, index) => ({
      current: { p: 0.25, w: 0.25, dis: 0, win: 0 },
      strokes: Array.from({ length: 34 }, (_, stroke) => {
        const seed = index * 37 + stroke
        const u = random(seed, 1) * 2 - 1
        return {
          offset: Math.sign(u) * Math.pow(Math.abs(u), 0.85),
          alpha: 0.14 + random(seed, 2) * 0.3,
          width: 0.65 + random(seed, 3) * 1.5,
          phase: random(seed, 4) * TAU,
          dry: Math.abs(u) > 0.42 && random(seed, 5) < 0.65 ? [12 + random(seed, 6) * 44, 2 + random(seed, 7) * 9] : null,
        }
      }),
      particles: Array.from({ length: 320 }, (_, particle) => {
        const seed = index * 211 + particle
        return {
          t: random(seed, 8),
          v: 0.004 + random(seed, 9) * 0.009,
          l: (random(seed, 10) * 2 - 1) * 1.25,
          drift: 0.35 + random(seed, 11),
          dang: (random(seed, 12) - 0.5) * 1.1,
          size: 0.75 + random(seed, 13) * 1.25,
        }
      }),
    }))
    let winA = 0
    let frame = 0
    let palette: ReturnType<typeof readPalette> | undefined
    let paletteTheme = ''

    function requestDraw() {
      if (!frame && !document.hidden) frame = requestAnimationFrame(draw)
    }

    function draw(time: number) {
      frame = 0
      if (!canvas || !context) return
      const state = stateRef.current
      const reduce = state.reducedMotion
      const index = Math.max(0, presets.findIndex((preset) => preset.id === state.activeId))
      const scores = state.pruned ? data[index].post : data[index].prior
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const pixels = Math.round(SIZE * dpr)
      if (canvas.width !== pixels || canvas.height !== pixels) {
        canvas.width = pixels
        canvas.height = pixels
      }
      if (!palette || paletteTheme !== state.theme) {
        palette = readPalette()
        paletteTheme = state.theme
      }
      const dark = state.theme === 'lumen'
      const T = reduce ? 0 : time / 1000
      context.setTransform(pixels / SIZE, 0, 0, pixels / SIZE, 0, 0)
      context.clearRect(0, 0, SIZE, SIZE)

      segments.forEach((segment, i) => {
        const probability = scores[i].probability
        const isWin = state.pruned && i === 0
        const target = {
          p: probability,
          w: state.pruned ? (isWin ? 1 : 0.0001) : probability,
          dis: state.pruned && !isWin ? 1 : 0,
          win: isWin ? 1 : 0,
        }
        const ease = (from: number, to: number, rate: number) => reduce ? to : from + (to - from) * rate
        segment.current = {
          p: ease(segment.current.p, target.p, 0.075),
          w: ease(segment.current.w, target.w, 0.055),
          dis: ease(segment.current.dis, target.dis, 0.04),
          win: ease(segment.current.win, target.win, 0.055),
        }
      })
      winA = reduce ? (state.pruned ? 1 : 0) : winA + ((state.pruned ? 1 : 0) - winA) * 0.055

      context.strokeStyle = dark ? 'rgba(226,232,240,0.16)' : 'rgba(25,23,20,0.18)'
      context.lineWidth = 0.75
      context.beginPath()
      context.arc(CENTER, CENTER, R + 34, 0, TAU)
      context.stroke()
      const rot = T * 0.035
      for (let degree = 0; degree < 360; degree += 5) {
        const angle = degree * Math.PI / 180 + rot
        const len = degree % 30 === 0 ? 7 : degree % 15 === 0 ? 4.5 : 2.2
        context.beginPath()
        context.moveTo(CENTER + Math.cos(angle) * (R + 34), CENTER + Math.sin(angle) * (R + 34))
        context.lineTo(CENTER + Math.cos(angle) * (R + 34 + len), CENTER + Math.sin(angle) * (R + 34 + len))
        context.stroke()
      }
      context.setLineDash([2, 5])
      context.beginPath()
      context.arc(CENTER, CENTER, R - 26, 0, TAU)
      context.stroke()
      context.setLineDash([])
      context.fillStyle = dark ? 'rgba(226,232,240,0.45)' : 'rgba(25,23,20,0.42)'
      context.font = '8.5px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
      context.textAlign = 'center'
      context.fillText('000°', CENTER, CENTER - R - 42)
      context.fillText('180°', CENTER, CENTER + R + 49)

      const gapEach = 0.11 * (1 - winA)
      const opening = 0.44 * winA
      const total = TAU - gapEach * 4 - opening
      const sumW = segments.reduce((sum, segment) => sum + segment.current.w, 0)
      let angle = -Math.PI / 2 + opening / 2 + gapEach / 2 + 0.35 * winA + Math.sin(T * 0.25) * 0.04
      const geometry = segments.map((segment) => {
        const span = total * segment.current.w / sumW
        const start = angle
        angle += span + gapEach
        return { start, span }
      })

      const mouse = mouseRef.current
      const mouseActive = mouse.active && !reduce
      if (dark) context.globalCompositeOperation = 'lighter'
      segments.forEach((segment, i) => {
        const a = segment.current
        const g = geometry[i]
        const half = (4 + a.p * 24) * (1 + a.win * 0.28) / 2
        const alpha = (1 - a.dis * 0.93) * (dark ? 0.72 : 1)
        if (alpha < 0.02 || g.span < 0.01) return
        let color = mix(palette!.ink, palette!.teal, a.win)
        if (!state.pruned && i === 0) color = mix(color, palette!.seal, 0.22)
        context.strokeStyle = css(color)
        context.lineCap = 'round'
        segment.strokes.forEach((stroke) => {
          context.globalAlpha = stroke.alpha * alpha
          context.lineWidth = stroke.width
          context.setLineDash(stroke.dry ?? [])
          context.beginPath()
          const steps = Math.max(10, Math.ceil(g.span * R / 4))
          for (let k = 0; k <= steps; k++) {
            const t = k / steps
            const theta = g.start + g.span * t
            const radius = R + stroke.offset * half + Math.sin(t * 7 + stroke.phase + T * 0.4) * half * 0.09
            let x = CENTER + Math.cos(theta) * radius
            let y = CENTER + Math.sin(theta) * radius
            if (mouseActive) {
              const dx = x - mouse.x
              const dy = y - mouse.y
              const dist = Math.hypot(dx, dy)
              if (dist < 64 && dist > 1) {
                const push = (1 - dist / 64) * 5.5
                x += (dx / dist) * push
                y += (dy / dist) * push
              }
            }
            if (k) context.lineTo(x, y)
            else context.moveTo(x, y)
          }
          context.stroke()
        })
        context.setLineDash([])
      })

      segments.forEach((segment, i) => {
        const a = segment.current
        const g = geometry[i]
        const thickness = 4 + a.p * 24
        let color = mix(palette!.ink, palette!.teal, a.win)
        if (!state.pruned && i === 0) color = mix(color, palette!.seal, 0.35)
        context.fillStyle = css(color)
        segment.particles.forEach((particle) => {
          const t = (particle.t + T * particle.v) % 1
          const taper = Math.pow(Math.sin(Math.PI * t), 0.5)
          const theta = g.start + g.span * t + a.dis * particle.dang * 0.55
          const radius = R + particle.l * thickness * 0.5 * taper + a.dis * particle.drift * 36
          let x = CENTER + Math.cos(theta) * radius
          let y = CENTER + Math.sin(theta) * radius - a.dis * particle.drift * 14
          if (mouseActive) {
            const dx = x - mouse.x
            const dy = y - mouse.y
            const dist = Math.hypot(dx, dy)
            if (dist < 82 && dist > 1) {
              const f = (1 - dist / 82) * 16
              x += (dx / dist) * f - (dy / dist) * f * 0.35
              y += (dy / dist) * f + (dx / dist) * f * 0.35
            }
          }
          context.globalAlpha = (dark ? 0.45 : 0.34) * taper * (1 - a.dis * 0.62)
          context.fillRect(x, y, particle.size, particle.size)
        })
      })
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
      requestDraw()
    }

    function onVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else requestDraw()
    }

    requestDraw()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [data])

  const activeIndex = Math.max(0, presets.findIndex((preset) => preset.id === activeId))
  const active = presets[activeIndex]
  const shown = pruned ? data[activeIndex].post : data[activeIndex].prior
  const leader = getLeadingHypothesis(shown)
  const leaderHypothesis = active.diagnosis.hypotheses.find((item) => item.id === leader.id)
  const Plate = PLATES[activeIndex]
  const percent = (leader.probability * 100).toFixed(1)

  function selectSpec(id: string) {
    if (id === activeId) return
    setActiveId(id)
    setPruned(false)
  }

  return (
    <div className="surface-desk flex min-h-screen items-center justify-center p-2.5 pb-9 sm:p-4 sm:pb-9 lg:h-screen">
      <div className={`cover-shell flex w-full max-w-[1420px] flex-col lg:h-full lg:overflow-hidden ${exiting ? 'exiting' : ''}`}>
        <header className="double-rule relative z-20 flex flex-wrap items-center justify-between gap-4 px-6 py-4 sm:px-9">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center border-[1.5px] rule-strong-border surface-plate">
              <FlaskConical size={15} className="text-main" />
            </div>
            <div>
              <div className="flex items-baseline gap-2.5">
                <span className="font-display text-xl font-bold leading-none tracking-tight text-main">LabChronos</span>
                <span className="font-mono-tab text-[10px] uppercase tracking-[0.2em] text-aux">VOL. 2026 · STUDYHACK</span>
              </div>
              <div className="mt-0.5 font-mono-tab text-[10px] text-aux">实验失败因果取证台 · FAILURE FORENSICS</div>
            </div>
          </div>
          <div className="hidden items-center gap-4 font-mono-tab text-[10.5px] text-aux md:flex">
            <span>FIELD <b ref={readoutRef} className="text-sub">θ 042.0° · r 0.00</b></span>
            <span>|</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--teal)' }} />
              无需登录 · 0 延迟内置病例
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onToggleTheme} className="mini-btn font-mono-tab">{theme === 'ink' ? '纸 ／ 光' : '光 ／ 纸'}</button>
            <button type="button" onClick={() => beginExit(() => onEnterCase(activeId))} className="ml-1 font-mono-tab text-xs font-semibold underline text-main">跳过进入 →</button>
          </div>
        </header>

        <main className="entry-main relative z-10 grid flex-1 grid-cols-1 items-center gap-8 px-6 py-6 sm:px-9 lg:grid-cols-12 lg:py-7">
          <div className="entry-left flex flex-col justify-center gap-6 lg:col-span-7">
            <div className="reveal-1 flex flex-wrap items-center gap-3">
              <span className="seal-solid px-2.5 py-1 font-mono-tab text-[10.5px] font-bold uppercase tracking-[0.2em]">EXPERIMENTAL FORENSICS</span>
              <span className="font-mono-tab text-[11px] uppercase tracking-[0.16em] text-aux">不是聊天框 · 是可剪枝的科学故障树</span>
            </div>
            <div className="reveal-2 space-y-3">
              <h1 className="entry-title font-display text-4xl font-bold leading-[1.15] tracking-tight text-main sm:text-5xl xl:text-[56px]">
                让每一次实验翻车，<br />
                都收敛为<span className="seal-text border-b-2 pb-[2px]" style={{ borderColor: 'var(--seal)' }}>可验证的真因</span>。
              </h1>
              <p className="font-display text-base italic text-sub sm:text-lg">
                Drop a failed curve, gel, waveform, or log — prune false hypotheses in two questions, and get a single-variable control experiment.
              </p>
              <p className="max-w-[580px] text-sm leading-relaxed text-sub">
                别人帮你写论文，我们帮你查明实验为什么翻车。丢入失败截图或日志，系统生成互斥假设与水墨概率环；回答 2 道低成本鉴别追问，实时剪除干扰分支，锁定真因并给出<strong className="text-main">只改 1 个变量</strong>的最小对照处方。
              </p>
            </div>
            <div className="reveal-3 flex flex-wrap items-center gap-3.5 pt-1">
              <button type="button" onClick={() => beginExit(() => onEnterCase(activeId))} className="cta-primary">
                <span>启卷 · 进入取证台</span>
                <span className="font-mono-tab text-base leading-none">→</span>
              </button>
              <button type="button" onClick={() => beginExit(onEnterNewCase)} className="cta-ghost">
                <span className="seal-text font-mono-tab font-bold">+</span>
                <span>直接上传我的失败实验</span>
              </button>
            </div>
            <div className="reveal-4 space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <span className="font-mono-tab text-[10.5px] uppercase tracking-[0.18em] text-aux">或点选经典翻车病例直达（悬停右侧星仪实时联动）</span>
                <span className="hidden font-mono-tab text-[10.5px] text-aux sm:inline">0 秒加载 · 已科学复核</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {presets.map((preset, index) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-spec-id={preset.id}
                    onPointerEnter={(event) => { if (event.pointerType === 'mouse') selectSpec(preset.id) }}
                    onFocus={() => selectSpec(preset.id)}
                    onClick={() => beginExit(() => onEnterCase(preset.id))}
                    className={`spec-card ${activeId === preset.id ? 'active' : ''}`}
                  >
                    <div className="mb-1 font-mono-tab text-[10px] text-aux">NO.{String(index + 1).padStart(3, '0')} · {preset.diagnosis.domain}</div>
                    <div className="font-display text-sm font-bold text-main">{preset.label}</div>
                    <div className="mt-1 flex items-center justify-between font-mono-tab text-[10.5px] text-sub">
                      <span>{TAGS[index]}</span>
                      <span className="seal-text">直达 →</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="relative flex flex-col items-center justify-center lg:col-span-5">
            <div className="relative flex w-full max-w-[460px] flex-col items-center border rule-border p-4 surface-plate sm:p-5">
              <span className="entry-corner -left-px -top-px" style={{ borderWidth: '1.5px 0 0 1.5px' }} />
              <span className="entry-corner -right-px -top-px" style={{ borderWidth: '1.5px 1.5px 0 0' }} />
              <span className="entry-corner -bottom-px -left-px" style={{ borderWidth: '0 0 1.5px 1.5px' }} />
              <span className="entry-corner -bottom-px -right-px" style={{ borderWidth: '0 1.5px 1.5px 0' }} />
              <div className="mb-2 flex w-full items-center justify-between border-b rule-border pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 font-mono-tab text-[10.5px] font-bold" style={{ background: 'var(--ink)', color: 'var(--bg-folio)' }}>NO.{String(activeIndex + 1).padStart(3, '0')}</span>
                  <span className="font-mono-tab text-[10.5px] text-sub">{active.diagnosis.domain}</span>
                </div>
                <span className={`font-mono-tab text-[10.5px] font-semibold ${pruned ? 'teal-text' : 'seal-text'}`}>
                  {pruned ? '● 2 步收敛 · 真因锁定' : '● 先验分布（4 假设）'}
                </span>
              </div>

              <div
                ref={wrapRef}
                className="entry-astrolabe relative my-1 flex items-center justify-center"
                onPointerMove={(event) => {
                  const rect = wrapRef.current?.getBoundingClientRect()
                  if (!rect) return
                  mouseRef.current = {
                    x: ((event.clientX - rect.left) / rect.width) * SIZE,
                    y: ((event.clientY - rect.top) / rect.height) * SIZE,
                    active: true,
                  }
                }}
                onPointerLeave={() => { mouseRef.current.active = false }}
              >
                <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-12 text-center">
                  <div className="mb-1.5 w-[122px] opacity-90"><Plate /></div>
                  <div className="flex items-baseline gap-1">
                    <span className={`font-display text-4xl font-bold leading-none ${pruned ? 'teal-text' : 'text-main'}`}>{percent}</span>
                    <span className="font-display text-base text-main">%</span>
                  </div>
                  <div className="mt-1 max-w-[165px] truncate text-[11.5px] font-semibold leading-tight text-main">
                    {pruned ? `真因 · ${leaderHypothesis?.title}` : `最高候选 · ${leaderHypothesis?.title}`}
                  </div>
                </div>
                <div className={`entry-seal font-display ${pruned ? 'stamped' : ''}`} style={{ left: 16, bottom: 24 }}>真因</div>
              </div>

              <div className="mt-1 w-full space-y-2.5 border-t rule-border pt-3">
                <div className="grid grid-cols-2 gap-1.5 font-mono-tab text-[10.5px]">
                  {active.diagnosis.hypotheses.map((hypothesis, i) => {
                    const score = shown.find((item) => item.id === hypothesis.id)!
                    const value = score.probability * 100
                    const isPruned = pruned && value < 15
                    const isWin = pruned && i === 0
                    return (
                      <div
                        key={hypothesis.id}
                        className="flex items-center justify-between gap-1 px-2 py-1.5 transition"
                        style={{
                          border: `1px ${isPruned ? 'dashed' : 'solid'} ${isWin ? 'var(--teal)' : 'var(--rule)'}`,
                          background: isWin ? 'var(--teal-soft)' : 'var(--bg-folio)',
                          opacity: isPruned ? 0.38 : 1,
                        }}
                      >
                        <span className={`truncate ${isPruned ? 'line-through' : ''} ${isWin ? 'teal-text' : 'text-main'}`}>{hypothesis.id.toUpperCase()} {hypothesis.title}</span>
                        <span className={`shrink-0 font-bold ${isWin ? 'teal-text' : 'text-sub'}`}>{value.toFixed(1)}%</span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPruned((value) => !value)}
                    className="flex flex-1 items-center justify-center gap-2 border-[1.25px] rule-strong-border surface-folio px-3 py-2 text-xs font-semibold text-main transition hover:surface-tint"
                  >
                    <span className="seal-text">✦</span>
                    <span>{pruned ? '重置为初始先验状态 ↺' : '点击体验 2 秒水墨剪枝'}</span>
                  </button>
                  <button type="button" onClick={() => beginExit(() => onEnterCase(activeId))} className="seal-solid border-[1.25px] px-3.5 py-2 font-mono-tab text-xs font-semibold" style={{ borderColor: 'var(--seal)' }}>
                    进入此例 →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="relative z-20 flex flex-wrap items-center justify-between gap-4 border-t-[1.5px] rule-strong-border px-6 py-3.5 surface-tint sm:px-9">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 font-mono-tab text-[11px] text-sub">
            <span><b className="text-main">15/15</b> 跨学科 Schema 合法</span>
            <span><b className="teal-text">86.7%</b> 真因 Top-1 命中</span>
            <span><b className="text-main">~10s</b> 真实多模态推理</span>
            <span><b className="seal-text">1 变量</b> 最小对照实验处方</span>
          </div>
          <div className="font-mono-tab text-[10.5px] text-aux">
            移动鼠标拨动墨尘 · 按 <b className="text-main">Enter</b> 立即启卷
          </div>
        </footer>
      </div>
    </div>
  )
}
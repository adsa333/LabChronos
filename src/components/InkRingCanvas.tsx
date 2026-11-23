import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cubicBezier, motion } from 'framer-motion'
import type { HypothesisScore } from '../lib/scoring'
import type { Hypothesis } from '../types/diagnosis'

interface InkRingCanvasProps {
  hypotheses: Hypothesis[]
  scores: HypothesisScore[]
  prunedIds: string[]
  lockedId: string | null
  answeredCount: number
  theme: 'ink' | 'lumen'
  hoveredSymptomId: string | null
  hoveredHypothesisId: string | null
}

interface RingState {
  probability: number
  fade: number
  expansion: number
}

const SIZE = 204
const CENTER = SIZE / 2
const TAU = Math.PI * 2
const easeOut = cubicBezier(0.23, 1, 0.32, 1)

function random(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function readPalette() {
  const styles = getComputedStyle(document.body)
  const value = (name: string) => styles.getPropertyValue(name).trim()
  return { ink: value('--ink'), rule: value('--rule'), seal: value('--seal'), teal: value('--teal') }
}

export default function InkRingCanvas(props: InkRingCanvasProps) {
  const { hypotheses, scores, lockedId } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  const requestDrawRef = useRef<() => void>(() => {})
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const reducedMotionRef = useRef(reducedMotion)

  useLayoutEffect(() => {
    propsRef.current = props
    reducedMotionRef.current = reducedMotion
    requestDrawRef.current()
  }, [props, reducedMotion])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const segments = hypotheses.map((hypothesis, index) => {
      const initial: RingState = {
        probability: propsRef.current.scores.find((score) => score.id === hypothesis.id)!.probability,
        fade: 0,
        expansion: 0,
      }
      return {
        hypothesis,
        current: { ...initial },
        from: { ...initial },
        target: { ...initial },
        started: 0,
        strokes: Array.from({ length: 27 }, (_, stroke) => {
          const seed = index * 31 + stroke
          return {
            offset: (stroke + 0.5) / 27 - 0.5,
            alpha: 0.22 + random(seed, 1) * 0.4,
            width: 0.6 + random(seed, 2) * 0.6,
            dash: [2 + random(seed, 3) * 10, 1 + random(seed, 4) * 5],
            phase: random(seed, 5) * 20,
            trim: random(seed, 6) * 0.035,
          }
        }),
        particles: Array.from({ length: 200 }, (_, particle) => {
          const seed = index * 211 + particle
          return {
            position: random(seed, 7),
            offset: random(seed, 8) - 0.5,
            phase: random(seed, 9) * TAU,
            size: 0.2 + random(seed, 10) * 0.6,
            alpha: 0.15 + random(seed, 11) * 0.35,
            drift: 7 + random(seed, 12) * 12,
          }
        }),
      }
    })

    let frame = 0
    let palette: ReturnType<typeof readPalette> | undefined
    let paletteTheme = ''

    function requestDraw() {
      if (!frame && !document.hidden) frame = requestAnimationFrame(draw)
    }

    function draw(time: number) {
      frame = 0
      if (!canvas || !context) return
      const current = propsRef.current
      const reduce = reducedMotionRef.current
      const dpr = window.devicePixelRatio || 1
      const pixels = Math.round(SIZE * dpr)
      if (canvas.width !== pixels || canvas.height !== pixels) {
        canvas.width = pixels
        canvas.height = pixels
      }
      // Read after parent effects have applied the body theme.
      if (!palette || paletteTheme !== current.theme) {
        palette = readPalette()
        paletteTheme = current.theme
      }
      context.setTransform(pixels / SIZE, 0, 0, pixels / SIZE, 0, 0)
      context.clearRect(0, 0, SIZE, SIZE)
      context.globalCompositeOperation = 'source-over'
      context.strokeStyle = palette.rule
      context.lineWidth = 0.8
      context.setLineDash([])
      context.lineDashOffset = 0
      for (let degree = 0; degree < 360; degree += 10) {
        const angle = degree * Math.PI / 180 - Math.PI / 2
        const long = degree % 30 === 0
        const inner = long ? 89 : 93
        context.globalAlpha = long ? 0.9 : 0.5
        context.beginPath()
        context.moveTo(CENTER + Math.cos(angle) * inner, CENTER + Math.sin(angle) * inner)
        context.lineTo(CENTER + Math.cos(angle) * 97, CENTER + Math.sin(angle) * 97)
        context.stroke()
      }
      context.globalAlpha = 0.55
      context.setLineDash([2, 5])
      context.beginPath()
      context.arc(CENTER, CENTER, 55, 0, TAU)
      context.stroke()
      context.setLineDash([])

      let animating = false
      segments.forEach((segment) => {
        const score = current.scores.find((item) => item.id === segment.hypothesis.id)!
        const locked = current.lockedId === score.id
        const pruned = current.answeredCount > 0 && current.prunedIds.includes(score.id)
        const target: RingState = {
          probability: score.probability,
          fade: locked ? 0 : current.lockedId || pruned ? 1 : 0,
          expansion: locked ? 1 : 0,
        }
        if (target.probability !== segment.target.probability || target.fade !== segment.target.fade || target.expansion !== segment.target.expansion) {
          segment.from = { ...segment.current }
          segment.target = target
          segment.started = time
        }
        const progress = reduce ? 1 : Math.min(1, (time - segment.started) / 250)
        const eased = easeOut(progress)
        segment.current = {
          probability: segment.from.probability + (target.probability - segment.from.probability) * eased,
          fade: segment.from.fade + (target.fade - segment.from.fade) * eased,
          expansion: segment.from.expansion + (target.expansion - segment.from.expansion) * eased,
        }
        if (progress < 1) animating = true
      })

      const colors = palette
      const gap = 0.045
      const available = TAU - gap * segments.length
      let cursor = -Math.PI / 2
      context.globalCompositeOperation = current.theme === 'lumen' ? 'lighter' : 'source-over'
      segments.forEach(({ hypothesis, current: state, strokes, particles }) => {
        const { probability, fade, expansion } = state
        const baseStart = cursor + gap / 2
        const baseSweep = probability * available
        cursor += baseSweep + gap
        const start = baseStart + (-Math.PI / 2 + 0.12 - baseStart) * expansion
        const sweep = baseSweep + (TAU - 0.24 - baseSweep) * expansion
        const hovered = current.hoveredHypothesisId === hypothesis.id || Boolean(current.hoveredSymptomId && hypothesis.evidenceFor.includes(current.hoveredSymptomId))
        const color = hovered ? colors.seal : hypothesis.id === current.lockedId ? colors.teal : colors.ink
        const alpha = hovered && !current.lockedId ? Math.max(0.5, 1 - fade) : 1 - fade
        const thickness = probability * 32
        context.strokeStyle = color
        context.fillStyle = color

        if (alpha > 0.001 && sweep > 0) {
          strokes.forEach((stroke) => {
            const trim = Math.min(sweep / 4, stroke.trim)
            context.globalAlpha = alpha * stroke.alpha
            context.lineWidth = Math.max(0.18, thickness / 27 * stroke.width)
            context.setLineDash(stroke.dash)
            context.lineDashOffset = stroke.phase
            context.beginPath()
            context.arc(CENTER, CENTER, 74 + stroke.offset * thickness, start + trim, start + sweep - trim)
            context.stroke()
          })
        }
        context.setLineDash([])
        context.lineDashOffset = 0

        if (fade < 0.999) {
          const clock = reduce ? 0 : time * 0.0006
          particles.forEach((particle) => {
            const angle = start + sweep * particle.position + Math.sin(clock + particle.phase) * 0.004
            const radius = 74 + particle.offset * (thickness + 3) + (reduce ? 0 : fade * particle.drift + Math.sin(clock + particle.phase) * 0.6)
            context.globalAlpha = (1 - fade) * particle.alpha
            context.beginPath()
            context.arc(CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius, particle.size, 0, TAU)
            context.fill()
          })
        }
      })
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
      if (!reduce && (animating || !current.lockedId)) requestDraw()
    }

    function onVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else requestDraw()
    }

    requestDrawRef.current = requestDraw
    requestDraw()
    window.addEventListener('resize', requestDraw)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelAnimationFrame(frame)
      requestDrawRef.current = () => {}
      window.removeEventListener('resize', requestDraw)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [hypotheses])

  const leading = scores.reduce((best, score) => score.probability > best.probability ? score : best, scores[0])
  const shownScore = scores.find((score) => score.id === lockedId) ?? leading
  const percent = (shownScore.probability * 100).toFixed(1)

  return (
    <div className="relative h-[204px] w-[204px] shrink-0" role="img" aria-label={`因果墨环：${shownScore.id}，${percent}%，${lockedId ? '已锁定真因' : '当前最高假设'}`}>
      <canvas ref={canvasRef} className="block h-[204px] w-[204px]" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className={`font-display text-[34px] font-bold leading-tight tabular-nums ${lockedId ? 'teal-text' : 'text-main'}`}>{percent}%</span>
        <span className="mt-1 max-w-[110px] truncate font-mono-tab text-[10px] uppercase text-aux">{shownScore.id} · {lockedId ? 'LOCKED' : 'LEADING'}</span>
      </div>
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ opacity: lockedId ? 1 : 0, transform: `rotate(-8deg) scale(${lockedId || reducedMotion ? 1 : 0.95})` }}
        transition={reducedMotion ? { duration: 0.15 } : { type: 'spring', mass: 1, stiffness: 100, damping: 10 }}
        className="pointer-events-none absolute bottom-5 left-4 border-[1.5px] px-1.5 py-1 font-display text-xs font-bold seal-text"
        style={{ borderColor: 'var(--seal)' }}
      >真因</motion.span>
    </div>
  )
}

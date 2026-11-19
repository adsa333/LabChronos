import type { Answers, HypothesisScore } from './scoring'
import type { DiagnosisResult } from '../types/diagnosis'

export interface RecapInput {
  diagnosis: DiagnosisResult
  scores: HypothesisScore[]
  lockedId: string
  answers: Answers
  image: Blob | null
  exportedAt: number
}

const WIDTH = 1080
const HEIGHT = 1350
const MARGIN = 72
const COLORS = {
  bg: '#0B0F14',
  panel: '#121821',
  line: '#1E2A36',
  truth: '#10B981',
  suspect: '#F59E0B',
  pruned: '#4B5563',
  ink: '#E6EDF3',
  inkMuted: '#8A9AA8',
  imageBg: '#05080B',
}
const MONO = '"JetBrains Mono", monospace'
const SANS = 'system-ui, "Microsoft YaHei", sans-serif'

function font(size: number, weight = '400', family = SANS): string {
  return `${weight} ${size}px ${family}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDateTime(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatFileStamp(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 0 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1)
  return `${value}…`
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const char of Array.from(text)) {
    if (current && ctx.measureText(current + char).width > maxWidth) {
      const spaceAt = current.lastIndexOf(' ')
      if (spaceAt > 0 && current.length - spaceAt <= 20) {
        lines.push(current.slice(0, spaceAt))
        current = current.slice(spaceAt + 1) + char
      } else {
        lines.push(current)
        current = char
      }
    } else {
      current += char
    }
  }
  if (current) lines.push(current)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = truncate(ctx, kept[maxLines - 1], maxWidth)
  return kept
}

function drawTruncated(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  ctx.fillText(truncate(ctx, text, maxWidth), x, y)
}

async function drawEvidenceImage(ctx: CanvasRenderingContext2D, image: Blob | null, x: number, y: number, width: number, height: number): Promise<void> {
  ctx.fillStyle = COLORS.imageBg
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  if (!image) {
    ctx.save()
    ctx.setLineDash([6, 6])
    ctx.strokeStyle = COLORS.pruned
    ctx.strokeRect(x + 16.5, y + 16.5, width - 33, height - 33)
    ctx.restore()
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(16, '400', MONO)
    ctx.textAlign = 'center'
    ctx.fillText('NO IMAGE', x + width / 2, y + height / 2)
    ctx.textAlign = 'left'
    return
  }
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(image)
    const scale = Math.min((width - 24) / bitmap.width, (height - 24) / bitmap.height)
    const drawWidth = bitmap.width * scale
    const drawHeight = bitmap.height * scale
    ctx.drawImage(bitmap, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
  } catch {
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(16, '400', MONO)
    ctx.textAlign = 'center'
    ctx.fillText('NO IMAGE', x + width / 2, y + height / 2)
    ctx.textAlign = 'left'
  } finally {
    bitmap?.close()
  }
}

async function fontsReady(timeoutMs = 1500): Promise<void> {
  await Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ])
}

export async function renderRecapCard(input: RecapInput): Promise<Blob> {
  await fontsReady()
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  const { diagnosis, scores, lockedId, answers, image, exportedAt } = input
  const lockedHypothesis = diagnosis.hypotheses.find((item) => item.id === lockedId)
  const lockedScore = scores.find((item) => item.id === lockedId)
  const probability = lockedScore?.probability ?? 0
  const answeredCount = Object.keys(answers).length

  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  ctx.fillStyle = COLORS.panel
  ctx.fillRect(0, 0, WIDTH, 96)
  ctx.fillStyle = COLORS.truth
  ctx.font = font(22, '700', MONO)
  ctx.fillText('LabChronos', MARGIN, 42)
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(10, '400', MONO)
  ctx.fillText('FAILURE FORENSICS', MARGIN, 64)
  ctx.fillStyle = COLORS.ink
  ctx.font = font(14, '400', MONO)
  ctx.textAlign = 'right'
  ctx.fillText(formatDateTime(exportedAt), WIDTH - MARGIN, 52)
  ctx.textAlign = 'left'

  ctx.fillStyle = COLORS.ink
  ctx.font = font(48, '700')
  const titleLines = wrapText(ctx, diagnosis.caseTitle, WIDTH - MARGIN * 2, 2)
  titleLines.forEach((line, index) => ctx.fillText(line, MARGIN, 172 + index * 56))
  ctx.fillStyle = COLORS.suspect
  ctx.font = font(14, '400', MONO)
  ctx.fillText(`${diagnosis.domain} · ${diagnosis.observedSymptoms.length} SYMPTOMS · ${diagnosis.questions.length} QUESTIONS`, MARGIN, 276)

  await drawEvidenceImage(ctx, image, MARGIN, 320, 576, 380)
  const symptomX = 672
  const symptomWidth = WIDTH - MARGIN - symptomX - 16
  diagnosis.observedSymptoms.slice(0, 5).forEach((symptom, index) => {
    const y = 348 + index * 68
    ctx.fillStyle = symptom.severity === 'critical' ? COLORS.suspect : COLORS.inkMuted
    ctx.beginPath()
    ctx.arc(symptomX + 4, y - 5, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COLORS.ink
    ctx.font = font(16, '500')
    drawTruncated(ctx, symptom.label, symptomX + 16, y, symptomWidth)
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(11)
    wrapText(ctx, symptom.detail, symptomWidth, 2).forEach((line, lineIndex) => {
      ctx.fillText(line, symptomX + 16, y + 18 + lineIndex * 14)
    })
  })

  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(11, '400', MONO)
  ctx.fillText('CAUSAL CHAIN', MARGIN, 742)
  const barX = WIDTH - MARGIN - 200
  const barWidth = 140
  diagnosis.hypotheses.forEach((hypothesis, index) => {
    const y = 792 + index * 64
    const score = scores.find((item) => item.id === hypothesis.id)
    const value = score?.probability ?? 0
    const isLocked = hypothesis.id === lockedId
    const isPruned = value < 0.15
    const titleColor = isLocked ? COLORS.truth : isPruned ? COLORS.pruned : COLORS.ink
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(12, '400', MONO)
    ctx.fillText(`H${index + 1}`, MARGIN, y)
    if (isLocked) {
      ctx.fillStyle = COLORS.truth
      ctx.fillRect(MARGIN + 34, y - 18, 2, 36)
    }
    ctx.fillStyle = titleColor
    ctx.font = font(20, '500')
    const titleX = MARGIN + 52
    const titleMax = barX - titleX - 24
    const title = truncate(ctx, hypothesis.title, titleMax)
    ctx.fillText(title, titleX, y)
    if (isPruned) {
      const titleWidth = ctx.measureText(title).width
      ctx.strokeStyle = COLORS.pruned
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(titleX, y - 6)
      ctx.lineTo(titleX + titleWidth, y - 6)
      ctx.stroke()
    }
    ctx.fillStyle = COLORS.line
    ctx.fillRect(barX, y - 8, barWidth, 8)
    ctx.fillStyle = isLocked ? COLORS.truth : isPruned ? COLORS.pruned : COLORS.suspect
    ctx.fillRect(barX, y - 8, Math.max(2, barWidth * value), 8)
    ctx.fillStyle = isLocked ? COLORS.truth : isPruned ? COLORS.inkMuted : COLORS.ink
    ctx.font = font(16, '400', MONO)
    ctx.textAlign = 'right'
    ctx.fillText(`${(value * 100).toFixed(1)}%`, WIDTH - MARGIN, y)
    ctx.textAlign = 'left'
  })

  ctx.fillStyle = COLORS.panel
  ctx.fillRect(0, 1100, WIDTH, HEIGHT - 1100)
  ctx.strokeStyle = COLORS.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, 1100.5)
  ctx.lineTo(WIDTH, 1100.5)
  ctx.stroke()
  ctx.fillStyle = COLORS.truth
  ctx.fillRect(MARGIN, 1132, 4, 36)
  ctx.fillStyle = COLORS.ink
  ctx.font = font(26, '700')
  drawTruncated(ctx, `真因：${lockedHypothesis?.title ?? '未锁定'}`, MARGIN + 20, 1158, WIDTH - MARGIN * 2 - 20)
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(14, '400', MONO)
  ctx.fillText(`置信度 ${(probability * 100).toFixed(1)}% · 已答 ${answeredCount}/${diagnosis.questions.length}`, MARGIN, 1198)
  ctx.fillStyle = COLORS.ink
  ctx.font = font(15)
  wrapText(ctx, `最小对照：${lockedHypothesis?.minimalControl.action ?? ''}`, WIDTH - MARGIN * 2, 2).forEach((line, index) => {
    ctx.fillText(line, MARGIN, 1232 + index * 22)
  })
  const firstDiff = lockedHypothesis?.minimalControl.paramDiff[0]
  if (firstDiff) {
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(12, '400', MONO)
    drawTruncated(ctx, `${firstDiff.key}: ${firstDiff.before} → ${firstDiff.after}`, MARGIN, 1278, WIDTH - MARGIN * 2)
  }
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(11, '400', MONO)
  ctx.fillText('labchronos.qoder.zone', MARGIN, 1310)
  ctx.textAlign = 'right'
  ctx.fillText('#LabChronos', WIDTH - MARGIN, 1310)
  ctx.textAlign = 'left'

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG export failed'))
    }, 'image/png')
  })
}

export function downloadRecapCard(blob: Blob, ts: number): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `labchronos-recap-${formatFileStamp(ts)}.png`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

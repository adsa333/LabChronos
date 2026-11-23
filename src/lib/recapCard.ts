import type { Answers, HypothesisScore } from './scoring'
import type { DiagnosisResult, Symptom } from '../types/diagnosis'

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
  bg: '#E6E0D2',
  folio: '#F5F1E8',
  plate: '#FBF9F4',
  tint: '#EFEAE0',
  line: 'rgba(25, 23, 20, 0.24)',
  strong: '#191714',
  truth: '#0F6B58',
  seal: '#C2361F',
  suspect: '#B45309',
  pruned: '#7A7368',
  ink: '#191714',
  inkMuted: '#7A7368',
  imageBg: '#EFEAE0',
}
const MONO = '"JetBrains Mono", monospace'
const SANS = 'system-ui, "Microsoft YaHei", sans-serif'
const SERIF = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, serif'

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
    } else current += char
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

function rule(ctx: CanvasRenderingContext2D, y: number, strong = false): void {
  ctx.strokeStyle = strong ? COLORS.strong : COLORS.line
  ctx.lineWidth = strong ? 1.5 : 1
  ctx.beginPath()
  ctx.moveTo(MARGIN, y)
  ctx.lineTo(WIDTH - MARGIN, y)
  ctx.stroke()
}

async function drawEvidenceImage(ctx: CanvasRenderingContext2D, image: Blob | null, symptoms: Symptom[], x: number, y: number, width: number, height: number): Promise<void> {
  ctx.fillStyle = COLORS.imageBg
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = COLORS.strong
  ctx.lineWidth = 1.5
  ctx.strokeRect(x, y, width, height)
  ctx.lineWidth = 2
  for (const [dx, dy, sx, sy] of [[0, 0, 1, 1], [width, 0, -1, 1], [0, height, 1, -1], [width, height, -1, -1]]) {
    ctx.beginPath()
    ctx.moveTo(x + dx + sx * 12, y + dy)
    ctx.lineTo(x + dx, y + dy)
    ctx.lineTo(x + dx, y + dy + sy * 12)
    ctx.stroke()
  }
  if (!image) {
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(16, '400', MONO)
    ctx.textAlign = 'center'
    ctx.fillText('LOG-ONLY CASE / 纯日志病例', x + width / 2, y + height / 2)
    ctx.textAlign = 'left'
    return
  }
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(image)
    const scale = Math.min((width - 24) / bitmap.width, (height - 24) / bitmap.height)
    const drawWidth = bitmap.width * scale
    const drawHeight = bitmap.height * scale
    const imageX = x + (width - drawWidth) / 2
    const imageY = y + (height - drawHeight) / 2
    ctx.drawImage(bitmap, imageX, imageY, drawWidth, drawHeight)
    symptoms.forEach((symptom) => {
      if (!symptom.bbox) return
      const [bx, by, bw, bh] = symptom.bbox
      ctx.strokeStyle = symptom.severity === 'critical' ? COLORS.seal : COLORS.suspect
      ctx.lineWidth = 2
      ctx.strokeRect(imageX + bx * drawWidth, imageY + by * drawHeight, bw * drawWidth, bh * drawHeight)
    })
  } catch {
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(16, '400', MONO)
    ctx.textAlign = 'center'
    ctx.fillText('IMAGE UNAVAILABLE', x + width / 2, y + height / 2)
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
  ctx.fillStyle = COLORS.folio
  ctx.fillRect(32, 32, WIDTH - 64, HEIGHT - 64)
  ctx.fillStyle = COLORS.line
  for (let index = 0; index < 800; index += 1) {
    const x = 32 + ((Math.sin(index * 127.1) * 43758.5453) % 1 + 1) % 1 * (WIDTH - 64)
    const y = 32 + ((Math.sin(index * 311.7) * 15731.743) % 1 + 1) % 1 * (HEIGHT - 64)
    ctx.fillRect(x, y, 1, 1)
  }
  ctx.strokeStyle = COLORS.strong
  ctx.lineWidth = 1.5
  ctx.strokeRect(32, 32, WIDTH - 64, HEIGHT - 64)

  ctx.fillStyle = COLORS.tint
  ctx.fillRect(32, 32, WIDTH - 64, 72)
  ctx.fillStyle = COLORS.seal
  ctx.strokeStyle = COLORS.seal
  ctx.lineWidth = 1.5
  ctx.strokeRect(MARGIN - 6, 49, 24, 24)
  ctx.font = font(12, '700', SERIF)
  ctx.textAlign = 'center'
  ctx.fillText('验', MARGIN + 6, 66)
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.ink
  ctx.font = font(30, '700', SERIF)
  ctx.fillText('LabChronos', MARGIN + 34, 69)
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(10, '400', MONO)
  ctx.fillText('实验失败取证 · FAILURE FORENSICS', MARGIN + 244, 67)
  ctx.font = font(14, '400', MONO)
  ctx.textAlign = 'right'
  ctx.fillText(formatDateTime(exportedAt), WIDTH - MARGIN, 65)
  ctx.textAlign = 'left'
  rule(ctx, 96, true)
  rule(ctx, 104)

  ctx.fillStyle = COLORS.ink
  ctx.font = font(44, '700', SERIF)
  wrapText(ctx, diagnosis.caseTitle, WIDTH - MARGIN * 2, 2).forEach((line, index) => ctx.fillText(line, MARGIN, 172 + index * 54))
  ctx.fillStyle = COLORS.suspect
  ctx.font = font(14, '400', MONO)
  ctx.fillText(`I · 实验取证 / ${diagnosis.domain} / ${diagnosis.observedSymptoms.length} SYMPTOMS`, MARGIN, 276)
  await drawEvidenceImage(ctx, image, diagnosis.observedSymptoms, MARGIN, 320, 576, 380)

  const symptomX = 680
  const symptomWidth = WIDTH - MARGIN - symptomX
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(11, '400', MONO)
  ctx.fillText('OBSERVED EVIDENCE', symptomX, 336)
  diagnosis.observedSymptoms.slice(0, 5).forEach((symptom, index) => {
    const y = 366 + index * 65
    ctx.fillStyle = symptom.severity === 'critical' ? COLORS.seal : COLORS.suspect
    ctx.fillRect(symptomX, y - 10, 5, 5)
    ctx.fillStyle = COLORS.ink
    ctx.font = font(16, '500')
    drawTruncated(ctx, symptom.label, symptomX + 16, y, symptomWidth - 16)
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(11)
    wrapText(ctx, symptom.detail, symptomWidth - 16, 2).forEach((line, lineIndex) => ctx.fillText(line, symptomX + 16, y + 18 + lineIndex * 14))
  })

  ctx.fillStyle = COLORS.ink
  ctx.font = font(20, '700', SERIF)
  ctx.fillText('II · 因果假设账本', MARGIN, 744)
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(10, '400', MONO)
  ctx.textAlign = 'right'
  ctx.fillText('PROBABILITY / PRUNING', WIDTH - MARGIN, 742)
  ctx.textAlign = 'left'
  rule(ctx, 758, true)
  const barX = WIDTH - MARGIN - 200
  const barWidth = 140
  diagnosis.hypotheses.forEach((hypothesis, index) => {
    const y = 800 + index * 64
    const score = scores.find((item) => item.id === hypothesis.id)
    const value = score?.probability ?? 0
    const isLocked = hypothesis.id === lockedId
    const isPruned = answeredCount > 0 && value < 0.15 && !isLocked
    const titleColor = isLocked ? COLORS.truth : isPruned ? COLORS.pruned : COLORS.ink
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(12, '400', MONO)
    ctx.fillText(hypothesis.id.toUpperCase(), MARGIN, y)
    if (isLocked) {
      ctx.fillStyle = COLORS.truth
      ctx.fillRect(MARGIN + 34, y - 18, 3, 30)
    }
    ctx.fillStyle = titleColor
    ctx.font = font(19, '500', SERIF)
    const titleX = MARGIN + 52
    const title = truncate(ctx, hypothesis.title, barX - titleX - 24)
    ctx.fillText(title, titleX, y)
    if (isPruned) {
      ctx.strokeStyle = COLORS.pruned
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(titleX, y - 6)
      ctx.lineTo(titleX + ctx.measureText(title).width, y - 6)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.fillStyle = COLORS.tint
    ctx.fillRect(barX, y - 8, barWidth, 8)
    ctx.fillStyle = isLocked ? COLORS.truth : isPruned ? COLORS.line : COLORS.suspect
    ctx.fillRect(barX, y - 8, Math.max(2, barWidth * value), 8)
    ctx.fillStyle = isLocked ? COLORS.truth : isPruned ? COLORS.inkMuted : COLORS.ink
    ctx.font = font(16, '400', MONO)
    ctx.textAlign = 'right'
    ctx.fillText(`${(value * 100).toFixed(1)}%`, WIDTH - MARGIN, y)
    ctx.textAlign = 'left'
  })

  ctx.fillStyle = COLORS.plate
  ctx.fillRect(33, 1088, WIDTH - 66, HEIGHT - 1089 - 32)
  rule(ctx, 1088, true)
  ctx.fillStyle = COLORS.truth
  ctx.fillRect(MARGIN, 1120, 4, 42)
  ctx.font = font(26, '700', SERIF)
  drawTruncated(ctx, `真因：${lockedHypothesis?.title ?? '未锁定'}`, MARGIN + 20, 1148, WIDTH - MARGIN * 2 - 112)
  ctx.save()
  ctx.translate(WIDTH - MARGIN - 36, 1138)
  ctx.rotate(-0.12)
  ctx.strokeStyle = COLORS.seal
  ctx.lineWidth = 2
  ctx.strokeRect(-29, -20, 58, 40)
  ctx.fillStyle = COLORS.seal
  ctx.font = font(19, '700', SERIF)
  ctx.textAlign = 'center'
  ctx.fillText('真因', 0, 7)
  ctx.restore()
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(14, '400', MONO)
  ctx.fillText(`置信度 ${(probability * 100).toFixed(1)}% · 已答 ${answeredCount}/${diagnosis.questions.length}`, MARGIN, 1192)
  ctx.fillStyle = COLORS.ink
  ctx.font = font(15)
  wrapText(ctx, `最小对照：${lockedHypothesis?.minimalControl.action ?? ''}`, WIDTH - MARGIN * 2, 2).forEach((line, index) => ctx.fillText(line, MARGIN, 1222 + index * 22))
  const firstDiff = lockedHypothesis?.minimalControl.paramDiff[0]
  if (firstDiff) {
    const diffY = 1284
    ctx.fillStyle = COLORS.inkMuted
    ctx.font = font(12, '400', MONO)
    ctx.fillText(`${firstDiff.key}:`, MARGIN, diffY)
    let x = MARGIN + ctx.measureText(`${firstDiff.key}: `).width
    const before = truncate(ctx, firstDiff.before, 250)
    ctx.fillStyle = COLORS.seal
    ctx.fillText(before, x, diffY)
    ctx.strokeStyle = COLORS.seal
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, diffY - 4)
    ctx.lineTo(x + ctx.measureText(before).width, diffY - 4)
    ctx.stroke()
    x += ctx.measureText(before).width + 18
    ctx.fillStyle = COLORS.inkMuted
    ctx.fillText('→', x, diffY)
    x += 28
    ctx.fillStyle = COLORS.truth
    ctx.font = font(13, '700', MONO)
    drawTruncated(ctx, firstDiff.after, x, diffY, WIDTH - MARGIN - x)
  }
  ctx.fillStyle = COLORS.inkMuted
  ctx.font = font(11, '400', MONO)
  ctx.fillText('单变量原则 · 客观取证 · 可复现实验', MARGIN, 1316)
  ctx.textAlign = 'right'
  ctx.fillText('#LabChronos', WIDTH - MARGIN, 1316)
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
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

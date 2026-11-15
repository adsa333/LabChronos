import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, ImagePlus, X } from 'lucide-react'
import { runDiagnose } from '../lib/diagnose'
import type { DiagnosisResult, Domain } from '../types/diagnosis'

interface DiagnoseDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: (diagnosis: DiagnosisResult, imageFile?: File, logText?: string) => void
}

const MAX_FILE_SIZE = 8 * 1024 * 1024
const MAX_LOG_LENGTH = 15000
const STAGES = ['提取图像异常', '构建假设树', '生成鉴别问题']
const DOMAIN_OPTIONS: { label: string; value?: Domain }[] = [
  { label: 'AI / ML', value: 'AI/ML' },
  { label: '生化', value: 'Bio/Chem' },
  { label: '物理 / 电子', value: 'Physics/EE' },
  { label: '不确定', value: undefined },
]

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export default function DiagnoseDialog({ open, onClose, onSuccess }: DiagnoseDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [logText, setLogText] = useState('')
  const [domainHint, setDomainHint] = useState<Domain | undefined>()
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState('')
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<'form' | 'loading'>('form')
  const [activeStage, setActiveStage] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreviewUrl('')
    setImageSize(null)
  }, [])

  const resetForm = useCallback(() => {
    clearPreview()
    setFile(null)
    setLogText('')
    setDomainHint(undefined)
    setFileError('')
    setError('')
    setDragging(false)
    setPhase('form')
    setActiveStage(0)
    setElapsed(0)
  }, [clearPreview])

  const requestClose = useCallback(() => {
    if (phase !== 'loading') {
      resetForm()
      onClose()
    }
  }, [onClose, phase, resetForm])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, requestClose])

  useEffect(() => {
    return () => {
      requestRef.current += 1
      abortRef.current?.abort()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'loading') return
    const startedAt = Date.now()
    const firstTimer = window.setTimeout(() => setActiveStage(1), 1600)
    const secondTimer = window.setTimeout(() => setActiveStage(2), 3200)
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => {
      clearTimeout(firstTimer)
      clearTimeout(secondTimer)
      clearInterval(interval)
    }
  }, [phase])

  function selectFile(candidate?: File) {
    if (!candidate) return
    setFileError('')
    setError('')
    if (!candidate.type.startsWith('image/')) {
      setFileError('请选择图片文件')
      return
    }
    if (candidate.size > MAX_FILE_SIZE) {
      setFileError('图片请小于 8MB')
      return
    }
    clearPreview()
    const url = URL.createObjectURL(candidate)
    previewUrlRef.current = url
    setPreviewUrl(url)
    const image = new window.Image()
    image.onload = () => {
      if (previewUrlRef.current === url) setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.src = url
    setFile(candidate)
  }

  function removeFile() {
    clearPreview()
    setFile(null)
    setFileError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleSubmit() {
    const canSubmit = Boolean(file || logText.trim()) && logText.length <= MAX_LOG_LENGTH
    if (!canSubmit || phase === 'loading') return
    setError('')
    setFileError('')
    setActiveStage(0)
    setElapsed(0)
    setPhase('loading')
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestRef.current
    try {
      const diagnosis = await runDiagnose({
        imageFile: file ?? undefined,
        logText: logText || undefined,
        domainHint,
      }, controller.signal)
      if (requestId !== requestRef.current) return
      resetForm()
      onSuccess(diagnosis, file ?? undefined, logText)
    } catch (caught) {
      if (requestId !== requestRef.current) return
      setPhase('form')
      if (!isAbortError(caught)) {
        setError(caught instanceof Error ? caught.message : '诊断失败，请稍后重试。')
      }
    }
  }

  function cancelDiagnosis() {
    requestRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('form')
    setActiveStage(0)
    setElapsed(0)
  }

  const hasImage = Boolean(file)
  const stageDescriptions = [
    hasImage ? '定位异常区域与视觉特征' : '未提供图片，正在解析日志特征',
    '按失败机制生成 3–4 条假设',
    '为每条假设生成可判定的排查问题',
  ]
  const logTooLong = logText.length > MAX_LOG_LENGTH
  const canSubmit = Boolean(file || logText.trim()) && !logTooLong

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) requestClose()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="diagnose-dialog-title"
            className="max-h-[82vh] w-[720px] overflow-y-auto rounded-lg border border-line bg-panel text-ink shadow-2xl max-[820px]:w-[92vw]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15, ease: 'easeOut' } }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="flex h-14 items-center justify-between border-b border-line px-6">
              <h2 id="diagnose-dialog-title" className="text-sm font-semibold">新建诊断</h2>
              <button
                type="button"
                aria-label="关闭"
                disabled={phase === 'loading'}
                onClick={requestClose}
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-bg hover:text-ink disabled:cursor-not-allowed disabled:text-pruned"
              >
                <X size={17} />
              </button>
            </div>

            {phase === 'loading' ? (
              <div className="p-6">
                <div className="flex gap-2">
                  {STAGES.map((stage, index) => {
                    const active = index === activeStage
                    const done = index < activeStage
                    if (active && index === 2) {
                      return (
                        <motion.div
                          key={stage}
                          className="h-1 flex-1 rounded-full bg-suspect"
                          animate={{ opacity: [1, 0.55, 1] }}
                          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      )
                    }
                    return <div key={stage} className={`h-1 flex-1 rounded-full ${done ? 'bg-truth' : active ? 'bg-suspect' : 'bg-line'}`} />
                  })}
                </div>

                <div className="mt-7 space-y-6">
                  {STAGES.map((stage, index) => {
                    const active = index === activeStage
                    const done = index < activeStage
                    return (
                      <div key={stage} className="flex items-start justify-between gap-4">
                        <div>
                          <div className={`text-xs font-medium ${done ? 'text-truth' : active ? 'text-ink' : 'text-pruned'}`}>{stage}</div>
                          <p className={`mt-1.5 text-[10px] ${active || done ? 'text-ink-muted' : 'text-pruned'}`}>{stageDescriptions[index]}</p>
                        </div>
                        <div className="shrink-0 pt-0.5 font-mono text-[10px]">
                          {done ? (
                            <Check size={15} className="text-truth" />
                          ) : active && index === 2 ? (
                            <span className="text-suspect">已用时 {elapsed}s</span>
                          ) : active ? (
                            <motion.span
                              className="inline-block text-suspect"
                              animate={{ opacity: [1, 0.55, 1] }}
                              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                            >
                              进行中
                            </motion.span>
                          ) : (
                            <span className="text-pruned">等待</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {activeStage === 2 && elapsed > 15 && (
                  <p className="mt-6 text-center text-[10px] text-ink-muted">模型仍在分析，通常需要 10–20 秒</p>
                )}
                <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
                  {activeStage === 2 && elapsed > 30 && (
                    <button type="button" onClick={cancelDiagnosis} className="rounded-md border border-suspect/50 bg-suspect/10 px-4 py-2 text-xs text-suspect hover:bg-suspect/15">
                      取消
                    </button>
                  )}
                  <button type="button" disabled className="cursor-not-allowed rounded-md border border-truth/40 bg-truth/10 px-4 py-2 text-xs text-truth/60">
                    诊断中…
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5 p-6">
                {error && (
                  <div className="rounded-md border border-suspect/40 bg-suspect/10 p-3 text-xs text-suspect">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                    <button type="button" onClick={() => setError('')} className="mt-2 text-[10px] underline underline-offset-4">重试</button>
                  </div>
                )}

                <div>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      selectFile(event.target.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="选择实验截图"
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        inputRef.current?.click()
                      }
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setDragging(true)
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault()
                      setDragging(false)
                      selectFile(event.dataTransfer.files[0])
                    }}
                    className={`relative flex h-[200px] cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed outline-none transition-colors focus-visible:ring-1 focus-visible:ring-truth ${dragging ? 'border-truth bg-truth/5' : 'border-line bg-bg/60'}`}
                  >
                    {previewUrl ? (
                      <>
                        <img src={previewUrl} alt="实验截图预览" className="max-h-[196px] max-w-full object-contain" />
                        <div className="absolute bottom-3 left-3 max-w-[58%] rounded bg-panel/90 px-2 py-1">
                          <div className="truncate text-[10px] text-ink">{file?.name}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-ink-muted">
                            {imageSize ? `${imageSize.width}×${imageSize.height}` : '读取尺寸中…'} · {Math.round((file?.size ?? 0) / 1024)} KB
                          </div>
                        </div>
                        <div className="absolute bottom-3 right-3 flex gap-2">
                          <button
                            type="button"
                            className="rounded border border-line bg-panel/95 px-2 py-1 text-[10px] text-ink-muted hover:text-truth"
                            onClick={(event) => {
                              event.stopPropagation()
                              inputRef.current?.click()
                            }}
                          >
                            重新选择
                          </button>
                          <button
                            type="button"
                            className="rounded border border-line bg-panel/95 px-2 py-1 text-[10px] text-ink-muted hover:text-suspect"
                            onClick={(event) => {
                              event.stopPropagation()
                              removeFile()
                            }}
                          >
                            移除
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-center">
                        <ImagePlus size={28} className="text-ink-muted" strokeWidth={1.4} />
                        <p className="text-xs text-ink-muted">拖入实验截图，或点击选择</p>
                      </div>
                    )}
                  </div>
                  {fileError && <p className="mt-2 text-[10px] text-suspect">{fileError}</p>}
                </div>

                <div>
                  <label htmlFor="diagnose-log" className="mb-2 block text-xs text-ink-muted">日志输入（可选）</label>
                  <div className={`relative rounded-md border bg-bg/60 ${logTooLong ? 'border-suspect' : 'border-line'}`}>
                    <textarea
                      id="diagnose-log"
                      rows={4}
                      value={logText}
                      onChange={(event) => setLogText(event.target.value)}
                      placeholder="粘贴报错日志或关键输出（可选，≤15000 字）"
                      className="block w-full resize-none rounded-md bg-transparent p-3 pb-7 text-xs leading-5 text-ink outline-none placeholder:text-pruned focus:ring-1 focus:ring-truth"
                    />
                    <span className={`absolute bottom-2 right-3 font-mono text-[10px] ${logTooLong ? 'text-suspect' : 'text-ink-muted'}`}>
                      {logText.length} / 15000
                    </span>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs text-ink-muted">领域（可选）</div>
                  <div className="flex flex-wrap gap-2">
                    {DOMAIN_OPTIONS.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        aria-pressed={domainHint === option.value}
                        onClick={() => setDomainHint(option.value)}
                        className={`rounded-full border px-3 py-1.5 text-[10px] ${domainHint === option.value ? 'border-truth bg-truth/10 text-truth' : 'border-line bg-bg/60 text-ink-muted hover:border-pruned hover:text-ink'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-line pt-5">
                  <button type="button" onClick={requestClose} className="rounded-md border border-line bg-bg/60 px-4 py-2 text-xs text-ink-muted hover:text-ink">
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={handleSubmit}
                    className="rounded-md border border-truth bg-truth px-4 py-2 text-xs font-medium text-bg hover:bg-truth/90 disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-pruned"
                  >
                    开始诊断
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

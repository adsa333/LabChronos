import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, X } from 'lucide-react'
import { runDiagnose } from '../lib/diagnose'
import type { DiagnosisResult, Domain } from '../types/diagnosis'

interface NewCaseViewProps {
  onCancel: () => void
  onSuccess: (diagnosis: DiagnosisResult, imageFile?: File, logText?: string) => void
}

const MAX_LOG = 15000
const MAX_FILE = 8 * 1024 * 1024
const STAGES = ['提取图像异常', '构建假设树', '生成鉴别问题']
const DOMAINS: { label: string; value?: Domain }[] = [
  { label: '自动识别', value: undefined },
  { label: 'AI·ML', value: 'AI/ML' },
  { label: '生化', value: 'Bio/Chem' },
  { label: '物理电子', value: 'Physics/EE' },
  { label: '通用·其他', value: 'General' },
]

function countKeyValues(log: string): number {
  return log.split(/\r?\n/).filter((line) => /[A-Za-z0-9_]+\s*=/.test(line)).length
}

export default function NewCaseView({ onCancel, onSuccess }: NewCaseViewProps) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [log, setLog] = useState('')
  const [domain, setDomain] = useState<Domain | undefined>()
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const previewRef = useRef('')

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!busy) return
    const startedAt = Date.now()
    const first = window.setTimeout(() => setStage(1), 1600)
    const second = window.setTimeout(() => setStage(2), 3200)
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => {
      clearTimeout(first)
      clearTimeout(second)
      clearInterval(interval)
    }
  }, [busy])

  function selectFile(candidate?: File) {
    if (!candidate) return
    setFileError('')
    if (!candidate.type.startsWith('image/')) {
      setFileError('请选择图片文件')
      return
    }
    if (candidate.size > MAX_FILE) {
      setFileError('图片请小于 8MB')
      return
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const url = URL.createObjectURL(candidate)
    previewRef.current = url
    setPreviewUrl(url)
    setFile(candidate)
  }

  function removeFile() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = ''
    setPreviewUrl('')
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function submit() {
    if (busy || (!file && !log.trim()) || log.length > MAX_LOG) return
    setError('')
    setStage(0)
    setElapsed(0)
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const diagnosis = await runDiagnose({ imageFile: file ?? undefined, logText: log || undefined, domainHint: domain }, controller.signal)
      setBusy(false)
      onSuccess(diagnosis, file ?? undefined, log)
    } catch (caught) {
      setBusy(false)
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : '诊断失败，请稍后重试。')
      }
    }
  }

  function cancel() {
    abortRef.current?.abort()
    setBusy(false)
  }

  const kvCount = countKeyValues(log)
  const canSubmit = Boolean(file || log.trim()) && log.length <= MAX_LOG

  return (
    <section className="flex min-h-0 flex-col surface-folio">
      <div className="double-rule flex h-14 shrink-0 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} className="text-aux hover:seal-text"><ArrowLeft size={16} /></button>
          <h2 className="font-display text-base font-semibold text-main">新建病例</h2>
          <span className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">NEW CASE FOLIO</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 pb-16">
        {busy ? (
          <div className="mx-auto max-w-xl space-y-6 pt-10">
            <div className="flex gap-2">
              {STAGES.map((item, index) => (
                <div key={item} className="h-1 flex-1" style={{ background: index < stage ? 'var(--teal)' : index === stage ? 'var(--amber)' : 'var(--rule)' }} />
              ))}
            </div>
            {STAGES.map((item, index) => (
              <div key={item} className="flex items-center justify-between border-b rule-border pb-3">
                <div>
                  <p className={`text-sm ${index <= stage ? 'text-main' : 'text-aux'}`}>{item}</p>
                  <p className="mt-1 text-[10px] text-aux">
                    {index === 0 ? (file ? '定位异常区域与视觉特征' : '未提供图片，正在解析日志特征') : index === 1 ? '按失败机制生成 3–4 条假设' : '为每条假设生成可判定的排查问题'}
                  </p>
                </div>
                <span className="font-mono-tab text-[10px] text-aux">
                  {index < stage ? '✓' : index === stage ? (index === 2 ? `已用时 ${elapsed}s` : '进行中') : '等待'}
                </span>
              </div>
            ))}
            {stage === 2 && elapsed > 12 && <p className="text-center text-[10px] text-aux">模型仍在分析，通常需要 30 秒左右</p>}
            {stage === 2 && elapsed > 30 && (
              <div className="text-center">
                <button type="button" onClick={cancel} className="btn-ghost px-4 py-2 text-xs">取消</button>
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {error && (
              <div className="border rule-border seal-soft-bg p-3 text-xs seal-text">
                {error}
                <button type="button" onClick={() => setError('')} className="ml-3 underline">重试</button>
              </div>
            )}

            <div className="folio-card p-4">
              <p className="mb-2 font-mono-tab text-[10px] tracking-[0.16em] text-aux">01 实验日志</p>
              <textarea
                rows={6}
                value={log}
                onChange={(event) => setLog(event.target.value)}
                placeholder="粘贴报错日志或关键输出（可选，≤15000 字）"
                className="w-full resize-none border rule-border surface-plate p-3 font-mono-tab text-xs leading-5 text-main outline-none placeholder:text-aux focus:rule-strong-border"
              />
              <div className="mt-2 flex items-center justify-between font-mono-tab text-[10px]">
                <span className="text-aux">自动识别 KEY=VALUE：{kvCount} 项</span>
                <span className={log.length > MAX_LOG ? 'seal-text' : 'text-aux'}>{log.length} / 15000</span>
              </div>
            </div>

            <div className="folio-card p-4">
              <p className="mb-2 font-mono-tab text-[10px] tracking-[0.16em] text-aux">02 失败图版（可选）</p>
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { selectFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click() }}
                onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]) }}
                className={`flex h-[200px] cursor-pointer items-center justify-center border border-dashed ${dragging ? 'rule-strong-border teal-soft-bg' : 'rule-border surface-tint'}`}
              >
                {previewUrl ? (
                  <div className="relative flex h-full w-full items-center justify-center p-2">
                    <img src={previewUrl} alt="失败图版预览" className="max-h-full max-w-full object-contain" />
                    <button type="button" aria-label="移除图片" onClick={(event) => { event.stopPropagation(); removeFile() }} className="absolute right-2 top-2 border rule-border surface-plate p-1 text-aux hover:seal-text">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-aux">
                    <ImagePlus size={24} />
                    <span className="text-xs">拖入实验截图，或点击选择</span>
                  </div>
                )}
              </div>
              {fileError && <p className="mt-2 text-[10px] seal-text">{fileError}</p>}
            </div>

            <div className="folio-card p-4">
              <p className="mb-2 font-mono-tab text-[10px] tracking-[0.16em] text-aux">03 学科领域</p>
              <div className="flex flex-wrap gap-2">
                {DOMAINS.map((item) => (
                  <button key={item.label} type="button" onClick={() => setDomain(item.value)} className={`border px-3 py-1.5 text-xs ${domain === item.value ? 'rule-strong-border teal-soft-bg teal-text' : 'rule-border text-sub hover:seal-text'}`}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="btn-primary px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40">
                开始取证 →
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

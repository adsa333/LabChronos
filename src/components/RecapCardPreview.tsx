import { useEffect } from 'react'
import { Archive, Download, X } from 'lucide-react'

interface RecapCardPreviewProps {
  open: boolean
  url: string | null
  busy: boolean
  onClose: () => void
  onDownload: () => void
  onSaveToVault: () => void
  saved: boolean
  canSave?: boolean
}

export default function RecapCardPreview({ open, url, busy, onClose, onDownload, onSaveToVault, saved, canSave = true }: RecapCardPreviewProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="scrim fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label="复盘卡预览" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex max-h-[calc(100dvh-32px)] w-full max-w-[380px] flex-col overflow-hidden border-[1.5px] rule-strong-border surface-plate">
        <div className="flex h-11 shrink-0 items-center justify-between border-b rule-border px-4">
          <span className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">RECAP CARD</span>
          <button type="button" aria-label="关闭预览" onClick={onClose} className="text-aux hover:seal-text"><X size={15} /></button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center surface-folio p-4">
          {busy ? (
            <div className="flex h-[420px] w-full flex-col items-center justify-center gap-3 border rule-border surface-plate">
              <div className="h-2 w-40 animate-pulse surface-tint" />
              <div className="h-2 w-56 animate-pulse surface-tint" />
              <div className="h-40 w-full animate-pulse surface-tint" />
              <span className="text-xs text-aux">正在渲染…</span>
            </div>
          ) : url ? (
            <img src={url} alt="复盘卡预览" className="max-h-[calc(100vh-260px)] w-full border rule-border object-contain" />
          ) : (
            <span className="text-xs text-aux">暂无预览</span>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t rule-border p-3">
          <button type="button" onClick={onDownload} disabled={busy || !url} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">
            <Download size={13} />下载 PNG
          </button>
          {canSave && (
            <button type="button" onClick={onSaveToVault} disabled={busy || saved || !url} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">
              <Archive size={13} />{saved ? '已存入' : '存入往期'}
            </button>
          )}
          <button type="button" onClick={onClose} className="px-2 py-2 text-xs text-aux hover:text-main">关闭</button>
        </div>
      </div>
    </div>
  )
}

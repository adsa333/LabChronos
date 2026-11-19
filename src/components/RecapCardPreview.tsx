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
}

export default function RecapCardPreview({ open, url, busy, onClose, onDownload, onSaveToVault, saved }: RecapCardPreviewProps) {
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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,11,0.88)] p-6 backdrop-blur-[4px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[calc(100vh-120px)] w-[380px] flex-col overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="font-mono text-[10px] tracking-[0.16em] text-ink-muted">RECAP CARD</span>
          <button type="button" aria-label="关闭预览" onClick={onClose} className="text-ink-muted hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-bg p-4">
          {busy ? (
            <div className="flex h-[420px] w-full flex-col items-center justify-center gap-3 rounded border border-line bg-panel">
              <div className="h-2 w-40 animate-pulse rounded bg-line" />
              <div className="h-2 w-56 animate-pulse rounded bg-line" />
              <div className="h-40 w-full animate-pulse rounded bg-line" />
              <span className="text-xs text-ink-muted">正在渲染…</span>
            </div>
          ) : url ? (
            <img src={url} alt="复盘卡预览" className="max-h-[calc(100vh-260px)] w-full rounded border border-line object-contain" />
          ) : (
            <span className="text-xs text-pruned">暂无预览</span>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line p-3">
          <button type="button" onClick={onDownload} disabled={busy || !url} className="flex items-center gap-1.5 rounded-md bg-truth px-3 py-2 text-xs font-medium text-bg hover:bg-truth/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-pruned">
            <Download size={13} />下载 PNG
          </button>
          <button type="button" onClick={onSaveToVault} disabled={busy || saved || !url} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs text-ink-muted hover:border-truth/40 hover:text-truth disabled:cursor-not-allowed disabled:text-pruned">
            <Archive size={13} />{saved ? '已存入' : '存入博物馆'}
          </button>
          <button type="button" onClick={onClose} className="px-2 py-2 text-xs text-ink-muted hover:text-ink">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

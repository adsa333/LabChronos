import { useEffect, useMemo, useRef } from 'react'
import { Play, Trash2, X } from 'lucide-react'
import type { VaultEntry } from '../lib/vaultStorage'

interface VaultMuseumProps {
  open: boolean
  entries: VaultEntry[]
  onClose: () => void
  onRestore: (entry: VaultEntry) => void
  onDelete: (id: string) => void
  onStartDiagnosis: () => void
}

function formatMonthDay(ts: number): string {
  const date = new Date(ts)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function VaultMuseum({ open, entries, onClose, onRestore, onDelete, onStartDiagnosis }: VaultMuseumProps) {
  const thumbUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    entries.forEach((entry) => {
      if (entry.thumb) urls[entry.id] = URL.createObjectURL(entry.thumb)
    })
    return urls
  }, [entries])
  const thumbUrlsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    const previous = thumbUrlsRef.current
    thumbUrlsRef.current = thumbUrls
    Object.values(previous).forEach((url) => URL.revokeObjectURL(url))
  }, [thumbUrls])

  useEffect(() => {
    return () => {
      Object.values(thumbUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const ascending = [...entries].sort((a, b) => a.createdAt - b.createdAt)
  const numberById = new Map(ascending.map((entry, index) => [entry.id, String(index + 1).padStart(3, '0')]))

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold text-ink">翻车博物馆</span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-ink-muted">FAILURE MUSEUM</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-ink-muted">{entries.length} ENTRIES</span>
          <button type="button" aria-label="关闭博物馆" onClick={onClose} className="text-ink-muted hover:text-ink">
            <X size={17} />
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-ink">还没有存证过的失败</p>
          <p className="text-xs text-ink-muted">锁定真因之后可以存入博物馆</p>
          <button type="button" onClick={onStartDiagnosis} className="mt-2 rounded-md border border-truth/40 bg-truth/10 px-4 py-2 text-xs text-truth hover:bg-truth/15">
            去做一次诊断
          </button>
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-[800px] flex-1 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] content-start gap-4 overflow-y-auto p-6">
          {entries.map((entry) => (
            <div
              key={entry.id}
              role="button"
              tabIndex={0}
              onClick={() => onRestore(entry)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onRestore(entry)
                }
              }}
              className="group cursor-pointer overflow-hidden rounded-lg border border-line bg-panel outline-none transition-colors hover:border-truth/40 focus-visible:border-truth/40"
            >
              <div className="relative aspect-[4/3] bg-bg">
                {thumbUrls[entry.id] ? (
                  <img src={thumbUrls[entry.id]} alt={entry.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-pruned">NO IMAGE</div>
                )}
                <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label="回放"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRestore(entry)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-panel/90 text-ink-muted hover:text-truth"
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="删除存证"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (window.confirm('删除这条存证？不可恢复')) onDelete(entry.id)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-panel/90 text-ink-muted hover:text-suspect"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 p-3">
                <div className="flex items-center justify-between font-mono text-[10px] text-ink-muted">
                  <span>NO.{numberById.get(entry.id)}</span>
                  <span>{formatMonthDay(entry.createdAt)}</span>
                </div>
                <h3 className="line-clamp-2 text-[15px] font-medium leading-5 text-ink">{entry.title}</h3>
                <p className="truncate text-xs text-truth">真因：{entry.truthTitle}</p>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-truth" style={{ width: `${Math.max(2, entry.probability * 100)}%` }} />
                  </div>
                  <span className="font-mono text-xs text-ink-muted">{(entry.probability * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

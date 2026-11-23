import { useEffect, useRef, useState } from 'react'
import { Download, Play, Trash2 } from 'lucide-react'
import type { PresetCase } from '../data/presets'
import type { VaultEntry } from '../lib/vaultStorage'

interface VaultMuseumProps {
  entries: VaultEntry[]
  presets: PresetCase[]
  onRestore: (entry: VaultEntry) => void
  onDelete: (id: string) => void
  onExport: (entry: VaultEntry) => void
  onSelectPreset: (id: string) => void
  onNewCase: () => void
}

function formatMonthDay(ts: number): string {
  const date = new Date(ts)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function VaultThumbnail({ blob, title }: { blob: Blob; title: string }) {
  const imageRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const image = imageRef.current
    if (!image) return
    const url = URL.createObjectURL(blob)
    image.src = url
    return () => {
      image.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [blob])
  return <img ref={imageRef} alt={title} className="h-full w-full object-contain" />
}

export default function VaultMuseum({ entries, presets, onRestore, onDelete, onExport, onSelectPreset, onNewCase }: VaultMuseumProps) {
  const [tab, setTab] = useState<'archive' | 'public'>('archive')

  const ascending = [...entries].sort((a, b) => a.createdAt - b.createdAt)
  const numberById = new Map(ascending.map((entry, index) => [entry.id, String(index + 1).padStart(3, '0')]))

  return (
    <section className="flex min-h-0 flex-col surface-folio">
      <div className="double-rule flex h-14 shrink-0 items-center justify-between px-6">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-base font-semibold text-main">翻车博物馆</h2>
          <span className="font-mono-tab text-[10px] tracking-[0.18em] text-aux">FAILURE MUSEUM</span>
        </div>
        <span className="font-mono-tab text-[10px] text-aux">{entries.length} ENTRIES</span>
      </div>

      <div className="flex shrink-0 gap-2 border-b rule-border px-6 py-3">
        <button type="button" onClick={() => setTab('archive')} className={`border px-3 py-1.5 text-xs ${tab === 'archive' ? 'rule-strong-border seal-soft-bg seal-text' : 'rule-border text-sub'}`}>归档复盘</button>
        <button type="button" onClick={() => setTab('public')} className={`border px-3 py-1.5 text-xs ${tab === 'public' ? 'rule-strong-border teal-soft-bg teal-text' : 'rule-border text-sub'}`}>公共避坑库</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 pb-16">
        {tab === 'archive' && entries.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="font-display text-lg text-main">还没有存证过的失败</p>
            <p className="text-xs text-aux">锁定真因之后可以存入往期病例</p>
            <button type="button" onClick={onNewCase} className="btn-primary mt-2 px-4 py-2 text-xs">去做一次诊断</button>
          </div>
        )}

        {tab === 'archive' && entries.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {entries.map((entry) => (
              <article key={entry.id} className="folio-card group overflow-hidden">
                <div className="relative aspect-[4/3] w-full surface-tint">
                  <button type="button" onClick={() => onRestore(entry)} className="absolute inset-0">
                    {entry.thumb ? (
                      <VaultThumbnail blob={entry.thumb} title={entry.title} />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center font-mono-tab text-[10px] text-aux">NO IMAGE</span>
                    )}
                  </button>
                  <div className="absolute right-2 top-2 flex gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                    <button type="button" aria-label={`导出 ${entry.title}`} onClick={() => onExport(entry)} className="flex h-7 w-7 items-center justify-center border rule-border surface-plate text-sub hover:teal-text">
                      <Download size={12} />
                    </button>
                    <button type="button" aria-label={`删除 ${entry.title}`} onClick={() => { if (window.confirm('删除这条存证？不可恢复')) onDelete(entry.id) }} className="flex h-7 w-7 items-center justify-center border rule-border surface-plate text-sub hover:seal-text">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between font-mono-tab text-[10px] text-aux">
                    <span>NO.{numberById.get(entry.id)}</span>
                    <span>{formatMonthDay(entry.createdAt)}</span>
                  </div>
                  <button type="button" onClick={() => onRestore(entry)} className="block w-full text-left">
                    <h3 className="line-clamp-2 font-display text-[15px] font-semibold leading-5 text-main">{entry.title}</h3>
                    <p className="mt-1 truncate text-xs teal-text">真因：{entry.truthTitle}</p>
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 surface-tint">
                      <div className="h-full" style={{ width: `${Math.max(2, entry.probability * 100)}%`, background: 'var(--teal)' }} />
                    </div>
                    <span className="font-mono-tab text-xs text-sub">{(entry.probability * 100).toFixed(1)}%</span>
                  </div>
                  <button type="button" onClick={() => onRestore(entry)} className="btn-ghost flex w-full items-center justify-center gap-1.5 px-2 py-1.5 text-[11px]">
                    <Play size={12} />切回交互实操
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === 'public' && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {presets.map((preset, index) => (
              <button key={preset.id} type="button" onClick={() => onSelectPreset(preset.id)} className="folio-card overflow-hidden text-left hover:rule-strong-border">
                <div className="aspect-[4/3] surface-tint">
                  <img src={preset.image} alt={preset.label} className="h-full w-full object-contain" />
                </div>
                <div className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between font-mono-tab text-[10px] text-aux">
                    <span>NO.{String(index + 1).padStart(3, '0')}</span>
                    <span>{preset.diagnosis.domain}</span>
                  </div>
                  <h3 className="font-display text-[15px] font-semibold leading-5 text-main">{preset.label}</h3>
                  <p className="line-clamp-2 text-[11px] leading-4 text-sub">{preset.diagnosis.hypotheses[0]?.title}</p>
                  <p className="font-mono-tab text-[9px] text-aux">公共避坑 · 点击实操</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

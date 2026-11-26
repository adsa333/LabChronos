import { useState } from 'react'
import { Archive, BookOpen, ChevronDown, FlaskConical, Plus, Search, X } from 'lucide-react'

export interface CatalogItem {
  id: string
  kind: 'preset' | 'custom' | 'vault'
  title: string
  summary: string
  domain: string
  code: string
  truthTitle?: string
  probability?: number
  locked?: boolean
}

export type CatalogFilter = 'all' | 'progress' | 'mine' | 'archived'

interface CatalogRailProps {
  theme: 'ink' | 'lumen'
  onToggleTheme: () => void
  open: boolean
  onClose: () => void
  items: CatalogItem[]
  activeItem?: CatalogItem
  activeId: string
  filter: CatalogFilter
  onFilter: (filter: CatalogFilter) => void
  search: string
  onSearch: (value: string) => void
  onSelect: (id: string) => void
  onNewCase: () => void
  onArchive: () => void
  onShowCover: () => void
  flowStep: number
  totalCount: number
}

const FILTERS: { key: CatalogFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'progress', label: '进行中' },
  { key: 'mine', label: '我的' },
  { key: 'archived', label: '已归档' },
]

const FLOW_STEPS = ['客观取证', '贝叶斯先验', '鉴别追问', '实时剪枝', '单变量处方']

export default function CatalogRail({ theme, onToggleTheme, open, onClose, items, activeItem, activeId, filter, onFilter, search, onSearch, onSelect, onNewCase, onArchive, onShowCover, flowStep, totalCount }: CatalogRailProps) {
  const [pastOpen, setPastOpen] = useState(true)

  return (
    <>
      {open && <div className="scrim-light fixed inset-0 z-30 lg:hidden" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[258px] shrink-0 flex-col border-r-[1.5px] rule-strong-border surface-rail transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="double-rule flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="seal-text" />
            <span className="font-display text-base font-semibold text-main">LabChronos</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onToggleTheme} className="btn-ghost px-2 py-1 font-mono-tab text-[10px]">
              {theme === 'ink' ? '纸 ／ 光' : '光 ／ 纸'}
            </button>
            <button type="button" aria-label="关闭目录" onClick={onClose} className="text-aux hover:text-main lg:hidden">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="space-y-3 border-b rule-border p-3">
          <label className="flex items-center gap-2 border rule-border surface-plate px-2 py-1.5">
            <Search size={13} className="text-aux" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜编号 / 病例 / 学科 / 真因"
              className="w-full bg-transparent text-xs text-main outline-none placeholder:text-aux"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilter(item.key)}
                className={`border px-2 py-1 text-[10px] ${filter === item.key ? 'rule-strong-border seal-soft-bg seal-text' : 'rule-border text-sub hover:seal-text'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div data-tour="catalog" className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            <p className="px-1 font-mono-tab text-[10px] tracking-[0.16em] text-aux">当前病例</p>
            {activeItem && (
              <button type="button" onClick={() => onSelect(activeItem.id)} className="catalog-active flex w-full items-start gap-2 px-2 py-2 text-left">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--seal)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-main">{activeItem.title}</span>
                  <span className="mt-0.5 block font-mono-tab text-[10px] text-aux">
                    {activeItem.locked ? '已锁定' : `${((activeItem.probability ?? 0) * 100).toFixed(1)}%`} · {activeItem.domain}
                  </span>
                </span>
              </button>
            )}
            <button type="button" onClick={onNewCase} className="flex w-full items-center gap-2 border rule-border px-2 py-2 text-xs text-sub hover:seal-text hover:seal-soft-bg">
              <Plus size={13} />新建病例
            </button>
          </div>

          <div className="mt-4">
            <button type="button" onClick={() => setPastOpen((value) => !value)} className="flex w-full items-center justify-between px-1 font-mono-tab text-[10px] tracking-[0.16em] text-aux">
              往期病例
              <ChevronDown size={13} className={`transition-transform ${pastOpen ? '' : '-rotate-90'}`} />
            </button>
            {pastOpen && (
              <div className="mt-1 space-y-1">
                {items.filter((item) => !(item.kind === 'custom' && filter === 'all')).length === 0 && <p className="px-2 py-2 text-[11px] text-aux">没有匹配的病例</p>}
                {items.filter((item) => !(item.kind === 'custom' && filter === 'all')).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={`flex w-full items-start gap-2 border-l-[3px] px-2 py-2 text-left ${item.id === activeId ? 'catalog-active' : 'border-transparent hover:surface-tint'}`}
                  >
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${item.kind === 'vault' ? 'teal-text' : item.kind === 'custom' ? 'amber-text' : 'text-aux'}`} style={{ background: 'currentColor' }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-main">{item.title}</span>
                        <span className="font-mono-tab text-[9px] text-aux">{item.code}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-aux">{item.summary}</span>
                      <span className="mt-0.5 block font-mono-tab text-[9px] text-aux">{item.domain}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-t rule-border px-3 py-2">
          <button type="button" data-tour="museum" onClick={onArchive} className="flex items-center justify-center gap-2 border rule-border px-2 py-2 text-xs text-sub hover:teal-text hover:teal-soft-bg">
            <Archive size={13} />翻车博物馆
          </button>
          <button type="button" onClick={onShowCover} className="flex items-center justify-center gap-2 border rule-border px-2 py-2 text-xs text-sub hover:seal-text hover:seal-soft-bg">
            <BookOpen size={13} />封面
          </button>
        </div>

        <div className="space-y-3 border-t-[1.5px] rule-strong-border p-3">
          <div className="folio-card p-2">
            <p className="mb-2 font-mono-tab text-[9px] tracking-[0.16em] text-aux">取证流程追踪</p>
            <div className="space-y-1">
              {FLOW_STEPS.map((step, index) => (
                <div key={step} className="flex items-center gap-2 text-[10px]">
                  <span className={`font-mono-tab ${index < flowStep ? 'teal-text' : index === flowStep ? 'amber-text' : 'text-aux'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={index < flowStep ? 'text-sub' : index === flowStep ? 'text-main' : 'text-aux'}>{step}</span>
                  {index < flowStep && <span className="ml-auto teal-text">✓</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="folio-card p-2">
              <p className="font-display text-lg text-main">{totalCount}</p>
              <p className="text-[9px] text-aux">病例总数</p>
            </div>
            <div className="folio-card p-2">
              <p className="font-display text-lg teal-text">86.7%</p>
              <p className="text-[9px] text-aux">评测 Top-1</p>
            </div>
            <div className="folio-card p-2">
              <p className="font-display text-lg text-main">2 步</p>
              <p className="text-[9px] text-aux">平均收敛</p>
            </div>
            <div className="folio-card p-2">
              <p className="font-display text-lg seal-text">1 变量</p>
              <p className="text-[9px] text-aux">单变量原则</p>
            </div>
          </div>
          <p className="font-mono-tab text-[9px] leading-4 text-aux">快捷键 1/2/3 作答 · R 重置<br />本地存证 · 不上传原始图片</p>
        </div>
      </aside>
    </>
  )
}

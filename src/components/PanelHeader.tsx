import type { ReactNode } from 'react'

interface PanelHeaderProps {
  index: string
  title: string
  english: string
  action?: ReactNode
}

export default function PanelHeader({ index, title, english, action }: PanelHeaderProps) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[10px] text-truth">{index}</span>
        <h2 className="text-sm font-medium tracking-wide">{title}</h2>
      </div>
      <div className="flex items-center gap-3">
        {action}
        <span className="font-mono text-[10px] tracking-[0.16em] text-ink-muted">{english}</span>
      </div>
    </div>
  )
}

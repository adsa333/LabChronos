import { useEffect, useState } from 'react'
import { Send, ShieldCheck, X } from 'lucide-react'
import { createRoom, listRooms, pushEntry } from '../lib/museumApi'
import type { MuseumRoom, SharedCaseDraft, SharedCaseEntry } from '../lib/museumApi'

interface ShareToRoomDialogProps {
  open: boolean
  draft: SharedCaseDraft | null
  onClose: () => void
  onPushed: (room: MuseumRoom, entry: SharedCaseEntry) => void
}

export default function ShareToRoomDialog({ open, draft, onClose, onPushed }: ShareToRoomDialogProps) {
  const [rooms, setRooms] = useState<MuseumRoom[]>([])
  const [selected, setSelected] = useState('')
  const [newRoom, setNewRoom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setBusy(false)
    void listRooms().then((next) => {
      setRooms(next)
      setSelected((current) => (next.some((room) => room.code === current) ? current : next[0]?.code ?? ''))
    })
  }, [open])

  if (!open || !draft) return null

  async function handleCreate() {
    if (!newRoom.trim()) return
    setBusy(true)
    const room = await createRoom(newRoom)
    setRooms((list) => [room, ...list])
    setSelected(room.code)
    setNewRoom('')
    setBusy(false)
  }

  async function handlePush() {
    if (!selected || !draft) return
    setBusy(true)
    setError('')
    try {
      const entry = await pushEntry(selected, draft)
      const room = rooms.find((item) => item.code === selected)
      if (room) onPushed(room, entry)
      onClose()
    } catch {
      setError('推送失败，稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-[440px] border-[1.5px] rule-strong-border surface-folio p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-main">推送到课题组馆</h3>
            <p className="mt-1 font-mono-tab text-[10px] tracking-[0.14em] text-aux">SHARE TO TEAM ROOM</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="text-aux hover:text-main"><X size={15} /></button>
        </div>

        <p className="mt-3 flex items-start gap-1.5 border rule-border px-2.5 py-2 text-[11px] leading-5 text-sub">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 teal-text" />
          自动剥离原图，只传脱敏证据与处方：{draft.truthTitle} · {Math.round(draft.probability * 100)}%
        </p>

        <div className="mt-3 max-h-[38vh] space-y-1.5 overflow-y-auto">
          {rooms.map((room) => (
            <button
              key={room.code}
              type="button"
              onClick={() => setSelected(room.code)}
              className={`flex w-full items-center justify-between border px-3 py-2 text-left ${room.code === selected ? 'rule-strong-border seal-soft-bg' : 'rule-border hover:teal-soft-bg'}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-display text-xs font-semibold text-main">{room.name}</span>
                <span className="font-mono-tab text-[10px] text-aux">{room.code} · {room.memberCount} 人 · {room.entryCount} 条</span>
              </span>
              {room.code === selected && <span className="font-mono-tab text-[10px] seal-text">已选</span>}
            </button>
          ))}
          {rooms.length === 0 && <p className="text-[11px] text-aux">还没有加入任何馆，先建一个。</p>}
        </div>

        <div className="mt-3 flex gap-1.5">
          <input
            value={newRoom}
            onChange={(event) => setNewRoom(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void handleCreate() }}
            placeholder="新建一个馆，如 视觉组 · 周三组会"
            className="min-w-0 flex-1 border rule-border bg-transparent px-2 py-1.5 text-[11px] text-main outline-none focus:rule-strong-border"
          />
          <button type="button" onClick={() => void handleCreate()} disabled={!newRoom.trim() || busy} className="btn-ghost px-2 py-1.5 text-[11px] disabled:opacity-50">建馆</button>
        </div>

        {error && <p className="mt-2 text-[11px] seal-text">{error}</p>}

        <div className="mt-4 flex justify-end gap-2 border-t rule-border pt-3">
          <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs">取消</button>
          <button type="button" onClick={() => void handlePush()} disabled={!selected || busy} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            <Send size={13} />{busy ? '推送中…' : '推送'}
          </button>
        </div>
      </div>
    </div>
  )
}

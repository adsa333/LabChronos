import { useCallback, useEffect, useState } from 'react'
import { Hash, MessageSquare, Plus, Repeat, ThumbsUp, Users } from 'lucide-react'
import {
  addComment,
  createRoom,
  getIdentity,
  joinRoom,
  leaveRoom,
  listEntries,
  listRooms,
  markSameTrap,
  updateNickname,
} from '../lib/museumApi'
import type { MuseumRoom, SharedCaseEntry } from '../lib/museumApi'

interface SharedMuseumProps {
  onReplay: (entry: SharedCaseEntry) => void
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function diffLine(entry: SharedCaseEntry): string {
  const first = entry.paramDiff[0]
  if (!first) return '单变量处方待补'
  return `${first.key}：${first.before} → ${first.after}`
}

export default function SharedMuseum({ onReplay }: SharedMuseumProps) {
  const [rooms, setRooms] = useState<MuseumRoom[]>([])
  const [activeCode, setActiveCode] = useState('')
  const [entries, setEntries] = useState<SharedCaseEntry[]>([])
  const [nickname, setNickname] = useState(getIdentity().nickname)
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [creating, setCreating] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [detail, setDetail] = useState<SharedCaseEntry | null>(null)
  const [commentText, setCommentText] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshRooms = useCallback(async (prefer?: string) => {
    const next = await listRooms()
    setRooms(next)
    setActiveCode((current) => {
      const target = prefer ?? current
      if (target && next.some((room) => room.code === target)) return target
      return next[0]?.code ?? ''
    })
  }, [])

  useEffect(() => {
    let alive = true
    void listRooms().then((next) => {
      if (!alive) return
      setRooms(next)
      setActiveCode((current) => (current && next.some((room) => room.code === current) ? current : next[0]?.code ?? ''))
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!activeCode) return
    let alive = true
    void listEntries(activeCode).then((next) => { if (alive) setEntries(next) })
    return () => { alive = false }
  }, [activeCode])

  async function handleJoin() {
    const code = joinCode.trim()
    if (code.length < 4) { setJoinError('馆号至少 4 位'); return }
    const room = await joinRoom(code)
    if (!room) { setJoinError('没有这个馆，或馆号已失效'); return }
    setJoinError('')
    setJoinCode('')
    await refreshRooms(room.code)
  }

  async function handleCreate() {
    if (!roomName.trim()) return
    setBusy(true)
    const room = await createRoom(roomName)
    setRoomName('')
    setCreating(false)
    setBusy(false)
    await refreshRooms(room.code)
  }

  async function handleLeave(code: string) {
    const room = rooms.find((item) => item.code === code)
    if (!room || room.pinned) return
    if (!window.confirm('退出这个馆？本地不会删除已推送的存证')) return
    await leaveRoom(code)
    await refreshRooms()
  }

  async function handleSameTrap(entry: SharedCaseEntry) {
    if (entry.trappedByMe) return
    const count = await markSameTrap(entry.roomCode, entry.id)
    setEntries((list) => list.map((item) => item.id === entry.id ? { ...item, sameTrap: count, trappedByMe: true } : item))
    setDetail((current) => current && current.id === entry.id ? { ...current, sameTrap: count, trappedByMe: true } : current)
  }

  async function handleComment() {
    if (!detail || !commentText.trim()) return
    const comment = await addComment(detail.roomCode, detail.id, commentText)
    const next = { ...detail, comments: [...detail.comments, comment] }
    setDetail(next)
    setEntries((list) => list.map((item) => item.id === next.id ? next : item))
    setCommentText('')
  }

  const activeRoom = rooms.find((room) => room.code === activeCode)
  const visibleEntries = activeCode ? entries : []

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[196px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col gap-3 lg:border-r lg:rule-border lg:pr-4">
        <div className="flex items-center justify-between">
          <span className="font-mono-tab text-[10px] tracking-[0.18em] text-aux">JOINED ROOMS</span>
          <button type="button" aria-label="创建新馆" onClick={() => setCreating((value) => !value)} className="flex h-6 w-6 items-center justify-center border rule-border text-sub hover:teal-text">
            <Plus size={12} />
          </button>
        </div>

        {creating && (
          <div className="space-y-2 border rule-border p-2">
            <input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="馆名，如 电化学组" className="w-full border rule-border bg-transparent px-2 py-1.5 text-xs text-main outline-none focus:rule-strong-border" />
            <button type="button" disabled={busy || !roomName.trim()} onClick={() => void handleCreate()} className="btn-primary w-full px-2 py-1.5 text-[11px] disabled:opacity-50">建馆</button>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {rooms.map((room) => (
            <button
              key={room.code}
              type="button"
              onClick={() => setActiveCode(room.code)}
              className={`w-full border px-2.5 py-2 text-left ${room.code === activeCode ? 'rule-strong-border seal-soft-bg' : 'rule-border hover:teal-soft-bg'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono-tab text-[10px] text-aux">{room.pinned ? 'SAMPLE' : room.code}</span>
                <span className="font-mono-tab text-[10px] text-aux">{room.entryCount}</span>
              </div>
              <p className="mt-0.5 truncate font-display text-xs font-semibold text-main">{room.name}</p>
            </button>
          ))}
          {rooms.length === 0 && <p className="text-[11px] leading-5 text-aux">还没有加入任何馆。用馆号加入，或自己建一个。</p>}
        </div>

        <div className="shrink-0 space-y-1.5 border-t rule-border pt-2">
          <div className="flex items-center gap-1 font-mono-tab text-[10px] text-aux"><Hash size={11} />输入馆号加入</div>
          <div className="flex gap-1">
            <input
              value={joinCode}
              onChange={(event) => { setJoinCode(event.target.value.toUpperCase()); setJoinError('') }}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleJoin() }}
              placeholder="LAB-2826"
              className="min-w-0 flex-1 border rule-border bg-transparent px-2 py-1.5 font-mono-tab text-[11px] uppercase tracking-wider text-main outline-none focus:rule-strong-border"
            />
            <button type="button" onClick={() => void handleJoin()} className="btn-ghost px-2 py-1.5 text-[11px]">加入</button>
          </div>
          {joinError && <p className="text-[10px] seal-text">{joinError}</p>}
        </div>
      </aside>

      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-semibold text-main">{activeRoom?.name ?? '课题组共享馆'}</h3>
            <p className="font-mono-tab text-[10px] text-aux">
              {activeRoom ? `${activeRoom.code} · ${activeRoom.memberCount} 人 · ${visibleEntries.length} 条存证` : '选一个馆，或输入馆号加入'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="border border-dashed rule-border px-1.5 py-0.5 font-mono-tab text-[9.5px] text-aux">本地 Mock · 仅存本机</span>
            <span className="flex items-center gap-1 font-mono-tab text-[10px] text-aux"><Users size={11} />{nickname}</span>
            <button
              type="button"
              onClick={() => {
                const next = window.prompt('改个昵称，群馆里别人看到的就是它', nickname)
                if (next) void updateNickname(next).then((identity) => setNickname(identity.nickname))
              }}
              className="border rule-border px-2 py-1 text-[10px] text-sub hover:teal-text"
            >改名</button>
            {activeRoom && !activeRoom.pinned && (
              <button type="button" onClick={() => void handleLeave(activeRoom.code)} className="border rule-border px-2 py-1 text-[10px] text-sub hover:seal-text">退出</button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {visibleEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="font-display text-sm text-main">这个馆还没有存证</p>
              <p className="text-[11px] text-aux">锁定真因后，在处方区点「推送到课题组馆」</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
              {visibleEntries.map((entry) => (
                <article key={entry.id} className="folio-card flex flex-col gap-2 p-3">
                  <div className="flex items-center justify-between font-mono-tab text-[10px] text-aux">
                    <span>{entry.authorName}</span>
                    <span>{formatTime(entry.createdAt)}</span>
                  </div>
                  <button type="button" onClick={() => setDetail(entry)} className="text-left">
                    <h4 className="line-clamp-2 font-display text-[14px] font-semibold leading-5 text-main">{entry.title}</h4>
                    <p className="mt-1 line-clamp-1 text-[11px] teal-text">真因：{entry.truthTitle}</p>
                  </button>
                  <p className="truncate border-t rule-border pt-1.5 font-mono-tab text-[10px] text-sub">{diffLine(entry)}</p>
                  <div className="mt-auto flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => void handleSameTrap(entry)}
                      disabled={entry.trappedByMe}
                      className={`flex items-center gap-1 border px-1.5 py-1 text-[10px] ${entry.trappedByMe ? 'rule-border text-aux' : 'rule-border text-sub hover:seal-text'}`}
                    >
                      <ThumbsUp size={11} />踩过同坑 {entry.sameTrap}
                    </button>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setDetail(entry)} aria-label="复盘批注" className="flex items-center gap-1 border rule-border px-1.5 py-1 text-[10px] text-sub hover:teal-text">
                        <MessageSquare size={11} />{entry.comments.length}
                      </button>
                      <button type="button" onClick={() => onReplay(entry)} className="flex items-center gap-1 border rule-border px-1.5 py-1 text-[10px] text-sub hover:teal-text">
                        <Repeat size={11} />重演
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="群馆存证详情" onClick={() => setDetail(null)}>
          <div className="flex max-h-[86vh] w-full max-w-[620px] flex-col border-[1.5px] rule-strong-border surface-folio p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono-tab text-[10px] text-aux">{detail.roomCode} · {detail.authorName} · {formatTime(detail.createdAt)}</p>
                <h3 className="mt-1 font-display text-base font-semibold leading-6 text-main">{detail.title}</h3>
                <p className="mt-1 text-xs teal-text">真因：{detail.truthTitle}（{Math.round(detail.probability * 100)}%）</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-aux hover:text-main">关闭</button>
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <div>
                <p className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">MINIMAL CONTROL</p>
                <p className="mt-1 text-[12px] leading-5 text-main">{detail.action}</p>
                <ul className="mt-1.5 space-y-1">
                  {detail.paramDiff.map((item) => (
                    <li key={item.key} className="flex items-center gap-2 border rule-border px-2 py-1 font-mono-tab text-[10px]">
                      <span className="text-aux">{item.key}</span>
                      <span className="seal-text line-through">{item.before}</span>
                      <span className="text-aux">→</span>
                      <span className="font-bold teal-text">{item.after}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">脱敏证据</p>
                <p className="mt-1 text-[12px] leading-5 text-sub">{detail.symptomSummary}</p>
              </div>

              <div>
                <p className="font-mono-tab text-[10px] tracking-[0.16em] text-aux">复盘批注 · {detail.comments.length}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {detail.comments.map((comment) => (
                    <li key={comment.id} className="border rule-border px-2 py-1.5">
                      <p className="font-mono-tab text-[10px] text-aux">{comment.authorName} · {formatTime(comment.createdAt)}</p>
                      <p className="text-[12px] leading-5 text-main">{comment.text}</p>
                    </li>
                  ))}
                  {detail.comments.length === 0 && <li className="text-[11px] text-aux">还没有批注</li>}
                </ul>
                <div className="mt-2 flex gap-1">
                  <input
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void handleComment() }}
                    placeholder="补一句你踩过的坑…"
                    className="min-w-0 flex-1 border rule-border bg-transparent px-2 py-1.5 text-[11px] text-main outline-none focus:rule-strong-border"
                  />
                  <button type="button" onClick={() => void handleComment()} className="btn-ghost px-2 py-1.5 text-[11px]">批注</button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t rule-border pt-3">
              <button type="button" onClick={() => void handleSameTrap(detail)} disabled={detail.trappedByMe} className="flex items-center gap-1 border rule-border px-2 py-1.5 text-[11px] text-sub hover:seal-text disabled:opacity-50">
                <ThumbsUp size={12} />我也踩过这个坑 · {detail.sameTrap}
              </button>
              <button type="button" onClick={() => { onReplay(detail); setDetail(null) }} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <Repeat size={13} />载入我的工作台重演
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

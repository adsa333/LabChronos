import type { DiagnosisResult } from '../types/diagnosis'
import type { Answers } from './scoring'
import { presets } from '../data/presets'

/**
 * 课题组共享馆 —— 前端契约（A 维护，B 按此实现服务端）。
 *
 * 约定：所有接口都是 async，失败时 reject，由 UI 捕获并静默回落到本地；
 * 传输内容不含原图，只传脱敏证据（症状摘要 + 日志片段）与处方。
 * Mock 阶段用 localStorage 落盘（key: labchronos.museum.mock.v1），
 * B 接通后只需把下面 7 个函数换成 fetch。
 */

export interface MuseumIdentity {
  id: string
  nickname: string
}

export interface MuseumRoom {
  code: string
  name: string
  joinedAt: number
  isOwner: boolean
  memberCount: number
  entryCount: number
  pinned?: boolean
}

export interface MuseumComment {
  id: string
  authorName: string
  text: string
  createdAt: number
}

export interface ParamDiffItem {
  key: string
  before: string
  after: string
}

export interface SharedCaseEntry {
  id: string
  roomCode: string
  authorId: string
  authorName: string
  createdAt: number
  title: string
  domain: string
  truthTitle: string
  probability: number
  lockedId: string | null
  action: string
  paramDiff: ParamDiffItem[]
  symptomSummary: string
  log: string
  answers: Answers
  diagnosis: DiagnosisResult
  sameTrap: number
  trappedByMe: boolean
  comments: MuseumComment[]
}

export interface SharedCaseDraft {
  title: string
  domain: string
  truthTitle: string
  probability: number
  lockedId: string | null
  action: string
  paramDiff: ParamDiffItem[]
  symptomSummary: string
  log: string
  answers: Answers
  diagnosis: DiagnosisResult
}

interface MockState {
  identity: MuseumIdentity
  rooms: MuseumRoom[]
  entries: Record<string, SharedCaseEntry[]>
  joined: string[]
}

const STORAGE_KEY = 'labchronos.museum.mock.v1'
const SAMPLE_ROOM = 'LAB-2826'
const SAMPLE_ROOM_NAME = '课题组共享馆 · 示例'

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let index = 0; index < 4; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `LAB-${code}`
}

function presetEntry(presetIndex: number, roomCode: string, authorName: string, sameTrap: number, comments: MuseumComment[]): SharedCaseEntry {
  const preset = presets[presetIndex]
  const diagnosis = preset.diagnosis
  const truth = diagnosis.hypotheses[0]
  return {
    id: makeId('shared'),
    roomCode,
    authorId: 'seed-' + authorName,
    authorName,
    createdAt: Date.now() - (presetIndex + 1) * 36 * 60 * 1000,
    title: diagnosis.caseTitle,
    domain: diagnosis.domain,
    truthTitle: truth.title,
    probability: 0.63 - presetIndex * 0.03,
    lockedId: truth.id,
    action: truth.minimalControl.action,
    paramDiff: truth.minimalControl.paramDiff,
    symptomSummary: diagnosis.observedSymptoms.find((item) => item.severity === 'critical')?.label ?? diagnosis.observedSymptoms[0].label,
    log: preset.log.split('\n').slice(0, 8).join('\n'),
    answers: { [diagnosis.questions[0].id]: 1 },
    diagnosis,
    sameTrap,
    trappedByMe: false,
    comments,
  }
}

function seedState(): MockState {
  const now = Date.now()
  const aiEntry = presetEntry(0, SAMPLE_ROOM, '陈师姐', 4, [
    { id: makeId('c'), authorName: '李博', text: '我们组复现过，确实是 GradScaler 那一步没跳过。', createdAt: now - 40 * 60 * 1000 },
  ])
  const gelEntry = presetEntry(1, SAMPLE_ROOM, '李博', 2, [])
  const scopeEntry = presetEntry(2, 'LAB-1742', '王工', 1, [])
  return {
    identity: { id: makeId('user'), nickname: '匿名研究员' },
    rooms: [
      {
        code: SAMPLE_ROOM,
        name: SAMPLE_ROOM_NAME,
        joinedAt: now - 3 * 24 * 3600 * 1000,
        isOwner: false,
        memberCount: 6,
        entryCount: 2,
        pinned: true,
      },
    ],
    entries: { [SAMPLE_ROOM]: [aiEntry, gelEntry], 'LAB-1742': [scopeEntry] },
    joined: [SAMPLE_ROOM],
  }
}

const SERVER_ROOMS: Record<string, string> = {
  [SAMPLE_ROOM]: SAMPLE_ROOM_NAME,
  'LAB-1742': '电化学组 · 夜间实验',
}

function readState(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const seeded = seedState()
      writeState(seeded)
      return seeded
    }
    const parsed = JSON.parse(raw) as MockState
    if (!parsed.identity || !Array.isArray(parsed.rooms) || !parsed.entries) return seedState()
    return parsed
  } catch {
    return seedState()
  }
}

function writeState(state: MockState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 配额满时静默失败：博物馆是 P1 亮点，不允许阻断主流程 */
  }
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 60))
}

export function getIdentity(): MuseumIdentity {
  return readState().identity
}

export function updateNickname(nickname: string): Promise<MuseumIdentity> {
  const state = readState()
  state.identity = { ...state.identity, nickname: nickname.trim().slice(0, 12) || '匿名研究员' }
  writeState(state)
  return delay(state.identity)
}

export function listRooms(): Promise<MuseumRoom[]> {
  const state = readState()
  const rooms = state.rooms
    .filter((room) => state.joined.includes(room.code))
    .map((room) => ({ ...room, entryCount: state.entries[room.code]?.length ?? 0 }))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  return delay(rooms)
}

export function createRoom(name: string): Promise<MuseumRoom> {
  const state = readState()
  const room: MuseumRoom = {
    code: randomCode(),
    name: name.trim().slice(0, 20) || '我的课题组馆',
    joinedAt: Date.now(),
    isOwner: true,
    memberCount: 1,
    entryCount: 0,
  }
  state.rooms = [room, ...state.rooms]
  state.joined = [room.code, ...state.joined]
  state.entries[room.code] = []
  writeState(state)
  return delay(room)
}

export function joinRoom(rawCode: string): Promise<MuseumRoom | null> {
  const code = rawCode.trim().toUpperCase()
  const state = readState()
  const existing = state.rooms.find((room) => room.code === code)
  if (existing) {
    if (!state.joined.includes(code)) {
      state.joined = [...state.joined, code]
      writeState(state)
    }
    return delay({ ...existing, entryCount: state.entries[code]?.length ?? 0 })
  }
  const name = SERVER_ROOMS[code]
  if (!name) return delay(null)
  const room: MuseumRoom = {
    code,
    name,
    joinedAt: Date.now(),
    isOwner: false,
    memberCount: 3,
    entryCount: state.entries[code]?.length ?? 0,
  }
  state.rooms = [...state.rooms, room]
  state.joined = [...state.joined, code]
  writeState(state)
  return delay(room)
}

export function leaveRoom(code: string): Promise<void> {
  const state = readState()
  state.joined = state.joined.filter((item) => item !== code)
  state.rooms = state.rooms.filter((room) => room.code !== code || room.pinned)
  writeState(state)
  return delay(undefined)
}

export function listEntries(code: string): Promise<SharedCaseEntry[]> {
  const state = readState()
  const entries = [...(state.entries[code] ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  return delay(entries)
}

export function pushEntry(code: string, draft: SharedCaseDraft): Promise<SharedCaseEntry> {
  const state = readState()
  const entry: SharedCaseEntry = {
    ...draft,
    id: makeId('shared'),
    roomCode: code,
    authorId: state.identity.id,
    authorName: state.identity.nickname,
    createdAt: Date.now(),
    sameTrap: 0,
    trappedByMe: false,
    comments: [],
  }
  state.entries[code] = [entry, ...(state.entries[code] ?? [])]
  const room = state.rooms.find((item) => item.code === code)
  if (room) room.entryCount = state.entries[code].length
  writeState(state)
  return delay(entry)
}

export function markSameTrap(code: string, entryId: string): Promise<number> {
  const state = readState()
  const list = state.entries[code] ?? []
  const entry = list.find((item) => item.id === entryId)
  if (!entry) return Promise.reject(new Error('entry_not_found'))
  if (!entry.trappedByMe) {
    entry.trappedByMe = true
    entry.sameTrap += 1
  }
  writeState(state)
  return delay(entry.sameTrap)
}

export function addComment(code: string, entryId: string, text: string): Promise<MuseumComment> {
  const state = readState()
  const entry = (state.entries[code] ?? []).find((item) => item.id === entryId)
  if (!entry) return Promise.reject(new Error('entry_not_found'))
  const comment: MuseumComment = {
    id: makeId('c'),
    authorName: state.identity.nickname,
    text: text.trim().slice(0, 140),
    createdAt: Date.now(),
  }
  entry.comments = [...entry.comments, comment]
  writeState(state)
  return delay(comment)
}

/** 测试与演示用：清空 Mock 数据回到种子状态 */
export function resetMockMuseum(): void {
  localStorage.removeItem(STORAGE_KEY)
}

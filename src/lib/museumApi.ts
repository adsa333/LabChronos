import type { DiagnosisResult } from '../types/diagnosis'
import type { Answers } from './scoring'
import { presets } from '../data/presets'

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
const API_BASE = import.meta.env.DEV ? '/api/museum' : '/functions/v1/app/api/museum'

let syncMode: 'cloud' | 'local' = 'local'

class MuseumHttpError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function getMuseumSyncMode(): 'cloud' | 'local' {
  return syncMode
}

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
    if (!parsed.identity || !Array.isArray(parsed.rooms) || !parsed.entries || !Array.isArray(parsed.joined)) {
      const seeded = seedState()
      writeState(seeded)
      return seeded
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const identity = getIdentity()
  const headers: Record<string, string> = {
    'X-Museum-User-Id': identity.id,
    'X-Museum-Nickname': encodeURIComponent(identity.nickname),
  }
  if (init.body) headers['content-type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  })

  const isJson = response.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false
  let payload: unknown = null
  if (isJson) {
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    const code = isRecord(payload) && typeof payload.error === 'string' ? payload.error : `http_${response.status}`
    throw new MuseumHttpError(response.status, code)
  }
  if (!isJson || payload === null) throw new TypeError('museum_invalid_response')
  return payload as T
}

function isFallbackError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof MuseumHttpError && error.status >= 500)
}

async function cloudWithFallback<T>(cloud: () => Promise<T>, local: () => T | Promise<T>): Promise<T> {
  try {
    const result = await cloud()
    syncMode = 'cloud'
    return result
  } catch (error) {
    if (!isFallbackError(error)) throw error
    syncMode = 'local'
    return local()
  }
}

function rememberRooms(rooms: MuseumRoom[]): void {
  const state = readState()
  state.rooms = rooms
  state.joined = rooms.map((room) => room.code)
  writeState(state)
}

function rememberRoom(room: MuseumRoom): void {
  const state = readState()
  state.rooms = [room, ...state.rooms.filter((item) => item.code !== room.code)]
  state.joined = [...new Set([room.code, ...state.joined])]
  if (!state.entries[room.code]) state.entries[room.code] = []
  writeState(state)
}

function localUpdateNickname(nickname: string): MuseumIdentity {
  const state = readState()
  state.identity = { ...state.identity, nickname: nickname.trim().slice(0, 16) || '匿名研究员' }
  writeState(state)
  return state.identity
}

function localListRooms(): MuseumRoom[] {
  const state = readState()
  return state.rooms
    .filter((room) => state.joined.includes(room.code))
    .map((room) => ({ ...room, entryCount: state.entries[room.code]?.length ?? 0 }))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
}

function localCreateRoom(name: string): MuseumRoom {
  const state = readState()
  const room: MuseumRoom = {
    code: randomCode(),
    name: name.trim().slice(0, 24) || '我的课题组馆',
    joinedAt: Date.now(),
    isOwner: true,
    memberCount: 1,
    entryCount: 0,
  }
  state.rooms = [room, ...state.rooms]
  state.joined = [room.code, ...state.joined]
  state.entries[room.code] = []
  writeState(state)
  return room
}

function localJoinRoom(rawCode: string): MuseumRoom | null {
  const code = rawCode.trim().toUpperCase()
  const state = readState()
  const existing = state.rooms.find((room) => room.code === code)
  if (existing) {
    if (!state.joined.includes(code)) {
      state.joined = [...state.joined, code]
      writeState(state)
    }
    return { ...existing, entryCount: state.entries[code]?.length ?? 0 }
  }
  const name = SERVER_ROOMS[code]
  if (!name) return null
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
  return room
}

function localLeaveRoom(code: string): void {
  const state = readState()
  if (state.rooms.some((room) => room.code === code && room.pinned)) return
  state.joined = state.joined.filter((item) => item !== code)
  state.rooms = state.rooms.filter((room) => room.code !== code)
  writeState(state)
}

function localListEntries(code: string): SharedCaseEntry[] {
  const state = readState()
  return [...(state.entries[code] ?? [])].sort((a, b) => b.createdAt - a.createdAt)
}

function localPushEntry(code: string, draft: SharedCaseDraft): SharedCaseEntry {
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
  return entry
}

function localMarkSameTrap(code: string, entryId: string): number {
  const state = readState()
  const entry = (state.entries[code] ?? []).find((item) => item.id === entryId)
  if (!entry) throw new Error('entry_not_found')
  if (!entry.trappedByMe) {
    entry.trappedByMe = true
    entry.sameTrap += 1
  }
  writeState(state)
  return entry.sameTrap
}

function localAddComment(code: string, entryId: string, text: string): MuseumComment {
  const state = readState()
  const entry = (state.entries[code] ?? []).find((item) => item.id === entryId)
  if (!entry) throw new Error('entry_not_found')
  const comment: MuseumComment = {
    id: makeId('c'),
    authorName: state.identity.nickname,
    text: text.trim().slice(0, 140),
    createdAt: Date.now(),
  }
  entry.comments = [...entry.comments, comment]
  writeState(state)
  return comment
}

export function getIdentity(): MuseumIdentity {
  return readState().identity
}

export function updateNickname(nickname: string): Promise<MuseumIdentity> {
  const normalized = nickname.trim().slice(0, 16) || '匿名研究员'
  return cloudWithFallback(async () => {
    const identity = await requestJson<MuseumIdentity>('/identity', {
      method: 'POST',
      body: JSON.stringify({ nickname: normalized }),
    })
    const state = readState()
    state.identity = { id: state.identity.id, nickname: identity.nickname }
    writeState(state)
    return state.identity
  }, () => delay(localUpdateNickname(normalized)))
}

export function listRooms(): Promise<MuseumRoom[]> {
  return cloudWithFallback(async () => {
    const rooms = await requestJson<MuseumRoom[]>('/rooms')
    rememberRooms(rooms)
    return rooms
  }, () => delay(localListRooms()))
}

export function createRoom(name: string): Promise<MuseumRoom> {
  return cloudWithFallback(async () => {
    const room = await requestJson<MuseumRoom>('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    rememberRoom(room)
    return room
  }, () => delay(localCreateRoom(name)))
}

export async function joinRoom(rawCode: string): Promise<MuseumRoom | null> {
  try {
    const room = await requestJson<MuseumRoom>('/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ code: rawCode.trim().toUpperCase() }),
    })
    syncMode = 'cloud'
    rememberRoom(room)
    return room
  } catch (error) {
    if (error instanceof MuseumHttpError && (error.status === 404 || error.status === 400)) return null
    if (!isFallbackError(error)) throw error
    syncMode = 'local'
    return delay(localJoinRoom(rawCode))
  }
}

export function leaveRoom(code: string): Promise<void> {
  return cloudWithFallback(async () => {
    await requestJson<{ ok: true }>(`/rooms/${encodeURIComponent(code)}/leave`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    localLeaveRoom(code)
  }, () => delay(localLeaveRoom(code)))
}

export function listEntries(code: string): Promise<SharedCaseEntry[]> {
  return cloudWithFallback(async () => {
    return requestJson<SharedCaseEntry[]>(`/rooms/${encodeURIComponent(code)}/entries`)
  }, () => delay(localListEntries(code)))
}

export function pushEntry(code: string, draft: SharedCaseDraft): Promise<SharedCaseEntry> {
  return cloudWithFallback(async () => {
    return requestJson<SharedCaseEntry>(`/rooms/${encodeURIComponent(code)}/entries`, {
      method: 'POST',
      body: JSON.stringify(draft),
    })
  }, () => delay(localPushEntry(code, draft)))
}

export function markSameTrap(code: string, entryId: string): Promise<number> {
  return cloudWithFallback(async () => {
    const result = await requestJson<{ sameTrap: number; trappedByMe: true }>(
      `/rooms/${encodeURIComponent(code)}/entries/${encodeURIComponent(entryId)}/trap`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    return result.sameTrap
  }, () => delay(localMarkSameTrap(code, entryId)))
}

export function addComment(code: string, entryId: string, text: string): Promise<MuseumComment> {
  return cloudWithFallback(async () => {
    return requestJson<MuseumComment>(
      `/rooms/${encodeURIComponent(code)}/entries/${encodeURIComponent(entryId)}/comments`,
      { method: 'POST', body: JSON.stringify({ text }) },
    )
  }, () => delay(localAddComment(code, entryId, text)))
}

/** 测试与演示用：清空 Mock 数据回到种子状态 */
export function resetMockMuseum(): void {
  syncMode = 'local'
  localStorage.removeItem(STORAGE_KEY)
}
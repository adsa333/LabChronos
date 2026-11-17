import type { DiagnosisResult } from '../types/diagnosis'
import type { Answers } from './scoring'
import { compressImage } from './api'

const STORAGE_KEY = 'labchronos.customCase.v1'
const DB_NAME = 'labchronos'
const STORE_NAME = 'images'
const DB_VERSION = 1

export interface CustomCaseRecord {
  id: string
  diagnosis: DiagnosisResult
  log: string
  conditions: string
  answers: Answers
  createdAt: number
  hasImage: boolean
}

export interface LoadedCustomCase {
  caseData: CustomCaseRecord
  imageBlob: Blob | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRecord(): CustomCaseRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.createdAt !== 'number' ||
      typeof value.hasImage !== 'boolean' || typeof value.log !== 'string' || typeof value.conditions !== 'string' ||
      !isRecord(value.diagnosis) || !isRecord(value.answers)) return null
    return value as unknown as CustomCaseRecord
  } catch {
    return null
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function writeImage(id: string, blob: Blob) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(blob, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

async function readImage(id: string): Promise<Blob | null> {
  const database = await openDatabase()
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

async function removeImage(id: string) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: 'image/jpeg' })
}

export async function saveCustomCase(caseData: CustomCaseRecord, imageFile?: File): Promise<void> {
  let metadataSaved = false
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(caseData))
    metadataSaved = true
  } catch {}

  if (!metadataSaved || !imageFile) return
  try {
    const compressed = await compressImage(imageFile)
    await writeImage(caseData.id, base64ToBlob(compressed))
  } catch {}
}

export async function loadCustomCase(): Promise<LoadedCustomCase | null> {
  const caseData = readRecord()
  if (!caseData) return null
  let imageBlob: Blob | null = null
  if (caseData.hasImage) {
    try {
      imageBlob = await readImage(caseData.id)
    } catch {}
  }
  return { caseData, imageBlob }
}

export async function deleteCustomCase(id: string): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
  try {
    await removeImage(id)
  } catch {}
}
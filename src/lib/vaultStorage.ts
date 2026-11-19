import type { DiagnosisResult } from '../types/diagnosis'
import { openDb } from './caseStorage'
import type { Answers } from './scoring'

export interface VaultEntry {
  id: string
  createdAt: number
  title: string
  domain: string
  truthTitle: string
  probability: number
  symptomSummary: string
  log: string
  answers: Answers
  diagnosis: DiagnosisResult
  image: Blob | null
  thumb: Blob | null
}

export type VaultSaveResult = { ok: true } | { ok: false; code: 'QUOTA' | 'UNAVAILABLE' }

const VAULT_STORE = 'vault'
const MAX_ENTRIES = 24

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22)
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function compressBlob(blob: Blob, maxEdge: number, quality: number): Promise<Blob | null> {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#0B0F14'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', quality)
    })
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

async function readAll(): Promise<VaultEntry[]> {
  const database = await openDb()
  try {
    const entries = await new Promise<VaultEntry[]>((resolve, reject) => {
      const request = database.transaction(VAULT_STORE, 'readonly').objectStore(VAULT_STORE).getAll()
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as VaultEntry[] : [])
      request.onerror = () => reject(request.error)
    })
    return entries.sort((a, b) => b.createdAt - a.createdAt)
  } finally {
    database.close()
  }
}

async function putEntry(entry: VaultEntry): Promise<void> {
  const database = await openDb()
  try {
    const transaction = database.transaction(VAULT_STORE, 'readwrite')
    transaction.objectStore(VAULT_STORE).put(entry)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

async function removeEntry(id: string): Promise<void> {
  const database = await openDb()
  try {
    const transaction = database.transaction(VAULT_STORE, 'readwrite')
    transaction.objectStore(VAULT_STORE).delete(id)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function saveVaultEntry(entry: VaultEntry): Promise<VaultSaveResult> {
  try {
    const image = entry.image ? await compressBlob(entry.image, 1600, 0.82) : null
    const thumb = image ? await compressBlob(image, 480, 0.72) : null
    const record: VaultEntry = { ...entry, image, thumb }
    let entries = await readAll()
    if (entries.length >= MAX_ENTRIES) {
      const oldest = entries[entries.length - 1]
      await removeEntry(oldest.id)
      entries = entries.slice(0, -1)
    }
    try {
      await putEntry(record)
      return { ok: true }
    } catch (error) {
      if (isQuotaError(error) && entries.length > 0) {
        await removeEntry(entries[entries.length - 1].id)
        try {
          await putEntry(record)
          return { ok: true }
        } catch {
          return { ok: false, code: 'QUOTA' }
        }
      }
      return { ok: false, code: isQuotaError(error) ? 'QUOTA' : 'UNAVAILABLE' }
    }
  } catch {
    return { ok: false, code: 'UNAVAILABLE' }
  }
}

export async function listVaultEntries(): Promise<VaultEntry[]> {
  try {
    return await readAll()
  } catch {
    return []
  }
}

export async function deleteVaultEntry(id: string): Promise<void> {
  try {
    await removeEntry(id)
  } catch {}
}

export async function getVaultImage(id: string): Promise<Blob | null> {
  try {
    const database = await openDb()
    try {
      return await new Promise<Blob | null>((resolve, reject) => {
        const request = database.transaction(VAULT_STORE, 'readonly').objectStore(VAULT_STORE).get(id)
        request.onsuccess = () => {
          const entry = request.result as VaultEntry | undefined
          resolve(entry?.image instanceof Blob ? entry.image : null)
        }
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  } catch {
    return null
  }
}

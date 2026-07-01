import type { SavedProject } from './types'

const LEGACY_STORAGE_KEY = 'red-image-studio.history'
const DB_NAME = 'red-image-studio'
const DB_VERSION = 1
const STORE_NAME = 'history'
const HISTORY_LIMIT = 3

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function parseLegacyHistory(): SavedProject[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function readAllFromDb(db: IDBDatabase): Promise<SavedProject[]> {
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)
  const items = await requestToPromise(store.getAll() as IDBRequest<SavedProject[]>)
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

async function writeAllToDb(db: IDBDatabase, projects: SavedProject[]): Promise<SavedProject[]> {
  const capped = projects.slice(0, HISTORY_LIMIT)

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.clear()
    for (const project of capped) store.put(project)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'))
  })

  return capped
}

export async function loadHistory(): Promise<SavedProject[]> {
  try {
    const db = await openDatabase()
    const current = await readAllFromDb(db)
    if (current.length) return current.slice(0, HISTORY_LIMIT)

    const legacy = parseLegacyHistory().slice(0, HISTORY_LIMIT)
    if (!legacy.length) return []

    const migrated = await writeAllToDb(db, legacy)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return migrated
  } catch {
    return parseLegacyHistory().slice(0, HISTORY_LIMIT)
  }
}

export async function saveHistory(projects: SavedProject[]): Promise<SavedProject[]> {
  const capped = projects.slice(0, HISTORY_LIMIT)
  try {
    const db = await openDatabase()
    const saved = await writeAllToDb(db, capped)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return saved
  } catch {
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(capped))
      return capped
    } catch {
      const withoutImages = capped.map((project) => ({ ...project, images: {} }))
      try {
        localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(withoutImages))
      } catch {
        // Ignore: history is best-effort when browser storage is unavailable.
      }
      return withoutImages
    }
  }
}

export async function rememberProject(project: SavedProject): Promise<SavedProject[]> {
  const current = (await loadHistory()).filter((item) => item.id !== project.id)
  return saveHistory([project, ...current])
}

export async function clearHistory(): Promise<void> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB clear failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB clear aborted'))
    })
  } catch {
    // Ignore: localStorage cleanup below still removes legacy history.
  } finally {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  }
}

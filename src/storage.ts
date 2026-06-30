import type { SavedProject } from './types'

const STORAGE_KEY = 'red-image-studio.history'

export function loadHistory(): SavedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveHistory(projects: SavedProject[]): SavedProject[] {
  const capped = projects.slice(0, 3)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
    return capped
  } catch {
    const withoutImages = capped.map((project) => ({ ...project, images: {} }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutImages))
    return withoutImages
  }
}

export function rememberProject(project: SavedProject): SavedProject[] {
  const current = loadHistory().filter((item) => item.id !== project.id)
  return saveHistory([project, ...current])
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY)
}

import { strToU8, zipSync } from 'fflate'
import type { SavedProject, XhsProject } from './types'

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return new Uint8Array()
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (!/;base64/i.test(meta)) {
    return strToU8(decodeURIComponent(payload))
  }

  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function extFromDataUrl(dataUrl: string): string {
  if (dataUrl.startsWith('data:image/jpeg')) return 'jpg'
  if (dataUrl.startsWith('data:image/webp')) return 'webp'
  if (dataUrl.startsWith('data:image/svg+xml')) return 'svg'
  return 'png'
}

export function exportProjectZip(project: XhsProject, images: Record<string, string>): Blob {
  const payload: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(project, null, 2)),
    'caption.txt': strToU8([
      project.titleOptions[0] ?? project.topic,
      '',
      project.caption,
      '',
      project.tags.map((tag) => `#${tag}`).join(' '),
    ].join('\n')),
  }

  for (const page of project.pages) {
    const image = images[page.id]
    if (!image) continue
    const prefix = `${String(page.index + 1).padStart(2, '0')}-${page.type}`
    payload[`images/${prefix}.${extFromDataUrl(image)}`] = dataUrlToBytes(image)
    payload[`prompts/${prefix}.txt`] = strToU8(page.imagePrompt)
  }

  return new Blob([zipSync(payload)], { type: 'application/zip' })
}

export function toSavedProject(project: XhsProject, images: Record<string, string>): SavedProject {
  return {
    ...project,
    images,
  }
}

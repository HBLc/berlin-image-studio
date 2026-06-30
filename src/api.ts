import type { ComposeRequest, ComposeResponse, GenerateImageRequest, GenerateImageResponse, HealthResponse } from './types'

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health')
  return readJson<HealthResponse>(response)
}

export async function composeProject(request: ComposeRequest): Promise<ComposeResponse> {
  const response = await fetch('/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return readJson<ComposeResponse>(response)
}

export async function generateImage(request: GenerateImageRequest): Promise<GenerateImageResponse> {
  const response = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  return readJson<GenerateImageResponse>(response)
}

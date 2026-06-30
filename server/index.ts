import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import OpenAI from 'openai'
import type { ComposeRequest, GenerateImageRequest, HealthResponse, XhsPage, XhsProject } from '../src/types'
import { createMockImage, createMockProject } from './mock'
import { buildContentPrompt, buildImagePrompt } from './prompts'

dotenv.config()

const app = express()
const port = Number(process.env.PORT || 8787)
const textModel = process.env.OPENAI_TEXT_MODEL || 'gpt-5.5'
const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2'
const apiBaseUrl = (process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1')
  .trim()
  .replace(/\/+$/, '')

app.use(cors())
app.use(express.json({ limit: '32mb' }))

function hasApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

function getClient(): OpenAI {
  if (!hasApiKey()) {
    throw new Error('OPENAI_API_KEY is not configured')
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: apiBaseUrl,
  })
}

function readOutputText(response: unknown): string {
  const payload = response as { output_text?: string; output?: Array<{ content?: Array<{ text?: string; type?: string }> }> }
  if (payload.output_text) return payload.output_text
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? '')
    .join('\n')
    .trim() ?? ''
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) return JSON.parse(fence[1].trim())
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
    throw new Error('The text model did not return valid JSON')
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(/[,\n，]/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function normalizePage(raw: unknown, index: number): XhsPage {
  const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const type = item.type === 'cover' || item.type === 'summary' || item.type === 'content'
    ? item.type
    : index === 0
      ? 'cover'
      : 'content'

  return {
    id: `page-${index}-${Date.now()}`,
    index,
    type,
    headline: String(item.headline || `第 ${index + 1} 页`).trim(),
    subhead: typeof item.subhead === 'string' ? item.subhead.trim() : '',
    bullets: asStringArray(item.bullets).slice(0, 6),
    visualBrief: String(item.visualBrief || '清晰的小红书图文排版').trim(),
    imagePrompt: '',
  }
}

function normalizeProject(raw: unknown, request: ComposeRequest): XhsProject {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const rawPages = Array.isArray(data.pages) ? data.pages : []
  let pages = rawPages.map((item, index) => normalizePage(item, index))
  if (!pages.length) {
    return createMockProject(request)
  }

  pages = pages.slice(0, Math.max(3, request.config.pageCount))
  pages[0] = { ...pages[0], type: 'cover' }
  pages[pages.length - 1] = { ...pages[pages.length - 1], type: 'summary' }
  pages = pages.map((item, index) => ({ ...item, index, id: `page-${index}-${Date.now()}` }))

  const project: XhsProject = {
    id: `project-${Date.now()}`,
    topic: request.topic,
    titleOptions: asStringArray(data.titleOptions).slice(0, 5),
    caption: String(data.caption || '').trim(),
    tags: asStringArray(data.tags).slice(0, 10),
    pages: [],
    createdAt: new Date().toISOString(),
    config: request.config,
  }

  project.pages = pages.map((item) => ({
    ...item,
    imagePrompt: buildImagePrompt({
      topic: project.topic,
      page: item,
      pageType: item.type,
      config: request.config,
      fullPageList: pages,
      hasReference: request.config.useCoverReference && item.index > 0,
    }),
  }))

  if (!project.titleOptions.length) project.titleOptions = [`${request.topic}，这样做更容易被收藏`]
  if (!project.caption) project.caption = `${request.topic}\n\n把重点拆成封面、内容页和总结页，发布前检查标题、封面和标签。`
  if (!project.tags.length) project.tags = ['小红书运营', 'AI出图', '图文排版']

  return project
}

function dataUrlToFile(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid reference image data URL')
  const mime = match[1]
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const buffer = Buffer.from(match[2], 'base64')
  return {
    blob: new Blob([buffer], { type: mime }),
    filename: `reference.${ext}`,
  }
}

function getImageMime(format: string): string {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function buildApiUrl(path: string): string {
  return `${apiBaseUrl}/${path.replace(/^\/+/, '')}`
}

async function getApiErrorMessage(response: Response): Promise<string> {
  const cloned = response.clone()
  try {
    const payload = await response.json() as {
      error?: { message?: string } | string
      detail?: unknown
      message?: string
    }
    if (typeof payload.error === 'object' && payload.error?.message) return payload.error.message
    if (typeof payload.error === 'string') return payload.error
    if (typeof payload.message === 'string') return payload.message
    if (typeof payload.detail === 'string') return payload.detail
    if (Array.isArray(payload.detail)) return payload.detail.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
  } catch {
    try {
      const text = await cloned.text()
      if (text.trim()) return text
    } catch {
      // ignore
    }
  }
  return `HTTP ${response.status}`
}

function normalizeBase64Image(value: string, fallbackMime: string): string {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

async function fetchImageAsDataUrl(url: string, fallbackMime: string): Promise<string> {
  if (url.startsWith('data:')) return url
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') || fallbackMime
  const bytes = Buffer.from(await response.arrayBuffer())
  return `data:${contentType};base64,${bytes.toString('base64')}`
}

async function parseImageApiResponse(response: Response, mime: string): Promise<string> {
  if (!response.ok) throw new Error(await getApiErrorMessage(response))

  const payload = await response.json() as {
    data?: Array<{ b64_json?: string; url?: string }>
    b64_json?: string
    url?: string
  } | Array<{ b64_json?: string; url?: string }>

  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : [payload]

  for (const item of items) {
    if (item?.b64_json) return normalizeBase64Image(item.b64_json, mime)
    if (item?.url) return fetchImageAsDataUrl(item.url, mime)
  }

  throw new Error(`Image API did not return recognizable image data: ${JSON.stringify(payload).slice(0, 1000)}`)
}

async function callImageApi(args: {
  prompt: string
  config: XhsProject['config']
  referenceImage?: string
}): Promise<{ image: string; mime: string }> {
  const { prompt, config, referenceImage } = args
  const mime = getImageMime(config.outputFormat)
  const headers = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPENAI_IMAGE_TIMEOUT_SECONDS || 180) * 1000)

  try {
    if (referenceImage) {
      const formData = new FormData()
      formData.append('model', imageModel)
      formData.append('prompt', prompt)
      formData.append('size', config.size)
      formData.append('quality', config.quality)
      formData.append('output_format', config.outputFormat)
      formData.append('moderation', config.moderation)

      const file = dataUrlToFile(referenceImage)
      formData.append('image[]', file.blob, file.filename)

      const response = await fetch(buildApiUrl('images/edits'), {
        method: 'POST',
        headers,
        body: formData,
        cache: 'no-store',
        signal: controller.signal,
      })
      return { image: await parseImageApiResponse(response, mime), mime }
    }

    const body = {
      model: imageModel,
      prompt,
      size: config.size,
      quality: config.quality,
      output_format: config.outputFormat,
      moderation: config.moderation,
    }

    const response = await fetch(buildApiUrl('images/generations'), {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })
    return { image: await parseImageApiResponse(response, mime), mime }
  } finally {
    clearTimeout(timeout)
  }
}

app.get('/api/health', (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    hasApiKey: hasApiKey(),
    textModel,
    imageModel,
    apiBaseUrl,
  }
  res.json(body)
})

app.post('/api/compose', async (req, res, next) => {
  try {
    const request = req.body as ComposeRequest
    if (!request.topic?.trim()) {
      res.status(400).json({ error: '请输入选题' })
      return
    }

    if (!hasApiKey()) {
      res.json({ project: createMockProject(request) })
      return
    }

    const client = getClient()
    const prompt = buildContentPrompt(request)
    const response = await client.responses.create({
      model: textModel,
      input: [
        {
          role: 'system',
          content: '你只输出严格 JSON。不要解释。不要 Markdown。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    } as never)

    const text = readOutputText(response)
    const parsed = parseJsonObject(text)
    res.json({ project: normalizeProject(parsed, request) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/image', async (req, res, next) => {
  try {
    const request = req.body as GenerateImageRequest
    if (!request.project || !request.page) {
      res.status(400).json({ error: '缺少项目或页面数据' })
      return
    }

    if (!hasApiKey()) {
      res.json({
        image: createMockImage(request),
        mime: 'image/svg+xml',
        model: imageModel,
        mock: true,
      })
      return
    }

    const { page, project } = request
    const config = project.config
    const prompt = page.imagePrompt || buildImagePrompt({
      topic: project.topic,
      page,
      pageType: page.type,
      config,
      fullPageList: project.pages,
      hasReference: Boolean(request.referenceImage),
    })

    const result = await callImageApi({
      prompt,
      config,
      referenceImage: request.referenceImage,
    })

    res.json({
      image: result.image,
      mime: result.mime,
      model: imageModel,
    })
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { message?: string; status?: number; code?: string; request_id?: string }
  res.status(err.status || 500).json({
    error: err.message || 'Request failed',
    code: err.code,
    requestId: err.request_id,
  })
})

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})

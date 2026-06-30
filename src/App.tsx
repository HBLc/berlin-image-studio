import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Check,
  Copy,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { composeProject, generateImage, getHealth, suggestSettings } from './api'
import { exportProjectZip, toSavedProject } from './exportProject'
import { clearHistory, loadHistory, rememberProject, saveHistory } from './storage'
import type { Field, HealthResponse, SavedProject, StudioConfig, VisualStyle, XhsPage, XhsProject } from './types'

const fields: Field[] = ['生活方式', '美妆护肤', '职场效率', '学习成长', '旅行探店', '美食烘焙', '运动健康', '母婴家庭', '家居收纳', '数码工具']
const styles: VisualStyle[] = ['清爽实用', '杂志质感', '手账拼贴', '专业干货', '温暖日常', '科技极简']
const XHS_IMAGE_SIZE = '1200x1600'
const XHS_IMAGE_QUALITY = 'medium'
const XHS_IMAGE_FORMAT = 'png'

const defaultConfig: StudioConfig = {
  field: '生活方式',
  audience: '想提升内容质感的新手创作者',
  visualStyle: '清爽实用',
  pageCount: 8,
  size: XHS_IMAGE_SIZE,
  quality: XHS_IMAGE_QUALITY,
  outputFormat: XHS_IMAGE_FORMAT,
  moderation: 'auto',
  useCoverReference: true,
}

type PageStatus = 'idle' | 'loading' | 'done' | 'error'
type BusyState = 'settings' | 'compose' | 'page' | 'images' | 'all' | null

interface PageDraft {
  headline: string
  subhead: string
  bulletsText: string
  visualBrief: string
  imagePrompt: string
}

function classNames(...items: Array<string | false | undefined>): string {
  return items.filter(Boolean).join(' ')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.click()
}

function copyText(value: string) {
  void navigator.clipboard.writeText(value)
}

function clampPageCount(value: number): number {
  return Math.min(10, Math.max(3, value))
}

function normalizeConfig(value: StudioConfig): StudioConfig {
  return {
    ...value,
    pageCount: clampPageCount(value.pageCount),
    size: XHS_IMAGE_SIZE,
    quality: XHS_IMAGE_QUALITY,
    outputFormat: XHS_IMAGE_FORMAT,
    moderation: 'auto',
  }
}

function pageToDraft(page: XhsPage): PageDraft {
  return {
    headline: page.headline,
    subhead: page.subhead ?? '',
    bulletsText: page.bullets.join('\n'),
    visualBrief: page.visualBrief,
    imagePrompt: page.imagePrompt,
  }
}

function draftToPage(page: XhsPage, draft: PageDraft): XhsPage {
  return {
    ...page,
    headline: draft.headline.trim() || page.headline,
    subhead: draft.subhead.trim(),
    bullets: draft.bulletsText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    visualBrief: draft.visualBrief.trim(),
    imagePrompt: draft.imagePrompt.trim(),
  }
}

function textareaRows(value: string, minRows: number): number {
  const rows = value.split(/\r?\n/).reduce((total, line) => {
    const weightedLength = Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0)
    return total + Math.max(1, Math.ceil(weightedLength / 72))
  }, 0)
  return Math.max(minRows, rows)
}

function buildDraftImagePrompt(project: XhsProject, page: XhsPage): string {
  const pageText = [
    `主标题：${page.headline}`,
    page.subhead ? `副标题：${page.subhead}` : '',
    page.bullets.length ? `要点：${page.bullets.join('；')}` : '',
    page.visualBrief ? `画面：${page.visualBrief}` : '',
  ].filter(Boolean).join('\n')

  const outline = project.pages
    .map((item) => `${item.index + 1}. ${item.id === page.id ? page.headline : item.headline}`)
    .join('\n')

  return [
    '生成一张小红书风格的竖版图文图片。',
    '画面比例 3:4，适合手机阅读。',
    '不要生成平台 logo、水印、账号 ID、二维码或手机边框。',
    '所有文字必须清晰、完整、正向排版，不能旋转或倒置。',
    '文字应作为画面排版的一部分，不要只生成纯插画。',
    '',
    `原始选题：${project.topic}`,
    `页面类型：${page.type}`,
    `内容领域：${project.config.field}`,
    `视觉风格：${project.config.visualStyle}`,
    '',
    '当前页面内容：',
    pageText,
    '',
    '整套图文结构：',
    outline,
    '',
    page.type === 'cover'
      ? '封面要有强视觉焦点，主标题醒目，副标题在标题附近。'
      : page.type === 'summary'
        ? '总结页要有完成感，重点信息清晰，适合收藏。'
        : '内容页要层级分明，重点短句突出，留白克制，适合连续滑读。',
    project.config.useCoverReference && page.index > 0
      ? '参考输入图片的配色、字体层级和版式节奏，但不要复制其中的文字。'
      : '整套页面要形成统一的配色、字体层级、装饰元素和留白节奏。',
  ].join('\n')
}

function StatusIcon({ status }: { status: PageStatus }) {
  if (status === 'loading') return <Loader2 className="spin" size={16} aria-hidden="true" />
  if (status === 'done') return <Check size={16} aria-hidden="true" />
  if (status === 'error') return <AlertCircle size={16} aria-hidden="true" />
  return <ImageIcon size={16} aria-hidden="true" />
}

export default function App() {
  const [topic, setTopic] = useState('给自由职业者做一套高效工作流图文')
  const [config, setConfig] = useState<StudioConfig>(defaultConfig)
  const [project, setProject] = useState<XhsProject | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const [pageStatus, setPageStatus] = useState<Record<string, PageStatus>>({})
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({})
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [pageDraft, setPageDraft] = useState<PageDraft | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [history, setHistory] = useState<SavedProject[]>([])
  const [busy, setBusy] = useState<BusyState>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void getHealth().then(setHealth).catch(() => {
      setHealth({
        ok: false,
        hasApiKey: false,
        textModel: 'unknown',
        imageModel: 'gpt-image-2',
        apiBaseUrl: 'https://api.openai.com/v1',
      } as HealthResponse)
    })
    setHistory(loadHistory())
  }, [])

  useEffect(() => {
    if (!selectedPageId && project?.pages[0]) setSelectedPageId(project.pages[0].id)
  }, [project, selectedPageId])

  const selectedPage = useMemo(() => {
    return project?.pages.find((page) => page.id === selectedPageId) ?? project?.pages[0] ?? null
  }, [project, selectedPageId])

  useEffect(() => {
    setPageDraft(selectedPage ? pageToDraft(selectedPage) : null)
  }, [selectedPage?.id])

  const generatedCount = useMemo(() => Object.values(images).filter(Boolean).length, [images])

  async function fillSettings() {
    const cleanTopic = topic.trim()
    if (!cleanTopic) {
      setError('请输入选题')
      return
    }

    setBusy('settings')
    setError('')
    try {
      const next = await suggestSettings({ topic: cleanTopic })
      setConfig((current) => normalizeConfig({
        ...current,
        field: fields.includes(next.field) ? next.field : current.field,
        visualStyle: styles.includes(next.visualStyle) ? next.visualStyle : current.visualStyle,
        audience: next.audience || current.audience,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function createProject(): Promise<XhsProject | null> {
    const cleanTopic = topic.trim()
    if (!cleanTopic) {
      setError('请输入选题')
      return null
    }

    setBusy('compose')
    setError('')
    try {
      const cleanConfig = normalizeConfig(config)
      setConfig(cleanConfig)
      const response = await composeProject({ topic: cleanTopic, config: cleanConfig })
      setProject(response.project)
      setImages({})
      setPageStatus(Object.fromEntries(response.project.pages.map((page) => [page.id, 'idle'])))
      setPageErrors({})
      setSelectedPageId(response.project.pages[0]?.id ?? '')
      return response.project
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(null)
    }
  }

  async function generatePageImage(targetProject: XhsProject, page: XhsPage, referenceImage?: string): Promise<string | null> {
    const cleanProject = {
      ...targetProject,
      config: normalizeConfig(targetProject.config),
    }
    setPageStatus((current) => ({ ...current, [page.id]: 'loading' }))
    setPageErrors((current) => ({ ...current, [page.id]: '' }))
    try {
      const response = await generateImage({ project: cleanProject, page, referenceImage })
      setImages((current) => ({ ...current, [page.id]: response.image }))
      setPageStatus((current) => ({ ...current, [page.id]: 'done' }))
      return response.image
    } catch (err) {
      setPageStatus((current) => ({ ...current, [page.id]: 'error' }))
      setPageErrors((current) => ({ ...current, [page.id]: err instanceof Error ? err.message : String(err) }))
      return null
    }
  }

  async function generateAllImages(targetProject = project) {
    if (!targetProject) return
    setBusy('images')
    setError('')

    const cleanProject = {
      ...targetProject,
      config: normalizeConfig(targetProject.config),
    }
    const nextImages: Record<string, string> = {}
    try {
      const cover = cleanProject.pages[0]
      let coverImage = ''
      if (cover) {
        const result = await generatePageImage(cleanProject, cover)
        if (result) {
          coverImage = result
          nextImages[cover.id] = result
        }
      }

      for (const page of cleanProject.pages.slice(1)) {
        const reference = cleanProject.config.useCoverReference ? coverImage : undefined
        const result = await generatePageImage(cleanProject, page, reference)
        if (result) nextImages[page.id] = result
      }

      const merged = { ...images, ...nextImages }
      setImages(merged)
      const saved = rememberProject(toSavedProject(cleanProject, merged))
      setHistory(saved)
    } finally {
      setBusy(null)
    }
  }

  async function generateEverything() {
    setBusy('all')
    const created = await createProject()
    if (created) await generateAllImages(created)
    setBusy(null)
  }

  function loadSaved(item: SavedProject) {
    setProject(item)
    setConfig(normalizeConfig(item.config))
    setTopic(item.topic)
    setImages(item.images ?? {})
    setPageStatus(Object.fromEntries(item.pages.map((page) => [page.id, item.images?.[page.id] ? 'done' : 'idle'])))
    setPageErrors({})
    setSelectedPageId(item.pages[0]?.id ?? '')
  }

  function deleteSaved(id: string) {
    const next = saveHistory(history.filter((item) => item.id !== id))
    setHistory(next)
  }

  function clearSaved() {
    clearHistory()
    setHistory([])
  }

  function exportCurrent() {
    const saved = saveSelectedDraft({ clearImage: false })
    const currentProject = saved?.project ?? project
    if (!currentProject) return
    const blob = exportProjectZip(currentProject, images)
    downloadBlob(blob, `${currentProject.topic.slice(0, 18) || 'red-image-studio'}.zip`)
  }

  function saveSelectedDraft(options: { clearImage?: boolean } = {}) {
    if (!project || !selectedPage || !pageDraft) return null

    const updatedBase = draftToPage(selectedPage, pageDraft)
    const nextProjectBase = {
      ...project,
      config: normalizeConfig(project.config),
      pages: project.pages.map((page) => page.id === selectedPage.id ? updatedBase : page),
    }
    const draftPrompt = pageDraft.imagePrompt.trim()
    const originalPrompt = selectedPage.imagePrompt.trim()
    const updatedPage = {
      ...updatedBase,
      imagePrompt: draftPrompt && draftPrompt !== originalPrompt
        ? draftPrompt
        : buildDraftImagePrompt(nextProjectBase, updatedBase),
    }
    const nextProject = {
      ...nextProjectBase,
      pages: nextProjectBase.pages.map((page) => page.id === selectedPage.id ? updatedPage : page),
    }

    setProject(nextProject)
    setPageDraft(pageToDraft(updatedPage))

    if (options.clearImage !== false) {
      setImages((current) => {
        const next = { ...current }
        delete next[updatedPage.id]
        return next
      })
      setPageStatus((current) => ({ ...current, [updatedPage.id]: 'idle' }))
    }

    return { project: nextProject, page: updatedPage }
  }

  async function generateSelectedPage() {
    const saved = saveSelectedDraft({ clearImage: false })
    if (!saved) return
    const cover = saved.project.pages[0]
    const reference = saved.project.config.useCoverReference && saved.page.index > 0 && cover
      ? images[cover.id]
      : undefined
    setBusy('page')
    try {
      await generatePageImage(saved.project, saved.page, reference)
    } finally {
      setBusy(null)
    }
  }

  async function generateAllFromCurrentProject() {
    const saved = saveSelectedDraft({ clearImage: false })
    await generateAllImages(saved?.project ?? project)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>Red Image Studio</h1>
            <p>小红书图文工作台</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={classNames('status-pill', health?.hasApiKey ? 'ok' : 'warn')}>
            {health?.hasApiKey ? 'OpenAI 已配置' : '模拟模式'}
          </span>
          <span className="status-pill">{health?.imageModel ?? 'gpt-image-2'}</span>
          <span className="status-pill api-url">{health?.apiBaseUrl ?? 'https://api.openai.com/v1'}</span>
        </div>
      </header>

      <main className="workspace">
        <section className="panel composer" aria-label="生成设置">
          <div className="panel-title">
            <WandSparkles size={20} aria-hidden="true" />
            <h2>生成</h2>
          </div>

          <label className="field-block">
            <span>选题</span>
            <textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={5} />
          </label>

          <div className="auto-settings">
            <button className="secondary-button full" type="button" onClick={fillSettings} disabled={Boolean(busy)}>
              {busy === 'settings' ? <Loader2 className="spin" size={18} /> : <WandSparkles size={18} />}
              自动填写定位
            </button>
            <dl className="setting-summary">
              <div>
                <dt>领域</dt>
                <dd>{config.field}</dd>
              </div>
              <div>
                <dt>风格</dt>
                <dd>{config.visualStyle}</dd>
              </div>
              <div>
                <dt>读者</dt>
                <dd>{config.audience}</dd>
              </div>
            </dl>
          </div>

          <div className="range-row">
            <label htmlFor="page-count">页数</label>
            <strong>{config.pageCount}</strong>
            <input
              id="page-count"
              type="range"
              min={3}
              max={10}
              value={config.pageCount}
              onChange={(event) => setConfig(normalizeConfig({ ...config, pageCount: Number(event.target.value) }))}
            />
          </div>

          <div className="toggle-row">
            <label>
              <input
                type="checkbox"
                checked={config.useCoverReference}
                onChange={(event) => setConfig(normalizeConfig({ ...config, useCoverReference: event.target.checked }))}
              />
              <span>整套保持同一风格</span>
            </label>
          </div>

          {error && <div className="error-box" role="alert">{error}</div>}

          <div className="button-row">
            <button className="secondary-button" type="button" onClick={createProject} disabled={Boolean(busy)}>
              {busy === 'compose' ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
              生成方案
            </button>
            <button className="primary-button" type="button" onClick={generateEverything} disabled={Boolean(busy)}>
              {busy ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              生成整套
            </button>
          </div>
        </section>

        <section className="panel canvas" aria-label="页面预览">
          <div className="panel-heading-row">
            <div className="panel-title">
              <ImageIcon size={20} aria-hidden="true" />
              <h2>页面</h2>
            </div>
            <div className="count-label">{generatedCount}/{project?.pages.length ?? 0}</div>
          </div>

          {!project ? (
            <div className="empty-state">
              <ImageIcon size={42} aria-hidden="true" />
              <p>输入选题后生成方案</p>
            </div>
          ) : (
            <>
              <div className="page-grid">
                {project.pages.map((page) => {
                  const image = images[page.id]
                  const status = pageStatus[page.id] ?? 'idle'
                  return (
                    <button
                      className={classNames('page-tile', selectedPageId === page.id && 'active')}
                      type="button"
                      key={page.id}
                      onClick={() => setSelectedPageId(page.id)}
                    >
                      <div className="page-image">
                        {image ? <img src={image} alt={page.headline} /> : <span>{page.index + 1}</span>}
                      </div>
                      <div className="page-meta">
                        <StatusIcon status={status} />
                        <span>{page.headline}</span>
                      </div>
                    </button>
                  )
                })}
              </div>

              {selectedPage && pageDraft && (
                <div className="detail-band">
                  <div className="page-editor">
                    <p className="eyebrow">{selectedPage.type} / {selectedPage.index + 1}</p>
                    <label className="field-block">
                      <span>主标题</span>
                      <input
                        value={pageDraft.headline}
                        onChange={(event) => setPageDraft({ ...pageDraft, headline: event.target.value })}
                      />
                    </label>
                    <label className="field-block">
                      <span>副标题</span>
                      <input
                        value={pageDraft.subhead}
                        onChange={(event) => setPageDraft({ ...pageDraft, subhead: event.target.value })}
                      />
                    </label>
                    <label className="field-block">
                      <span>要点内容</span>
                      <textarea
                        className="content-editor"
                        rows={textareaRows(pageDraft.bulletsText, 5)}
                        value={pageDraft.bulletsText}
                        onChange={(event) => setPageDraft({ ...pageDraft, bulletsText: event.target.value })}
                      />
                    </label>
                    <label className="field-block">
                      <span>画面说明</span>
                      <textarea
                        className="content-editor"
                        rows={textareaRows(pageDraft.visualBrief, 4)}
                        value={pageDraft.visualBrief}
                        onChange={(event) => setPageDraft({ ...pageDraft, visualBrief: event.target.value })}
                      />
                    </label>
                    <label className="field-block">
                      <span>图片提示词</span>
                      <textarea
                        className="prompt-editor"
                        rows={textareaRows(pageDraft.imagePrompt, 12)}
                        value={pageDraft.imagePrompt}
                        onChange={(event) => setPageDraft({ ...pageDraft, imagePrompt: event.target.value })}
                      />
                    </label>
                    {pageErrors[selectedPage.id] && <div className="error-box">{pageErrors[selectedPage.id]}</div>}
                  </div>
                  <div className="detail-actions">
                    <button type="button" onClick={() => saveSelectedDraft()}>
                      <Save size={17} />
                      保存
                    </button>
                    <button type="button" onClick={generateSelectedPage} disabled={Boolean(busy)}>
                      {busy === 'page' ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
                      生成当前页
                    </button>
                    <button type="button" onClick={() => copyText(pageDraft.imagePrompt)}>
                      <Copy size={17} />
                      复制提示词
                    </button>
                    {images[selectedPage.id] && (
                      <button type="button" onClick={() => downloadDataUrl(images[selectedPage.id], `${selectedPage.index + 1}-${selectedPage.type}.${config.outputFormat}`)}>
                        <Download size={17} />
                        下载
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="panel publish" aria-label="发布内容">
          <div className="panel-heading-row">
            <div className="panel-title">
              <Archive size={20} aria-hidden="true" />
              <h2>发布</h2>
            </div>
            <button className="icon-button" type="button" onClick={exportCurrent} disabled={!project} aria-label="导出 ZIP">
              <Download size={18} />
            </button>
          </div>

          {project ? (
            <div className="publish-stack">
              <div>
                <div className="mini-heading">
                  <span>标题</span>
                  <button type="button" onClick={() => copyText(project.titleOptions[0] ?? '')}><Copy size={15} />复制</button>
                </div>
                <div className="title-list">
                  {project.titleOptions.map((item) => <p key={item}>{item}</p>)}
                </div>
              </div>

              <div>
                <div className="mini-heading">
                  <span>正文</span>
                  <button type="button" onClick={() => copyText(project.caption)}><Copy size={15} />复制</button>
                </div>
                <pre className="caption-box">{project.caption}</pre>
              </div>

              <div>
                <div className="mini-heading">
                  <span>标签</span>
                  <button type="button" onClick={() => copyText(project.tags.map((tag) => `#${tag}`).join(' '))}><Copy size={15} />复制</button>
                </div>
                <div className="tag-list">
                  {project.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                </div>
              </div>

              <button className="primary-button full" type="button" onClick={generateAllFromCurrentProject} disabled={!project || Boolean(busy)}>
                {busy === 'images' ? <Loader2 className="spin" size={18} /> : <ImageIcon size={18} />}
                生成整套图片
              </button>
            </div>
          ) : (
            <div className="empty-small">暂无方案</div>
          )}

          <div className="history-block">
            <div className="mini-heading">
              <span><History size={16} />历史</span>
              <button type="button" onClick={clearSaved} disabled={!history.length}><Trash2 size={15} />清空</button>
            </div>
            <div className="history-list">
              {history.length === 0 && <p className="muted">暂无记录</p>}
              {history.map((item) => (
                <div className="history-item" key={item.id}>
                  <button type="button" onClick={() => loadSaved(item)}>
                    <strong>{item.topic}</strong>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </button>
                  <button className="icon-button danger" type="button" aria-label="删除历史" onClick={() => deleteSaved(item.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}

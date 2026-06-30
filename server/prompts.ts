import type { ComposeRequest, PageType, XhsPage } from '../src/types'

export function buildContentPrompt({ topic, config }: ComposeRequest): string {
  return [
    '你是小红书图文策划和视觉编辑。',
    '根据输入生成一套可直接出图的图文方案。',
    '输出必须是严格 JSON，不要 Markdown，不要解释。',
    '',
    `选题：${topic}`,
    `领域：${config.field}`,
    `目标读者：${config.audience || '泛小红书用户'}`,
    `视觉风格：${config.visualStyle}`,
    `页数：${config.pageCount}`,
    '',
    'JSON 结构：',
    '{',
    '  "titleOptions": ["标题1", "标题2", "标题3"],',
    '  "caption": "发布正文，使用\\n分段",',
    '  "tags": ["标签1", "标签2"],',
    '  "pages": [',
    '    {',
    '      "type": "cover|content|summary",',
    '      "headline": "页面主标题",',
    '      "subhead": "页面副标题，可为空",',
    '      "bullets": ["页面短句1", "页面短句2"],',
    '      "visualBrief": "画面说明"',
    '    }',
    '  ]',
    '}',
    '',
    '要求：',
    '1. 第一页必须是 cover，最后一页必须是 summary。',
    '2. 标题 15 到 28 个中文字符，偏实用、具体、有点击理由。',
    '3. 每页文字少而密，适合 3:4 手机竖图。',
    '4. 不写夸张医疗、暴富、绝对化承诺。',
    '5. 不出现小红书 logo、水印、账号 ID。',
    '6. 图片提示词要能直接驱动图文排版，不依赖额外上下文。',
  ].join('\n')
}

export function buildImagePrompt(args: {
  topic: string
  page: XhsPage
  pageType: PageType
  config: ComposeRequest['config']
  fullPageList: XhsPage[]
  hasReference: boolean
}): string {
  const { topic, page, pageType, config, fullPageList, hasReference } = args
  const pageText = [
    `主标题：${page.headline}`,
    page.subhead ? `副标题：${page.subhead}` : '',
    page.bullets.length ? `要点：${page.bullets.join('；')}` : '',
    `画面：${page.visualBrief}`,
  ].filter(Boolean).join('\n')

  const outline = fullPageList
    .map((item) => `${item.index + 1}. ${item.headline}`)
    .join('\n')

  return [
    '生成一张小红书风格的竖版图文图片。',
    '画面比例 3:4，适合手机阅读。',
    '不要生成平台 logo、水印、账号 ID、二维码或手机边框。',
    '所有文字必须清晰、完整、正向排版，不能旋转或倒置。',
    '文字应作为画面排版的一部分，不要只生成纯插画。',
    '',
    `原始选题：${topic}`,
    `页面类型：${pageType}`,
    `内容领域：${config.field}`,
    `视觉风格：${config.visualStyle}`,
    '',
    '当前页面内容：',
    pageText,
    '',
    '整套图文结构：',
    outline,
    '',
    '设计方向：',
    pageType === 'cover'
      ? '封面要有强视觉焦点，主标题醒目，副标题在标题附近，信息少但冲击力强。'
      : pageType === 'summary'
        ? '总结页要有完成感，重点信息清晰，适合收藏。'
        : '内容页要层级分明，重点短句突出，留白克制，适合连续滑读。',
    hasReference
      ? '参考输入图片的配色、字体层级和版式节奏，但不要复制其中的文字。'
      : '整套页面要形成统一的配色、字体层级、装饰元素和留白节奏。',
  ].join('\n')
}

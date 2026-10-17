import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { toBlob } from 'html-to-image'
import { MessageContent, SharePageView } from '../../features/share/SharePage'
import { SHARE_MAX_PAGE_HEIGHT, SHARE_WIDTH, paginateShare, type SharePageChunk, type SharePagePlan } from './paginate'
import { buildFontCSS } from './fonts'
import { shareText, type ShareSnapshot } from './snapshot'

export interface RenderedSharePage {
  index: number
  blob: Blob
  url: string
  height: number
}

function mountHost(): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1080px;pointer-events:none;z-index:-1;'
  document.body.appendChild(host)
  return host
}

function staticPage(plan: SharePagePlan): string {
  return renderToStaticMarkup(createElement(SharePageView, { plan }))
}

// 分享页的纸色。WebView2 的 foreignObject 克隆不保证解析 data-paper 作用域的 CSS 变量，
// 因此这里从同一套 token 读一次，失败时用与 tokens.css 一致的值兜底。
const FALLBACK_PAPER: Record<string, string> = {
  xuan: '#f4efe6',
  su: '#f5f5f2',
  ma: '#e9dfcc',
  qing: '#e9ecea',
  ye: '#1c1a17',
  wujin: '#15181b',
}

function resolvePaperColor(paper: string): string {
  if (typeof document === 'undefined') return FALLBACK_PAPER.xuan
  const probe = document.createElement('div')
  probe.dataset.paper = paper
  probe.style.cssText = 'position:fixed;left:-20000px;top:0;width:1px;height:1px;'
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).getPropertyValue('--paper').trim()
  probe.remove()
  return value || FALLBACK_PAPER[paper] || FALLBACK_PAPER.xuan
}

function expectedBackground(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value.trim())
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** 检查导出 PNG 的角落确实有纸色，避免 WebView2 生成黑底/透明底的长图。 */
function assertPaperBackground(bitmap: ImageBitmap, background: string, index: number) {
  const expected = expectedBackground(background)
  if (!expected) return
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  // 只取源图左上角 1px，不能把整张图缩成 1px 取平均色。
  ctx.drawImage(bitmap, 0, 0, 1, 1, 0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  const distance = Math.abs(r - expected[0]) + Math.abs(g - expected[1]) + Math.abs(b - expected[2])
  if (a < 250 || distance > 40) {
    throw new Error(`分享第 ${index} 页背景渲染失败，请更新 WebView2 后重试`)
  }
}

/**
 * 用真实 DOM 测量分页。页面先挂到文档里（不能 display:none），保证 token、字体和
 * 图片尺寸都按最终样式参与布局；测完立即移除。
 */
export async function paginateSnapshot(snapshot: ShareSnapshot): Promise<SharePagePlan[]> {
  if (typeof document === 'undefined') throw new Error('分享图片只能在桌面应用中生成')
  await document.fonts.ready
  const host = mountHost()
  try {
    const measure = (chunks: SharePageChunk[]) => {
      const plan: SharePagePlan = { index: 1, total: 1, snapshot, chunks }
      host.innerHTML = staticPage(plan)
      const page = host.firstElementChild as HTMLElement | null
      if (!page) throw new Error('分享页面渲染失败')
      return Math.ceil(page.getBoundingClientRect().height)
    }
    return paginateShare(snapshot, {
      renderContent: (message) => renderToStaticMarkup(createElement(MessageContent, { message })),
      measure,
    })
  } finally {
    host.remove()
  }
}

/** 把分页结果逐页转成 PNG。每个页面单独测量、截图、释放 canvas，不预先堆叠大图。 */
export async function renderShareBlobs(snapshot: ShareSnapshot, plans: SharePagePlan[]): Promise<RenderedSharePage[]> {
  if (typeof document === 'undefined') throw new Error('分享图片只能在桌面应用中生成')
  const fontCSS = await buildFontCSS(shareText(snapshot))
  await document.fonts.ready
  const host = mountHost()
  const pages: RenderedSharePage[] = []
  try {
    for (const plan of plans) {
      host.innerHTML = staticPage(plan)
      const page = host.firstElementChild as HTMLElement | null
      if (!page) throw new Error('分享页面渲染失败')
      await Promise.all(
        Array.from(page.querySelectorAll('img')).map((img) =>
          typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve(undefined),
        ),
      )
      const rect = page.getBoundingClientRect()
      const height = Math.ceil(rect.height)
      if (Math.abs(rect.width - SHARE_WIDTH) > 1 || height < 1 || height > SHARE_MAX_PAGE_HEIGHT) {
        throw new Error(`分享第 ${plan.index} 页尺寸异常，请缩小分享范围后重试`)
      }
      if (page.scrollWidth > page.clientWidth + 1) {
        throw new Error(`分享第 ${plan.index} 页出现横向溢出，请缩短代码行或表格内容`)
      }
      // WebView2 下纸纹 SVG 与作用域变量可能丢失，导出时强制使用实色纸底，
      // 否则长图会变成黑底，深色正文无法阅读。
      const background = resolvePaperColor(snapshot.paper)
      page.style.backgroundColor = background
      page.style.backgroundImage = 'none'
      const blob = await toBlob(page, {
        width: SHARE_WIDTH,
        height,
        pixelRatio: 1,
        backgroundColor: background,
        fontEmbedCSS: fontCSS,
        cacheBust: true,
        skipAutoScale: true,
      })
      if (!blob) throw new Error(`分享第 ${plan.index} 页生成失败，请重试`)
      if (blob.size > 8 * 1024 * 1024) throw new Error(`分享第 ${plan.index} 页 PNG 超过 8 MiB，请缩小范围`)
      const bitmap = await createImageBitmap(blob)
      const actual = { width: bitmap.width, height: bitmap.height }
      assertPaperBackground(bitmap, background, plan.index)
      bitmap.close()
      if (actual.width !== SHARE_WIDTH || actual.height < 1 || actual.height > SHARE_MAX_PAGE_HEIGHT) {
        throw new Error(`分享第 ${plan.index} 页 PNG 尺寸异常`)
      }
      pages.push({ index: plan.index, blob, url: URL.createObjectURL(blob), height: actual.height })
    }
    return pages
  } catch (error) {
    revokeSharePages(pages)
    throw error
  } finally {
    host.remove()
  }
}

export function revokeSharePages(pages: RenderedSharePage[]) {
  for (const page of pages) URL.revokeObjectURL(page.url)
}

/** 分享页面的底色，用于 html-to-image 的背景参数。 */
export function paperBackground(): string {
  if (typeof document === 'undefined') return 'transparent'
  return getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || 'transparent'
}

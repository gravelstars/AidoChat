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
      const background = getComputedStyle(page).backgroundColor
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

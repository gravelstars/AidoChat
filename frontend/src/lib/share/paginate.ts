import type { ShareMessage, ShareSnapshot } from './snapshot'

export const SHARE_WIDTH = 1080
export const SHARE_PAGE_HEIGHT = 3200
export const SHARE_MAX_PAGES = 20
export const SHARE_MAX_PAGE_HEIGHT = 10000

export interface SharePageChunk {
  message: ShareMessage
  continuation: boolean
  contentHtml: string
}
export interface SharePagePlan {
  index: number
  total: number
  snapshot: ShareSnapshot
  chunks: SharePageChunk[]
}
export interface PaginateDeps {
  /** 渲染一条消息的完整正文 HTML（markdown + 附件摘要），由分享页组件提供。 */
  renderContent(message: ShareMessage): string
  /** 测量一页的实际高度（真实 DOM，含页头页尾）。 */
  measure(chunks: SharePageChunk[]): number
}

export class SharePaginateError extends Error {}

export function assertSharePageLimit(count: number) {
  if (count > SHARE_MAX_PAGES) {
    throw new SharePaginateError(`分享范围超过 ${SHARE_MAX_PAGES} 页，请缩小起止消息后重试`)
  }
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
  : null


/** 字素切分；测试和分页共用，避免把组合字符或 emoji 拆坏。 */
export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment)
  return Array.from(text)
}

function graphemeStarts(text: string): number[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.index)
  const out: number[] = []
  let offset = 0
  for (const ch of text) {
    out.push(offset)
    offset += ch.length
  }
  return out
}

/**
 * 在 fits 允许的范围内找最长前缀。head 至少包含一个字素；整体放不下时返回 null。
 * head + tail 必须与原文完全一致。
 */
export function splitByGrapheme(text: string, fits: (candidate: string) => boolean): { head: string; tail: string } | null {
  const parts = graphemes(text)
  if (parts.length < 2) return null
  let lo = 1
  let hi = parts.length - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (fits(parts.slice(0, mid).join(''))) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (!best) return null
  return { head: parts.slice(0, best).join(''), tail: parts.slice(best).join('') }
}

/**
 * 代码先按原始行切分，保留换行；第一行都放不下时再按字素切分。
 * 边界处的换行留在 head 末尾，head + tail 仍等于原文。
 */
export function splitByLines(text: string, fits: (candidate: string) => boolean): { head: string; tail: string } | null {
  if (!text) return null
  const lines = text.split('\n')
  if (lines.length > 1) {
    let best = 0
    for (let k = lines.length - 1; k >= 1; k--) {
      const head = lines.slice(0, k).join('\n') + '\n'
      if (fits(head)) {
        best = k
        break
      }
    }
    if (best) return { head: lines.slice(0, best).join('\n') + '\n', tail: lines.slice(best).join('\n') }
  }
  const first = splitByGrapheme(lines[0], fits)
  if (!first) return null
  return { head: first.head, tail: first.tail + (lines.length > 1 ? '\n' + lines.slice(1).join('\n') : '') }
}

interface Boundary {
  node: Text
  offset: number
}

function boundaries(el: Element): { total: number; at: (index: number) => Boundary } | null {
  const doc = el.ownerDocument
  if (!doc) return null
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const positions: Boundary[] = []
  let last: Text | null = null
  let node = walker.nextNode()
  while (node) {
    const t = node as Text
    last = t
    for (const index of graphemeStarts(t.data)) positions.push({ node: t, offset: index })
    node = walker.nextNode()
  }
  if (!last || !positions.length) return null
  positions.push({ node: last, offset: last.data.length })
  return { total: positions.length - 1, at: (index) => positions[Math.max(0, Math.min(index, positions.length - 1))] }
}

/** 把元素内容在第 index 个字素边界切成 head/tail，保留内联标记。 */
function sliceElement(el: Element, index: number): { head: Element; tail: Element } | null {
  const bounds = boundaries(el)
  const doc = el.ownerDocument
  if (!bounds || !doc) return null
  const cut = bounds.at(index)
  const headRange = doc.createRange()
  headRange.selectNodeContents(el)
  headRange.setEnd(cut.node, cut.offset)
  const head = el.cloneNode(false) as Element
  head.appendChild(headRange.cloneContents())
  const tailRange = doc.createRange()
  tailRange.selectNodeContents(el)
  tailRange.setStart(cut.node, cut.offset)
  const tail = el.cloneNode(false) as Element
  tail.appendChild(tailRange.cloneContents())
  return { head, tail }
}

function splitText(el: Element, fits: (candidate: Element) => boolean): [Element, Element] | null {
  const bounds = boundaries(el)
  if (!bounds || bounds.total < 2) return null
  let lo = 1
  let hi = bounds.total - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const sliced = sliceElement(el, mid)
    if (sliced && fits(sliced.head)) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (!best) return null
  const sliced = sliceElement(el, best)
  return sliced ? [sliced.head, sliced.tail] : null
}

function splitCode(pre: Element, fits: (candidate: Element) => boolean): [Element, Element] | null {
  const code = pre.querySelector('code') ?? pre
  const text = code.textContent ?? ''
  const build = (value: string) => {
    const node = pre.cloneNode(false) as Element
    const body = code.cloneNode(false) as Element
    body.textContent = value
    node.appendChild(body)
    return node
  }
  const split = splitByLines(text, (value) => fits(build(value)))
  if (!split) return null
  return [build(split.head), build(split.tail)]
}

function cloneWith(container: Element, nodes: Node[]): Element {
  const clone = container.cloneNode(false) as Element
  for (const node of nodes) clone.appendChild(node.cloneNode(true))
  return clone
}

function splitList(list: Element, fits: (candidate: Element) => boolean): [Element, Element] | null {
  const items = Array.from(list.children).filter((n) => n.tagName === 'LI')
  if (!items.length) return null
  const originalStart = Number(list.getAttribute('start') ?? '1') || 1
  const build = (selected: Element[], firstIndex: number) => {
    const clone = list.cloneNode(false) as Element
    if (list.tagName === 'OL') clone.setAttribute('start', String(originalStart + firstIndex))
    for (const item of selected) clone.appendChild(item.cloneNode(true))
    return clone
  }
  for (let k = items.length - 1; k >= 1; k--) {
    const head = build(items.slice(0, k), 0)
    if (fits(head)) return [head, build(items.slice(k), k)]
  }
  // 第一项自身过高：把这一项再拆开，列表包装保留。
  const first = items[0]
  const split = splitNode(first, (candidate) => fits(build([candidate], 0)))
  if (!split) return null
  const head = build([split[0]], 0)
  const tail = build([split[1], ...items.slice(1)], 1)
  return [head, tail]
}

function splitChildren(container: Element, fits: (candidate: Element) => boolean): [Element, Element] | null {
  const nodes = Array.from(container.childNodes)
  for (let k = nodes.length - 1; k >= 1; k--) {
    // 末尾可能夹着空白文本节点，必须找前缀里最后一个「元素」再判断标题。
    let lastElement = -1
    for (let i = 0; i < k; i++) if (nodes[i].nodeType === 1) lastElement = i
    if (lastElement >= 0 && isHeading(nodes[lastElement] as Element)) {
      const nextIndex = nodes.findIndex((n, i) => i > lastElement && n.nodeType === 1)
      if (nextIndex >= 0) {
        const prefix = nodes.slice(0, nextIndex)
        const next = nodes[nextIndex] as Element
        const split = splitNode(next, (candidate) => fits(cloneWith(container, [...prefix, candidate])))
        if (split) {
          const head = cloneWith(container, prefix)
          head.appendChild(split[0].cloneNode(true))
          const tail = cloneWith(container, [])
          tail.appendChild(split[1].cloneNode(true))
          for (const node of nodes.slice(nextIndex + 1)) tail.appendChild(node.cloneNode(true))
          return [head, tail]
        }
      }
    }
    const head = cloneWith(container, nodes.slice(0, k))
    if (fits(head)) return [head, cloneWith(container, nodes.slice(k))]
  }
  const index = nodes.findIndex((n) => n.nodeType === 1)
  if (index >= 0) {
    const first = nodes[index] as Element
    const prefix = nodes.slice(0, index)
    const split = splitNode(first, (candidate) => fits(cloneWith(container, [...prefix, candidate])))
    if (split) {
      const head = cloneWith(container, prefix)
      head.appendChild(split[0].cloneNode(true))
      const tail = cloneWith(container, [])
      tail.appendChild(split[1].cloneNode(true))
      for (const node of nodes.slice(index + 1)) tail.appendChild(node.cloneNode(true))
      return [head, tail]
    }
  }
  return splitText(container, fits)
}

function rowCells(row: Element): Element[] {
  return Array.from(row.children).filter((n) => n.tagName === 'TD' || n.tagName === 'TH')
}

function splitTable(table: Element, fits: (candidate: Element) => boolean): [Element, Element] | null {
  const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
  const rows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).filter((r) => !r.closest('thead'))
  if (!rows.length) return null
  const head = table.querySelector('thead')?.cloneNode(true) as Element | undefined
  const colgroup = table.querySelector('colgroup')?.cloneNode(true) as Element | undefined
  const build = (selected: Element[]) => {
    const clone = table.cloneNode(false) as Element
    if (colgroup) clone.appendChild(colgroup.cloneNode(true))
    if (head) clone.appendChild(head.cloneNode(true))
    const tbody = table.ownerDocument!.createElement('tbody')
    for (const row of selected) tbody.appendChild(row.cloneNode(true))
    clone.appendChild(tbody)
    return clone
  }
  for (let k = rows.length - 1; k >= 1; k--) {
    const candidate = build(rows.slice(0, k))
    if (fits(candidate)) return [candidate, build(rows.slice(k))]
  }
  // 单行过高：按每个单元格的字素预算切成续行，thead 在每页重复。
  const first = rows[0]
  const cells = rowCells(first)
  if (!cells.length) return null
  const counts = cells.map((cell) => graphemes(cell.textContent ?? '').length)
  const max = Math.max(...counts)
  if (max < 2) return null
  const rowSlice = (budget: number, mode: 'head' | 'tail') => {
    const rowClone = first.cloneNode(false) as Element
    cells.forEach((cell, index) => {
      const sliced = sliceElement(cell, mode === 'head' ? Math.min(budget, counts[index]) : Math.min(budget, counts[index]))
      if (!sliced) {
        rowClone.appendChild(cell.cloneNode(false))
        return
      }
      rowClone.appendChild(mode === 'head' ? sliced.head : sliced.tail)
    })
    return rowClone
  }
  let lo = 1
  let hi = max - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (fits(build([rowSlice(mid, 'head')]))) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (!best) return null
  const headRow = rowSlice(best, 'head')
  const tailRow = rowSlice(best, 'tail')
  const tailEmpty = rowCells(tailRow).every((cell) => !(cell.textContent ?? '').trim())
  if (tailEmpty) return null
  return [build([headRow]), build([tailRow, ...rows.slice(1)])]
}

const TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function isHeading(el: Element): boolean {
  return /^H[1-6]$/.test(el.tagName)
}

function splitNode(el: Element, fits: (candidate: Element) => boolean): [Element, Element] | null {
  const tag = el.tagName
  if (TEXT_TAGS.has(tag) || tag === 'FIGCAPTION') return splitText(el, fits)
  if (tag === 'PRE') return splitCode(el, fits)
  if (tag === 'UL' || tag === 'OL') return splitList(el, fits)
  if (tag === 'TABLE') return splitTable(el, fits)
  if (tag === 'IMG' || tag === 'HR' || tag === 'SVG') return null
  if (el.children.length) return splitChildren(el, fits)
  return splitText(el, fits)
}

function parseBlocks(html: string, doc: Document): Element[] {
  const template = doc.createElement('template')
  template.innerHTML = html
  return Array.from(template.content.children) as Element[]
}

/**
 * 按真实页面高度分页。依赖由调用方提供：内容渲染和真实 DOM 测量。
 * 同一消息被拆到多页时，后续片段带 continuation 标记，页面上显示「（续）」。
 */
export function paginateShare(snapshot: ShareSnapshot, deps: PaginateDeps): SharePagePlan[] {
  if (typeof document === 'undefined') throw new SharePaginateError('分享分页只能在桌面窗口中运行')
  const pages: SharePageChunk[][] = [[]]
  const measure = (chunks: SharePageChunk[]) => deps.measure(chunks)
  const fits = (chunks: SharePageChunk[]) => measure(chunks) <= SHARE_PAGE_HEIGHT

  for (const message of snapshot.messages) {
    const html = deps.renderContent(message)
    let remaining = parseBlocks(html, document)
    let continuation = false
    while (remaining.length) {
      const page = pages[pages.length - 1]
      const allHtml = remaining.map((el) => el.outerHTML).join('')
      const whole: SharePageChunk = { message, continuation, contentHtml: allHtml }
      if (fits([...page, whole])) {
        page.push(whole)
        remaining = []
        break
      }
      if (page.length) {
        pages.push([])
        continue
      }
      // 空页仍放不下：先试整块前缀，再拆第一块。
      let fitted: SharePageChunk | null = null
      for (let k = remaining.length - 1; k >= 1; k--) {
        const prefix = remaining.slice(0, k)
        const candidate = { message, continuation, contentHtml: prefix.map((el) => el.outerHTML).join('') }
        if (!fits([candidate])) continue
        // 不要只把标题留在页尾：把下一块的头半部分也拆进来，标题与内容同页。
        if (isHeading(prefix[prefix.length - 1]) && k < remaining.length) {
          const split = splitNode(remaining[k], (head) =>
            fits([{ message, continuation, contentHtml: prefix.map((el) => el.outerHTML).join('') + head.outerHTML }]),
          )
          if (split) {
            fitted = { message, continuation, contentHtml: prefix.map((el) => el.outerHTML).join('') + split[0].outerHTML }
            remaining = [split[1], ...remaining.slice(k + 1)]
            break
          }
        }
        fitted = candidate
        remaining = remaining.slice(k)
        break
      }
      if (!fitted) {
        const split = splitNode(remaining[0], (head) => fits([{ message, continuation, contentHtml: head.outerHTML }]))
        if (!split || !split[1].outerHTML) {
          throw new SharePaginateError(`内容过长，无法分页：请缩小分享范围或缩短第 #${message.seq} 条消息`)
        }
        fitted = { message, continuation, contentHtml: split[0].outerHTML }
        remaining = [split[1], ...remaining.slice(1)]
      }
      page.push(fitted)
      continuation = true
      if (remaining.length) {
        pages.push([])
        assertSharePageLimit(pages.length)
      }
    }
  }

  const used = pages.filter((p) => p.length)
  assertSharePageLimit(used.length)
  return used.map((chunks, i) => ({ index: i + 1, total: used.length, snapshot, chunks }))
}

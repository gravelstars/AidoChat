import { describe, expect, it } from 'vitest'
import { linkifyRefs } from './format'

describe('linkifyRefs', () => {
  it('链接消息与记忆编号', () => {
    expect(linkifyRefs('同意墨白在 #3 的看法，M1 已定')).toBe('同意墨白在 [#3](#msg-3) 的看法，[M1](#mem-1) 已定')
  })
  it('不处理代码', () => {
    expect(linkifyRefs('见 `#3` 和\n```\nM1 #2\n```')).toBe('见 `#3` 和\n```\nM1 #2\n```')
  })
  it('不处理标题与单词内部', () => {
    expect(linkifyRefs('## 标题\nHTML5 a#1 GM2')).toBe('## 标题\nHTML5 a#1 GM2')
  })
})

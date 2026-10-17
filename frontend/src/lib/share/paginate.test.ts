import { describe, expect, it } from 'vitest'
import { assertSharePageLimit, graphemes, splitByGrapheme, splitByLines } from './paginate'

describe('分享分页切分', () => {
  it('按字素切分，不拆坏 emoji 与组合字符', () => {
    expect(graphemes('👨‍👩‍👧‍👦')).toHaveLength(1)
    expect(graphemes('e\u0301')).toHaveLength(1)
    expect(graphemes('甲👨‍👩‍👧‍👦乙')).toHaveLength(3)
    const text = '甲👨‍👩‍👧‍👦乙丙丁'
    const split = splitByGrapheme(text, (candidate) => graphemes(candidate).length <= 3)
    expect(split).not.toBeNull()
    expect(graphemes(split!.head)).toHaveLength(3)
    expect(split!.head + split!.tail).toBe(text)
    expect(split!.head).toContain('👨‍👩‍👧‍👦')
  })

  it('放不下一个字素时返回 null，不产生零进度', () => {
    expect(splitByGrapheme('甲乙丙', () => false)).toBeNull()
    expect(splitByGrapheme('甲', () => true)).toBeNull()
  })

  it('代码优先按原始行切分，边界换行可无损回拼', () => {
    const code = 'line one\nline two\nline three'
    const split = splitByLines(code, (candidate) => candidate.length <= 18)
    expect(split).not.toBeNull()
    expect(split!.head.endsWith('\n')).toBe(true)
    expect(split!.head + split!.tail).toBe(code)
  })

  it('单行过长时退回字素切分，仍然无损回拼', () => {
    const code = 'abcdef\nrest'
    const split = splitByLines(code, (candidate) => candidate.length <= 3)
    expect(split).toEqual({ head: 'abc', tail: 'def\nrest' })
  })

  it('多行都放不下时也返回 null', () => {
    expect(splitByLines('a\nb', () => false)).toBeNull()
  })

  it('20 页允许，21 页直接拒绝', () => {
    expect(() => assertSharePageLimit(20)).not.toThrow()
    expect(() => assertSharePageLimit(21)).toThrow('20 页')
  })
})

import { describe, expect, it } from 'vitest'
import fixture from '../../../testdata/mentions.json'
import { activeMentionQuery, parseMentions, planTargets } from './mention'

describe('parseMentions（与 Go 共享用例）', () => {
  for (const c of fixture.cases) {
    it(c.text, () => {
      const got = parseMentions(c.text, fixture.members)
      expect(got.ids).toEqual(c.ids)
      expect(got.all).toBe(c.all)
    })
  }
})

describe('planTargets', () => {
  it('@所有人 按群成员顺序', () => {
    expect(planTargets(['a', 'b'], { ids: [], all: true })).toEqual(['a', 'b'])
  })
  it('过滤不在群里的成员', () => {
    expect(planTargets(['a', 'b'], { ids: ['c', 'b'], all: false })).toEqual(['b'])
  })
})

describe('activeMentionQuery', () => {
  it('光标紧跟 @ 片段时返回查询词', () => {
    expect(activeMentionQuery('你好 @墨', 5)).toEqual({ start: 3, query: '墨' })
  })
  it('遇到空格结束', () => {
    expect(activeMentionQuery('@墨白 你好', 6)).toBeNull()
  })
  it('邮箱不触发', () => {
    expect(activeMentionQuery('a@b', 3)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { initLanguage, languages, setLanguage, translate, translateError } from './index'

describe('i18n', () => {
  it('发现内置语言并按中文原文翻译', () => {
    initLanguage('en')
    expect(languages.map((l) => l.code)).toEqual(['zh', 'en'])
    expect(translate('成员')).toBe('Members')
    expect(translate('在「{title}」里说点什么', { title: 'Design' })).toBe('Message “Design”')
  })

  it('中文不需要映射，回退到原文', () => {
    setLanguage('zh')
    expect(translate('成员')).toBe('成员')
    expect(translate('未收录的文案')).toBe('未收录的文案')
  })

  it('按语言映射高频后端错误，未命中的保持原文', () => {
    initLanguage('en')
    expect(translateError('成员「墨白」未启用图片输入，请在设置中开启')).toContain('does not have image input enabled')
    expect(translateError('Something unexpected')).toBe('Something unexpected')
    setLanguage('zh')
    expect(translateError('群名不能为空')).toBe('群名不能为空')
  })
})

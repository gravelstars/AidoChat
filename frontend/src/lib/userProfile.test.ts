import { describe, expect, it } from 'vitest'
import { suggestSeal, validateUserProfile } from './userProfile'
describe('独立显示名与短印文', () => {
 it('英文建议首字母，中文保留短名字', () => {
  expect(suggestSeal(' Sam Altman ')).toBe('SA')
  expect(suggestSeal('Sam')).toBe('S')
  expect(suggestSeal('王五')).toBe('王五')
 })
 it('Unicode码点计数，允许词间空格且拒绝换行', () => {
  expect(validateUserProfile({displayName:'Sam Altman',seal:{text:'SA',style:'baiwen'}})).toEqual({})
  expect(validateUserProfile({displayName:'𠮷'.repeat(40),seal:{text:'𠮷',style:'baiwen'}})).toEqual({})
  expect(validateUserProfile({displayName:'a\nb',seal:{text:'SA',style:'baiwen'}}).displayName).toBeTruthy()
 })
 it('超限与空白印文明确报错而不静默截断', () => {
  expect(validateUserProfile({displayName:'a'.repeat(41),seal:{text:'Altman',style:'baiwen'}})).toMatchObject({displayName:expect.any(String),seal:expect.any(String)})
  expect(validateUserProfile({displayName:'你',seal:{text:'S A',style:'baiwen'}}).seal).toBeTruthy()
 })
})

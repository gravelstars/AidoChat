import { describe, expect, it } from 'vitest'
import { attachmentKind, validateAttachment, validateDocument, validateImage, remainingDraft } from './attachments'
describe('附件边界', () => {
 it('只接受首期格式并核验数量和大小', () => {
  expect(attachmentKind('notes.md', '')).toEqual({ kind: 'document', mime: 'text/markdown' })
  expect(() => attachmentKind('a.svg','image/svg+xml')).toThrow('支持')
  expect(() => validateAttachment({name:'a.png',size:10*1024*1024+1,type:'image/png'},0)).toThrow('10 MiB')
  expect(() => validateAttachment({name:'a.txt',size:1,type:'text/plain'},4)).toThrow('4')
 })
 it('拒绝像素、页数和Unicode文本超限，不截断', () => {
  expect(() => validateImage(8000,5001)).toThrow('4000')
  expect(() => validateDocument('😀'.repeat(100000),100)).not.toThrow()
  expect(() => validateDocument('😀'.repeat(100001),1)).toThrow('10 万')
  expect(() => validateDocument('正文',101)).toThrow('100 页')
  expect(() => validateDocument('  ',1)).toThrow('文本')
 })
 it('拒绝 DEL/C1 控制符，允许文本换行与制表符', () => {
  expect(() => validateDocument('正文\u007f')).toThrow('控制字符')
  expect(() => validateDocument('正文\u0085')).toThrow('控制字符')
  expect(() => validateDocument('正文\t\n\r正文')).not.toThrow()
 })
 it('只清理本次已发送的附件，保留后续加入的草稿', () => {
  expect(remainingDraft([{id:'a'},{id:'b'}],['a'])).toEqual([{id:'b'}])
 })
})

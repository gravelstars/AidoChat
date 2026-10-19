import { describe, expect, it } from 'vitest'
import { attachmentKind, serverExtracted, validateAttachment, validateDocument, validateImage, remainingDraft } from './attachments'
describe('附件边界', () => {
 it('接受文档、Office、数据、代码与日志格式', () => {
  expect(attachmentKind('notes.md', '')).toEqual({ kind: 'document', mime: 'text/markdown', extract: 'text' })
  expect(attachmentKind('报告.docx', 'application/zip')).toEqual({
   kind: 'document',
   mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   extract: 'server',
  })
  expect(attachmentKind('slides.pptx', '').extract).toBe('server')
  expect(attachmentKind('data.xlsx', '').extract).toBe('server')
  expect(attachmentKind('data.csv', 'text/csv')).toMatchObject({ mime: 'text/csv', extract: 'text' })
  expect(attachmentKind('data.json', 'application/json')).toMatchObject({ mime: 'application/json', extract: 'text' })
  expect(attachmentKind('main.go', '').extract).toBe('text')
  expect(attachmentKind('Dockerfile', '').extract).toBe('text')
  expect(attachmentKind('server.log', 'text/plain').extract).toBe('text')
  expect(serverExtracted('报告.docx')).toBe(true)
  expect(serverExtracted('main.go')).toBe(false)
  expect(() => attachmentKind('a.svg','image/svg+xml')).toThrow('支持')
  expect(() => attachmentKind('a.docx','text/plain')).toThrow('不匹配')
  expect(() => validateAttachment({name:'a.png',size:10*1024*1024+1,type:'image/png'},0)).toThrow('10 MiB')
  expect(() => validateAttachment({name:'a.docx',size:20*1024*1024+1,type:''},0)).toThrow('20 MiB')
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

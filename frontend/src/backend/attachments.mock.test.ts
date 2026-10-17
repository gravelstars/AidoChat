import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockBackend } from './mock'
describe('附件 mock 与正式后端绑定规则一致',()=>{
 afterEach(()=>vi.unstubAllGlobals())
 it('跨群/重复/重复绑定拒绝，失败不消耗草稿',async()=>{
  vi.stubGlobal('location',{search:''})
  const b=createMockBackend()
  const a=await b.createGroup({title:'附件A',topic:'',memberIds:[],defaultMode:'serial'})
  const g=await b.createGroup({title:'附件B',topic:'',memberIds:[],defaultMode:'serial'})
  const doc=await b.importAttachment({groupId:a.id,name:'a.txt',mime:'text/plain',base64:btoa('abc'),text:'abc',pageCount:0})
  await expect(b.send(g.id,'',undefined,[doc.id])).rejects.toThrow('本群')
  await expect(b.send(a.id,'',undefined,[doc.id,doc.id])).rejects.toThrow('不同')
  expect((await b.openGroup(a.id)).messages.filter(m=>m.authorKind==='user')).toHaveLength(0)
  const sent=await b.send(a.id,'',undefined,[doc.id])
  expect(sent.order).toEqual([])
  expect(sent.userMessage.attachments?.[0].id).toBe(doc.id)
  expect((await b.bootstrap()).groups.find(g=>g.id===a.id)?.lastMessage?.preview).toBe('[附件] a.txt（1份）')
  await expect(b.send(a.id,'',undefined,[doc.id])).rejects.toThrow('已发送')
  await expect(b.removeDraftAttachment(doc.id)).rejects.toThrow('已发送')
  await b.deleteGroup(a.id)
  await expect(b.readAttachment(doc.id)).rejects.toThrow('不存在')
 })
})

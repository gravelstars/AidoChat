import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../backend/contract'

function browserStorage(): Storage {
  const values = new Map<string,string>()
  return { get length() { return values.size }, key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key,value) => { values.set(key,value) },
    removeItem: key => { values.delete(key) }, clear: () => values.clear() }
}
async function load(): Promise<Backend> {
  vi.resetModules()
  return (await import('../backend/mock')).createMockBackend()
}

beforeEach(() => {
  vi.stubEnv('VITE_DEMO', 'true')
  vi.stubGlobal('localStorage', browserStorage())
  vi.stubGlobal('navigator', { userAgent:'Mac' })
  vi.stubGlobal('location', { search:'' })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('浏览器演示数据', () => {
  it('配额失败的附件不留在内存，释放容量后仍能保存和刷新', async () => {
    const api = await load()
    await api.memory.confirm('k3')
    const before = localStorage.getItem('aidochat.demo.v1.state')
    const originalSet = localStorage.setItem.bind(localStorage)
    const quota = vi.spyOn(localStorage,'setItem').mockImplementation(() => {throw new DOMException('full','QuotaExceededError')})
    await expect(api.importAttachment({groupId:'g1',name:'a.txt',mime:'text/plain',base64:btoa('hello'),text:'hello',pageCount:0})).rejects.toThrow('本次更改未保存')
    expect(localStorage.getItem('aidochat.demo.v1.state')).toBe(before)
    quota.mockImplementation(originalSet)
    await api.memory.confirm('k2')
    const saved=JSON.parse(localStorage.getItem('aidochat.demo.v1.state')!)
    expect(saved.attachments).toEqual([])
    expect((await (await load()).openGroup('g1')).memory.find(m=>m.id==='k2')?.status).toBe('confirmed')
  })

  it('流式保存触发配额错误时显示未保存原因、停止轮次且后续可恢复', async () => {
    const api = await load()
    vi.useFakeTimers()
    await api.send('g1','@墨白 继续评审')
    const originalSet=localStorage.setItem.bind(localStorage)
    const quota=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError')})
    await vi.advanceTimersByTimeAsync(3000)
    const detailPromise=api.openGroup('g1')
    await vi.advanceTimersByTimeAsync(100)
    const detail=await detailPromise
    expect(detail.busy).toBe(false)
    expect(detail.messages.at(-1)).toMatchObject({status:'error',error:expect.stringContaining('本次更改未保存')})
    quota.mockImplementation(originalSet)
    await api.memory.confirm('k3')
    vi.useRealTimers()
    expect((await (await load()).openGroup('g1')).memory.find(m=>m.id==='k3')?.status).toBe('confirmed')
  })

  it('流式中盖章保存失败保持轮次对象，恢复容量后能结束并再次发送', async () => {
    const api=await load()
    vi.useFakeTimers()
    const events: import('../backend/contract').BackendEvent[]=[]
    api.subscribe(event=>events.push(event))
    await api.send('g1','@墨白 继续讨论')
    await vi.advanceTimersByTimeAsync(1800)
    const originalSet=localStorage.setItem.bind(localStorage)
    const quota=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError')})
    await expect(api.memory.confirm('k3')).rejects.toThrow('本次更改未保存')
    quota.mockImplementation(originalSet)
    await vi.advanceTimersByTimeAsync(30000)
    const detailPromise=api.openGroup('g1')
    await vi.advanceTimersByTimeAsync(100)
    const detail=await detailPromise
    expect(detail.busy).toBe(false)
    expect(detail.messages.at(-1)?.status).toBe('done')
    expect(detail.memory.find(item=>item.id==='k3')?.status).toBe('proposed')
    expect(events.filter(event=>event.kind==='turn.end')).toHaveLength(1)
    await expect(api.send('g1','现在可以继续记录')).resolves.toMatchObject({order:[]})
  })

  it('旧轮次与旧重试不会覆盖同消息的新重试，或提前结束新轮次', async () => {
    const api=await load()
    vi.useFakeTimers()
    vi.spyOn(Math,'random').mockReturnValue(0)
    const events: import('../backend/contract').BackendEvent[]=[]
    api.subscribe(event=>events.push(event))
    const first=await api.send('g1','@墨白 继续讨论')
    const originalSet=localStorage.setItem.bind(localStorage)
    const quota=vi.spyOn(localStorage,'setItem')
    const fail=()=>quota.mockImplementation(()=>{throw new DOMException('full','QuotaExceededError')})
    fail()
    await vi.advanceTimersByTimeAsync(500)
    quota.mockImplementation(originalSet)
    const saved=JSON.parse(localStorage.getItem('aidochat.demo.v1.state')!)
    const slotId=saved.db.g1.messages.at(-1).id
    await api.retry(slotId)
    // 第一代轮次仍有一个等待中的 chunk；它醒来时不得结束当前重试。
    await vi.advanceTimersByTimeAsync(18)
    expect(events.filter(event=>event.kind==='turn.end')).toHaveLength(1)
    fail()
    await vi.advanceTimersByTimeAsync(482)
    quota.mockImplementation(originalSet)
    await api.retry(slotId)
    // 第二代是 retry 的旧异步闭包，同样不能改写第三代的消息状态。
    await vi.advanceTimersByTimeAsync(18)
    const pending=api.openGroup('g1')
    await vi.advanceTimersByTimeAsync(60)
    const latest=await pending
    expect(latest.busy).toBe(true)
    expect(latest.messages.find(message=>message.id===slotId)).toMatchObject({status:'streaming',content:''})
    expect(events.filter(event=>event.kind==='turn.end')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(30000)
    const complete=api.openGroup('g1')
    await vi.advanceTimersByTimeAsync(60)
    expect((await complete).busy).toBe(false)
    expect(events.filter(event=>event.kind==='turn.end')).toHaveLength(3)
    expect(first.order).toEqual(['mo'])
  })

  it('演示附件在写入前明确拒绝超过512KiB的文件', async () => {
    const api = await load()
    await expect(api.importAttachment({groupId:'g1',name:'large.png',mime:'image/png',base64:'a'.repeat(700000),text:'',pageCount:0})).rejects.toThrow('512 KiB')
    await api.memory.confirm('k3')
    expect(JSON.parse(localStorage.getItem('aidochat.demo.v1.state')!).attachments).toEqual([])
  })

  it('群聊、盖章、成员与附件在新会话回读，Key 从不写入浏览器', async () => {
    const api = await load()
    await api.memory.confirm('k3')
    await api.setUserProfile({displayName:'演示使用者',seal:{text:'演示',style:'zhuwen'}})
    await api.setAppearance({mode:'night',paper:'xuan',nightPaper:'ye',fontSize:'l',density:'compact'})
    const provider = await api.saveProvider({id:'',name:'自定义演示',kind:'anthropic',baseUrl:'https://example.test',key:'never-store-this-secret'})
    expect(provider.hasKey).toBe(false)
    const member = await api.saveMember({id:'',name:'测试成员',brief:'测试',rolePrompt:'测试',avatar:{glyph:'测',color:'dai'},providerId:provider.id,model:'mock',contextTokens:32000})
    const group = await api.createGroup({title:'刷新后仍在',topic:'持久化',memberIds:[member.id],defaultMode:'serial'})
    const attachment = await api.importAttachment({groupId:group.id,name:'说明.txt',mime:'text/plain',base64:btoa('hello'),text:'hello',pageCount:0})
    await api.send(group.id,'这是一个附件',undefined,[attachment.id])
    const serialized = Array.from({length:localStorage.length},(_,i) => localStorage.getItem(localStorage.key(i)!)).join('')
    expect(serialized).not.toContain('never-store-this-secret')
    const next = await load()
    expect((await next.openGroup('g1')).memory.find(m => m.id === 'k3')?.status).toBe('confirmed')
    const bootstrap = await next.bootstrap()
    expect(bootstrap.members.some(m => m.id === member.id)).toBe(true)
    expect(bootstrap.userDisplayName).toBe('演示使用者')
    expect(bootstrap.appearance).toMatchObject({mode:'night',fontSize:'l',density:'compact'})
    const restored = await next.openGroup(group.id)
    expect(restored.messages.at(-1)?.attachments?.[0].id).toBe(attachment.id)
    expect((await next.readAttachment(attachment.id)).text).toBe('hello')
    await expect(next.testProvider({id:provider.id,name:provider.name,kind:provider.kind,baseUrl:provider.baseUrl,key:'',testModel:'mock'})).rejects.toThrow('不会连接模型服务')
  })

  it('退役成员在刷新后保留历史身份，但不再参与群聊', async () => {
    const api = await load()
    await api.deleteMember('qy')
    const next = await load()
    const bootstrap = await next.bootstrap()
    expect(bootstrap.retiredMemberIds).toContain('qy')
    expect(bootstrap.members.find(m => m.id === 'qy')?.name).toBe('青砚')
    expect((await next.openGroup('g1')).group.memberIds).not.toContain('qy')
  })

  it('重载中断中的回复变为 stopped，并保留已生成的正文', async () => {
    const api = await load()
    await api.setMemoryConfig({providerId:'',model:''})
    const { DEMO_STATE_KEY } = await import('./storage')
    const state = JSON.parse(localStorage.getItem(DEMO_STATE_KEY)!)
    state.db.g1.busy = true
    state.db.g1.messages[2].status = 'streaming'
    state.db.g1.messages[3].status = 'pending'
    state.db.g1.messages[3].content = ''
    localStorage.setItem(DEMO_STATE_KEY,JSON.stringify(state))
    const restored = await (await load()).openGroup('g1')
    expect(restored.busy).toBe(false)
    expect(restored.messages[2].status).toBe('stopped')
    expect(restored.messages[2].content).toContain('单列可行')
    expect(restored.messages[3]).toMatchObject({status:'stopped',content:''})
    await expect(api.setMemberAvatar('mo',{glyph:'墨',color:'shiqing',image:'https://example.test/avatar.png'})).rejects.toThrow('不读取远程图片地址')
  })

  it('重置只清理自己的命名空间，随后恢复原始待盖章示例', async () => {
    const api = await load()
    await api.memory.confirm('k3')
    localStorage.setItem('another-app','keep')
    localStorage.setItem('agc.appearance','desktop-preview-setting')
    const { resetDemo } = await import('./storage')
    resetDemo()
    expect(localStorage.getItem('another-app')).toBe('keep')
    expect(localStorage.getItem('agc.appearance')).toBe('desktop-preview-setting')
    expect((await (await load()).openGroup('g1')).memory.find(m => m.id === 'k3')?.status).toBe('proposed')
  })
})

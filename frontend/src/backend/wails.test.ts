import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_APPEARANCE } from './contract'
import type { BackendEvent } from './contract'
import { createWailsBackend, externalURL } from './wails'

function runtime() {
 return {
  Flags: { GetFlag: () => 'mac' },
  Window: { Minimise: vi.fn(async () => {}), ToggleMaximise: vi.fn(async () => {}), Close: vi.fn(async () => {}) },
  Call: { ByName: vi.fn(async (_name: string, ..._args: unknown[]): Promise<unknown> => _name.endsWith('.OpenGroup') ? {group:{id:'g'},messages:[],memory:[],busy:false} : undefined) },
  Events: { On: vi.fn((_name: string, _handler: (e: { data: BackendEvent }) => void) => vi.fn()) },
 }
}
describe('Wails 真实桥接', () => {
 it('所有业务方法调用 Go，省略的模式以 null 传递', async () => {
  const api=runtime();const b=createWailsBackend(async()=>api)
  const input={title:'群',topic:'',memberIds:['a'],defaultMode:'serial' as const}
  await b.createGroup(input);await b.openGroup('g');await b.send('g','@青砚');await b.stop('g');await b.retry('m')
  await b.memory.confirm('i');await b.memory.reject('i');await b.memory.reopen('i');await b.memory.edit('i','改写');await b.memory.summarize('g')
  await b.setUserSeal({text:'我',style:'baiwen'})
  await b.setUserProfile({displayName:'Sam Altman',seal:{text:'SA',style:'baiwen'}})
  const avatar={glyph:'青',color:'shiqing' as const};await b.setGroupAvatar('g','a',null);await b.setMemberAvatar('a',avatar)
  expect(api.Call.ByName.mock.calls).toEqual([
   ['ai-group-chat/app.Service.CreateGroup',input],['ai-group-chat/app.Service.OpenGroup','g'],['ai-group-chat/app.Service.Send','g','@青砚',null],
   ['ai-group-chat/app.Service.Stop','g'],['ai-group-chat/app.Service.Retry','m'],['ai-group-chat/app.Service.ConfirmMemory','i'],['ai-group-chat/app.Service.RejectMemory','i'],
   ['ai-group-chat/app.Service.ReopenMemory','i'],['ai-group-chat/app.Service.EditMemory','i','改写'],['ai-group-chat/app.Service.Summarize','g'],
   ['ai-group-chat/app.Service.SetUserSeal',{text:'我',style:'baiwen'}],['ai-group-chat/app.Service.SetUserProfile',{displayName:'Sam Altman',seal:{text:'SA',style:'baiwen'}}],['ai-group-chat/app.Service.SetGroupAvatar','g','a',null],['ai-group-chat/app.Service.SetMemberAvatar','a',avatar],
  ])
 })
 it('Bootstrap 等监听就绪，读取 Go 数据，释放订阅互不影响', async () => {
  const api=runtime();const initial={platform:'mac',appearance:DEFAULT_APPEARANCE,groups:[]};api.Call.ByName.mockResolvedValue(initial)
  const b=createWailsBackend(async()=>api);const first=vi.fn();const second=vi.fn();const off=b.subscribe(first);const off2=b.subscribe(second)
  expect(await b.bootstrap()).toEqual(initial);expect(api.Events.On).toHaveBeenCalledOnce()
  expect(api.Call.ByName.mock.calls[0][0]).toBe('ai-group-chat/app.Service.Bootstrap')
  const dispatch=api.Events.On.mock.calls[0][1];const event:BackendEvent={kind:'turn.end',groupId:'g',turnId:'t'}
  dispatch({data:event});expect(first).toHaveBeenCalledWith(event);expect(second).toHaveBeenCalledWith(event)
  off();dispatch({data:event});expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(2)
  off2();expect(api.Events.On.mock.results[0].value).toHaveBeenCalledOnce()
 })
 it('启动前取消订阅不会遗留监听', async()=>{
  const api=runtime();const b=createWailsBackend(async()=>api);b.subscribe(vi.fn())();await b.stop('g');expect(api.Events.On).not.toHaveBeenCalled()
 })
 it('运行时瞬时失败后能重试，不会永久卡死', async()=>{
  const quiet=vi.spyOn(console,'error').mockImplementation(()=>{});const api=runtime();let calls=0
  const b=createWailsBackend(async()=>{if(++calls===1)throw new Error('运行时未就绪');return api})
  const off=b.subscribe(()=>{})                          // 第一次连接失败
  await vi.waitFor(()=>expect(calls).toBe(1))
  await new Promise((resolve)=>setTimeout(resolve,0))    // 等失败的连接让位（生产中重试发生在后续操作）
  api.Call.ByName.mockResolvedValue({platform:'mac',appearance:DEFAULT_APPEARANCE,groups:[]})
  await b.bootstrap()                                    // 重试成功并建立监听
  expect(api.Events.On).toHaveBeenCalledOnce()
  off();quiet.mockRestore()
 })
 it('外观保存后同步纸色，错误传回调用方',async()=>{
  const api=runtime();const b=createWailsBackend(async()=>api);await b.setAppearance({...DEFAULT_APPEARANCE,mode:'night'})
  expect(api.Call.ByName.mock.calls).toEqual([['ai-group-chat/app.Service.SetAppearance',{...DEFAULT_APPEARANCE,mode:'night'}],['ai-group-chat/desktop.Shell.SetPaper','ye']])
  api.Call.ByName.mockRejectedValueOnce(new Error('保存失败'));await expect(b.setAppearance(DEFAULT_APPEARANCE)).rejects.toThrow('保存失败')
 })
 it('窗口动作接到运行时',async()=>{
  const api=runtime();const b=createWailsBackend(async()=>api);b.window.minimise();b.window.toggleMaximise();b.window.close()
  await vi.waitFor(()=>expect(api.Window.Close).toHaveBeenCalledOnce());expect(api.Window.Minimise).toHaveBeenCalledOnce();expect(api.Window.ToggleMaximise).toHaveBeenCalledOnce()
 })
 it('外部链接交给系统，来源和同源链接保持内部跳转',()=>{
  expect(externalURL('https://example.com/doc','http://wails.localhost')).toBe('https://example.com/doc')
  expect(externalURL('#msg-12','http://wails.localhost')).toBeNull();expect(externalURL('/avatars/x.gif','http://wails.localhost')).toBeNull();expect(externalURL('javascript:alert(1)','http://wails.localhost')).toBeNull()
 })
})

it('打开群期间收到的完成事件并入快照，避免首次打开丢失终态',async()=>{
 const api=runtime()
 let finish:(v:unknown)=>void=()=>{}
 api.Call.ByName.mockImplementation(async()=>new Promise(resolve=>{finish=resolve}))
 const b=createWailsBackend(async()=>api)
 b.subscribe(()=>{})
 const opening=b.openGroup('g')
 await vi.waitFor(()=>expect(api.Call.ByName).toHaveBeenCalledOnce())
 const message={id:'m',groupId:'g',seq:2,authorKind:'member' as const,authorId:'a',content:'最终正文',mentions:[],mentionAll:false,replyToId:'u',turnId:'t',provider:'p',model:'x',contextSeq:1,status:'done' as const,error:'',createdAt:'2026-10-15T00:00:00Z',replyMode:'serial' as const}
 api.Events.On.mock.calls[0][1]({data:{kind:'delta',groupId:'g',messageId:'m',delta:'最终正文'}})
 api.Events.On.mock.calls[0][1]({data:{kind:'message',groupId:'g',message}})
 api.Events.On.mock.calls[0][1]({data:{kind:'turn.end',groupId:'g',turnId:'t'}})
 finish({group:{id:'g'},messages:[{...message,status:'streaming',content:''}],memory:[],busy:false})
 const detail=await opening
 expect(detail.messages[0].status).toBe('done');expect(detail.messages[0].content).toBe('最终正文');expect(detail.busy).toBe(false)
})

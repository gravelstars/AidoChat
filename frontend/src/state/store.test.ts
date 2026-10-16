import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
 subscribe:vi.fn(),bootstrap:vi.fn(),retry:vi.fn(),setAppearance:vi.fn(),setUserSeal:vi.fn(),
 memory:{confirm:vi.fn(),reject:vi.fn(),reopen:vi.fn(),edit:vi.fn()},openGroup:vi.fn(),stop:vi.fn(),
}))
vi.mock('../backend',()=>({backend:fake,DEFAULT_APPEARANCE:{mode:'day',paper:'xuan',nightPaper:'ye',fontSize:'m',density:'comfortable'},DEFAULT_USER_SEAL:{text:'我',style:'baiwen'}}))
let useChat:typeof import('./store')['useChat']
beforeAll(async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn()}))
 vi.stubGlobal('document',{documentElement:{dataset:{}}})
 useChat=(await import('./store')).useChat
})
beforeEach(()=>{vi.clearAllMocks();useChat.setState({error:null,detail:{}})})
describe('真实后端失败反馈',()=>{
 it('重试拒绝会进入可展示错误状态',async()=>{
  fake.retry.mockRejectedValueOnce(new Error('重新生成尚未接通（TASK-005）'))
  useChat.getState().retry('m')
  await vi.waitFor(()=>expect(useChat.getState().error).toContain('TASK-005'))
 })
 it('外观保存失败恢复原偏好并反馈错误',async()=>{
  const before=useChat.getState().appearance
  fake.setAppearance.mockRejectedValueOnce(new Error('保存失败'))
  useChat.getState().setAppearance({mode:'night'})
  await vi.waitFor(()=>expect(useChat.getState().error).toContain('保存失败'))
  expect(useChat.getState().appearance).toEqual(before)
 })
})

it('盖章失败会撤回乐观状态，避免显示未落库的确认',async()=>{
 const item={id:'i',groupId:'g',status:'proposed',content:'方案',origin:'member'}
 useChat.setState({detail:{g:{group:{id:'g'},messages:[],memory:[item],busy:false,summarizing:false}} as unknown as ReturnType<typeof useChat.getState>['detail']})
 fake.memory.confirm.mockRejectedValueOnce(new Error('保存失败'))
 fake.openGroup.mockRejectedValueOnce(new Error('读取失败'))
 await useChat.getState().confirmMemory('i')
 expect(useChat.getState().detail.g.memory[0].status).toBe('proposed')
 expect(useChat.getState().error).toContain('保存失败')
})

it('首次打开群收到的同一段增量在快照合并和下一帧之间只显示一次',async()=>{
 const {createWailsBackend}=await import('../backend/wails')
 const frames:FrameRequestCallback[]=[]
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.push(fn);return frames.length})
 let receive:(e:{data:import('../backend/contract').BackendEvent})=>void=()=>{}
 let resolveOpen:(v:unknown)=>void=()=>{}
 const group={id:'g',title:'群',topic:'',memberIds:['a'],memberAvatars:{},defaultMode:'serial',memoryCursor:0,createdAt:'2026-10-15T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z'}
 const message={id:'m',groupId:'g',seq:2,authorKind:'member',authorId:'a',content:'',mentions:[],mentionAll:false,replyToId:'u',turnId:'t',provider:'p',model:'x',contextSeq:1,status:'streaming',error:'',createdAt:group.createdAt,replyMode:'serial' as const}
 const b=createWailsBackend(async()=>({
  Flags:{GetFlag:()=> 'mac'},Window:{Minimise:async()=>{},ToggleMaximise:async()=>{},Close:async()=>{}},
  Events:{On:(_name,handler)=>{receive=handler;return()=>{}}},
  Call:{ByName:async(name)=>{
   if(name.endsWith('.Bootstrap'))return {platform:'mac',appearance:useChat.getState().appearance,userSeal:{text:'我',style:'baiwen'},members:[],providers:[],groups:[group]}
   if(name.endsWith('.OpenGroup'))return new Promise(resolve=>{resolveOpen=resolve})
  }},
 }))
 fake.subscribe.mockImplementation(b.subscribe);fake.bootstrap.mockImplementation(b.bootstrap);fake.openGroup.mockImplementation(b.openGroup)
 const opening=useChat.getState().init()
 await vi.waitFor(()=>expect(fake.openGroup).toHaveBeenCalled())
 receive({data:{kind:'delta',groupId:'g',messageId:'m',delta:'只出现一次'}})
 resolveOpen({group,messages:[message],memory:[],busy:true})
 await opening
 for(const fn of frames)fn(performance.now())
 expect(useChat.getState().detail.g.messages[0].content).toBe('只出现一次')
})

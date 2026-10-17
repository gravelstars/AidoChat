import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
 subscribe:vi.fn(),bootstrap:vi.fn(),retry:vi.fn(),setAppearance:vi.fn(),setUserSeal:vi.fn(),setUserProfile:vi.fn(),
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

it('个人资料失败不暴露未保存姓名和印文，成功后一起更新',async()=>{
 useChat.setState({userDisplayName:'旧名字',userSeal:{text:'旧',style:'zhuwen'}})
 const profile={displayName:' Sam Altman ',seal:{text:'SA',style:'baiwen' as const}}
 fake.setUserProfile.mockRejectedValueOnce(new Error('磁盘已满'))
 await expect(useChat.getState().setUserProfile(profile)).rejects.toThrow('磁盘已满')
 expect(useChat.getState().userDisplayName).toBe('旧名字')
 expect(useChat.getState().userSeal.text).toBe('旧')
 fake.setUserProfile.mockResolvedValueOnce(undefined)
 await useChat.getState().setUserProfile(profile)
 expect(useChat.getState().userDisplayName).toBe('Sam Altman')
 expect(useChat.getState().userSeal).toEqual(profile.seal)
})
it('跨页面资料保存串行，旧保存完成不覆盖新实例编辑的草稿',async()=>{
 const {ProfileDraft}=await import('../lib/userProfile')
 useChat.setState({userDisplayName:'旧名字',userSeal:{text:'旧',style:'baiwen'}})
 let finish:()=>void=()=>{}
 fake.setUserProfile.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
 const pending=useChat.getState().setUserProfile({displayName:'请求一',seal:{text:'一',style:'baiwen'}})
 expect(useChat.getState().profileSaving).toBe(true)
 const remounted=new ProfileDraft({displayName:useChat.getState().userDisplayName,seal:useChat.getState().userSeal})
 remounted.edit({displayName:'重新进入后的新草稿',seal:{text:'二',style:'zhuwen'}})
 await expect(useChat.getState().setUserProfile(remounted.value)).rejects.toThrow('正在保存')
 expect(fake.setUserProfile).toHaveBeenCalledTimes(1)
 finish();await pending
 remounted.sync({displayName:useChat.getState().userDisplayName,seal:useChat.getState().userSeal})
 expect(remounted.value.displayName).toBe('重新进入后的新草稿')
 expect(remounted.value.seal.text).toBe('二')
 expect(useChat.getState().profileSaving).toBe(false)
 fake.setUserProfile.mockRejectedValueOnce(new Error('磁盘失败'))
 await expect(useChat.getState().setUserProfile(remounted.value)).rejects.toThrow('磁盘失败')
 remounted.sync({displayName:useChat.getState().userDisplayName,seal:useChat.getState().userSeal})
 expect(remounted.value.displayName).toBe('重新进入后的新草稿')
 expect(useChat.getState().profileSaving).toBe(false)
})
it('旧私印API与个人资料API共用保存互斥，避免相互覆盖',async()=>{
 let finish:()=>void=()=>{}
 fake.setUserSeal.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
 useChat.getState().setUserSeal({text:'旧',style:'baiwen'})
 expect(useChat.getState().profileSaving).toBe(true)
 await expect(useChat.getState().setUserProfile({displayName:'新名字',seal:{text:'新',style:'zhuwen'}})).rejects.toThrow('正在保存')
 expect(fake.setUserProfile).not.toHaveBeenCalled()
 finish();await vi.waitFor(()=>expect(useChat.getState().profileSaving).toBe(false))
 fake.setUserProfile.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
 const saving=useChat.getState().setUserProfile({displayName:'新名字',seal:{text:'新',style:'zhuwen'}})
 useChat.getState().setUserSeal({text:'不能覆盖',style:'baiwen'})
 expect(fake.setUserSeal).toHaveBeenCalledTimes(1)
 finish();await saving
 expect(useChat.getState().userSeal.text).toBe('新')
})

import { beforeAll, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../state/store', async (importOriginal) => {
 const original=await importOriginal<typeof import('../../state/store')>()
 const useChat=Object.assign((selector:(s:ReturnType<typeof original.useChat.getState>)=>unknown)=>selector(original.useChat.getState()),original.useChat)
 return {...original,useChat}
})
vi.mock('../../components/Dialog',()=>({Dialog:()=>null}))
let useChat:typeof import('../../state/store')['useChat']
let SealSection:typeof import('./SettingsView')['SealSection']
beforeAll(async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn()}))
 useChat=(await import('../../state/store')).useChat
 SealSection=(await import('./SettingsView')).SealSection
})
it('完整英文姓名与独立印文展示，三种预览以及建议/保存均为显式动作',()=>{
 useChat.setState({userDisplayName:'Sam Altman',userSeal:{text:'原印',style:'baiwen'}})
 const html=renderToStaticMarkup(createElement(SealSection))
 expect(html).toContain('value="Sam Altman"')
 expect(html).toContain('value="原印"')
 expect(html).toContain('使用建议印文「SA」')
 expect(html).toContain('保存个人资料')
 for(const px of [32,64,112])expect(html).toContain(`width="${px}" height="${px}"`)
})
it('聊天使用当前完整显示名且保留可访问的完整标签',async()=>{
 const {MessageItem}=await import('../chat/MessageItem')
 const longName='𠮷'.repeat(40)
 useChat.setState({userDisplayName:longName})
 const group={archived:false,id:'g',title:'群',topic:'',memberIds:[],memberAvatars:{},defaultMode:'serial' as const,memoryCursor:0,createdAt:'',updatedAt:''}
 const message={id:'m',groupId:'g',seq:1,authorKind:'user' as const,authorId:'user',content:'内容',mentions:[],mentionAll:false,replyToId:'',turnId:'t',provider:'',model:'',contextSeq:0,status:'done' as const,error:'',createdAt:'2026-10-17T00:00:00Z',replyMode:'serial' as const}
 const html=renderToStaticMarkup(createElement(MessageItem,{message,members:{},group,first:true,last:true,fresh:false}))
 expect(html).toContain(`aria-label="${longName}"`)
 expect(html).toContain(`title="${longName}"`)
 expect(html).not.toContain('已退群成员')
})
it('阅读样例保留40字符姓名完整title',async()=>{
 const {SettingsView}=await import('./SettingsView')
 const name='W'.repeat(40)
 useChat.setState({userDisplayName:name})
 const html=renderToStaticMarkup(createElement(SettingsView))
 expect(html).toContain(`title="${name}">${name}</div>`)
})

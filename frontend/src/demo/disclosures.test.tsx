import { beforeAll, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('./storage', async (original) => ({...await original<typeof import('./storage')>(), isDemo:true}))
vi.mock('../backend', async () => ({...await import('../backend/contract'), backend:{}}))
vi.mock('../state/store', () => ({useChat:(selector:(state:unknown)=>unknown) => selector({
  userDisplayName:'你',userSeal:{text:'我',style:'baiwen'},appearance:{mode:'day',paper:'xuan',nightPaper:'ye',fontSize:'m',density:'comfortable'},night:false,members:{},providers:[],retiredIds:[],memory:{},
})}))
vi.mock('../components/Dialog', () => ({Dialog:({description,children,footer}:{description?:string;children:ReactNode;footer:ReactNode}) => <section><p>{description}</p>{children}{footer}</section>}))

beforeAll(() => { vi.stubGlobal('location',{href:'https://example.test/AidoChat/',origin:'https://example.test'}) })
const group={id:'g',title:'群',topic:'',memberIds:[],memberAvatars:{},defaultMode:'serial' as const,memoryCursor:0,archived:false,createdAt:'',updatedAt:''}
const message={id:'m',groupId:'g',seq:1,authorKind:'member' as const,authorId:'mo',content:'',mentions:[],mentionAll:false,replyToId:'',turnId:'t',provider:'',model:'demo',contextSeq:0,status:'done' as const,error:'',createdAt:'2026-10-17T00:00:00Z',replyMode:'serial' as const}

it('远程 Markdown 图片展示说明且没有图片或预加载请求标签',async()=>{
 const {MessageItem}=await import('../features/chat/MessageItem')
 const html=renderToStaticMarkup(createElement(MessageItem,{message:{...message,content:'![远程图](https://remote.test/tracker.png)'},group,members:{},first:true,last:true,fresh:false}))
 expect(html).toContain('演示版不加载远程图片')
 expect(html).not.toContain('remote.test')
 expect(html).not.toContain('rel="preload"')
})
it('分享一打开就明确仅预览且保存图片按钮禁用',async()=>{
 const {ShareExportDialog}=await import('../features/share/ShareExportDialog')
 const html=renderToStaticMarkup(createElement(ShareExportDialog,{open:true,onClose:()=>{},state:{group,messages:[message],memory:[],busy:false,summarizing:false},members:{}}))
 expect(html).toContain('演示版仅预览分享排版，不保存图片。请使用桌面版导出 PNG 到本机目录。')
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span>保存图片<\/span><\/button>/)
})
it('服务配置不渲染 Key 输入或连接测试入口',async()=>{
 const {ProviderDialog}=await import('../features/settings/ProviderDialog')
 const html=renderToStaticMarkup(createElement(ProviderDialog,{open:true,onClose:()=>{}}))
 expect(html).toContain('不接收 API Key，不连接任何模型服务')
 expect(html).not.toContain('type="password"')
 expect(html).not.toContain('测试连接')
})

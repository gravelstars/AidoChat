import { expect, it, vi } from 'vitest'
it('普通浏览器继续加载 mock 演示群并支持平台布局预览',async()=>{
 vi.stubGlobal('window',{})
 vi.stubGlobal('navigator',{userAgent:'Macintosh'})
 vi.stubGlobal('location',{search:'?platform=windows'})
 const {backend}=await import('./index')
 const b=await backend.bootstrap()
 expect(b.platform).toBe('windows');expect(b.groups.length).toBeGreaterThan(0);expect(b.members.length).toBe(4)
 const d=await backend.openGroup(b.groups[0].id)
 expect(d.messages.length).toBeGreaterThan(0)
})

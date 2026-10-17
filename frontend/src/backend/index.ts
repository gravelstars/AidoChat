import { isDemo } from '../demo/storage'
import type { Backend } from './contract'
import { createMockBackend } from './mock'
import { createWailsBackend, isDesktop } from './wails'

// 浏览器预览保留演示数据；桌面启动不创建 mock，也不写入演示群。
export const backend: Backend = !isDemo && isDesktop() ? createWailsBackend() : createMockBackend()
export * from './contract'

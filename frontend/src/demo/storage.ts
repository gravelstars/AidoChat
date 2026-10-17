/** 演示页与开发预览、同源的其他应用互不覆盖。 */
export const DEMO_PREFIX = 'aidochat.demo.v1.'
export const DEMO_STATE_KEY = `${DEMO_PREFIX}state`
export const DEMO_ATTACHMENT_LIMIT = 512 * 1024
export const DEMO_SNAPSHOT_LIMIT = 1_500_000
export const DEMO_STORAGE_ERROR = '演示版浏览器存储空间不足，本次更改未保存。请移除附件或重置演示后重试。'
export const isDemo = import.meta.env.VITE_DEMO === 'true'

export function demoKey(key: string) { return isDemo ? `${DEMO_PREFIX}${key}` : key }
export function resetDemo(storage: Storage = localStorage) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
  for (const key of keys) if (key?.startsWith(DEMO_PREFIX)) storage.removeItem(key)
}

export function recoverDemoGroups<T extends { busy: boolean; messages: { status: string }[] }>(groups: Record<string, T>) {
  for (const group of Object.values(groups)) {
    group.busy = false
    for (const message of group.messages) {
      if (message.status === 'pending' || message.status === 'streaming') message.status = 'stopped'
    }
  }
  return groups
}

export function validateDemoAvatar(avatar: { image?: string } | null) {
  if (avatar?.image && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(avatar.image)) {
    throw new Error('演示版仅支持从本机上传头像，不读取远程图片地址。')
  }
}

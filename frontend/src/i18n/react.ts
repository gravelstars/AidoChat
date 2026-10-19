import { useSyncExternalStore } from 'react'
import { getLanguage, subscribeLanguage, translate } from './index'

/** 订阅当前语言；语言切换时组件自动重渲染。 */
export function useT() {
  useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
  return translate
}

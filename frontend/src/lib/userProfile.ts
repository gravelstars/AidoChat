import type { UserProfile } from '../backend/contract'

export function validateUserProfile(profile: UserProfile): { displayName?: string; seal?: string } {
 const errors: {displayName?:string;seal?:string} = {}
 const n=Array.from(profile.displayName.trim()).length
 if (n<1||n>40||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(profile.displayName)) errors.displayName='显示名需要 1–40 个字符，不能包含换行或控制字符。'
 const chars=Array.from(profile.seal.text)
 if(!['baiwen','zhuwen'].includes(profile.seal.style)||chars.length<1||chars.length>4||/[\s\p{Cc}\p{Cf}]/u.test(profile.seal.text)) errors.seal='印文需要 1–4 个非空白字符。'
 return errors
}

/** 建议只能由用户显式应用，不以完整姓名挤占印面。 */
export function suggestSeal(name: string): string {
 const words=name.trim().split(/\s+/u).filter(Boolean)
 if(!words.length)return ''
 if(/\p{Script=Han}/u.test(name))return Array.from(name.replace(/\s/gu,'')).slice(0,4).join('')
 return words.slice(0,2).map(word=>Array.from(word)[0].toLocaleUpperCase()).join('')
}

/** 当前设置实例持有的草稿；其他实例的保存完成不能覆盖已编辑内容。 */
export class ProfileDraft {
  value: UserProfile
  private dirty = false
  constructor(profile: UserProfile) { this.value = this.copy(profile) }
  private copy(profile: UserProfile): UserProfile { return {...profile, seal:{...profile.seal}} }
  edit(profile: UserProfile): void { this.value = this.copy(profile); this.dirty = true }
  sync(profile: UserProfile): void { if (!this.dirty) this.value = this.copy(profile) }
  accept(profile: UserProfile): void { this.value = this.copy(profile); this.dirty = false }
}

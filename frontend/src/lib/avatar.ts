import type { Avatar, GroupSummary, Member, Pigment, UserSeal } from '../backend'
import { DEFAULT_USER_SEAL } from '../backend'

export const PIGMENTS: { id: Pigment; name: string }[] = [
  { id: 'shiqing', name: '石青' },
  { id: 'shilv', name: '石绿' },
  { id: 'zheshi', name: '赭石' },
  { id: 'tenghuang', name: '藤黄' },
  { id: 'dai', name: '黛' },
  { id: 'zise', name: '紫檀' },
]

/** 成员在某个群里的头像：群内覆盖优先，否则用默认。所有显示成员头像的地方都必须走这里。 */
export function avatarOf(member: Member | undefined, group?: Pick<GroupSummary, 'memberAvatars'>): Avatar | undefined {
  if (!member) return undefined
  return group?.memberAvatars?.[member.id] ?? member.avatar
}

/** 私印是否被用户改过。没改过时确认印仍用「定」，改过就盖用户自己的印。 */
export function isCustomSeal(seal: UserSeal): boolean {
  return seal.text !== DEFAULT_USER_SEAL.text || seal.style !== DEFAULT_USER_SEAL.style
}

/** 私印文字的合法性：1–4 个字，不含空白。按字符（而非 UTF-16 单元）计数。 */
export function sealChars(text: string): string[] {
  return Array.from(text.replace(/\s/g, '')).slice(0, 4)
}

import type { CSSProperties } from 'react'
import type { Avatar, UserSeal as UserSealData } from '../backend'
import { sealChars } from '../lib/avatar'
import styles from './Seal.module.css'

/**
 * 印章。这是产品最重要的识别元素之一：不要换成圆形头像，不要加渐变。
 *   Seal     —— AI 成员：白文印（颜料底、纸色字）或用户上传的图片（含动图，始终播放）
 *   UserSeal —— 用户的私印：1–4 字，白文或朱文，按传统印章的章法排字
 */
export type SealSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const PX: Record<SealSize, number> = { xs: 18, sm: 24, md: 32, lg: 40, xl: 64 }

interface Props {
  avatar?: Avatar
  size?: SealSize
  /** 排队等待中：去色 */
  muted?: boolean
  /** 正在发言：轻微呼吸 */
  active?: boolean
  title?: string
  className?: string
}

export function Seal({ avatar, size = 'md', muted, active, title, className }: Props) {
  const color = `var(--pigment-${avatar?.color ?? 'dai'})`
  const glyph = avatar?.glyph ? Array.from(avatar.glyph)[0] : '?'
  const cls = [styles.seal, styles[size], avatar?.image && styles.hasImage, muted && styles.muted, active && styles.active, className]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls} style={{ '--seal': color } as CSSProperties} title={title} aria-label={title}>
      {avatar?.image ? <img src={avatar.image} alt="" className={styles.img} draggable={false} /> : <span className={styles.glyph}>{glyph}</span>}
    </span>
  )
}

/**
 * 用户私印。字的排布遵循印章章法：从右往左、从上往下读。
 *   1 字：居中
 *   2 字：左右并排，字身拉长（右为首字）
 *   3 字：右列首字拉长占满，左列上下两字
 *   4 字：田字格，右上→右下→左上→左下
 * 小尺寸（≤24px）时多字印只显示首字，否则糊成一团。
 */
export function UserSeal({ seal, size = 'md', px, className, title }: { seal: UserSealData; size?: SealSize; px?: number; className?: string; title?: string }) {
  const dim = px ?? PX[size]
  let chars = sealChars(seal.text)
  if (chars.length === 0) chars = ['我']
  if (dim <= 24 && chars.length > 1) chars = chars.slice(0, 1)
  const zhu = seal.style === 'zhuwen'
  const ink = zhu ? 'var(--cinnabar)' : 'var(--on-cinnabar)'

  // 每个字的位置：[x, y, 字号, 纵向拉伸]
  const layout: [number, number, number, number][] = (() => {
    switch (chars.length) {
      case 1:
        return [[50, 52, 60, 1]]
      case 2:
        return [
          [71, 51, 40, 1.85],
          [29, 51, 40, 1.85],
        ]
      case 3:
        return [
          [71, 51, 40, 1.85],
          [29, 30, 38, 0.98],
          [29, 72, 38, 0.98],
        ]
      default:
        return [
          [71, 30, 38, 0.98],
          [71, 72, 38, 0.98],
          [29, 30, 38, 0.98],
          [29, 72, 38, 0.98],
        ]
    }
  })()

  return (
    <svg
      className={[styles.userSeal, className].filter(Boolean).join(' ')}
      width={dim}
      height={dim}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title ?? `私印：${chars.join('')}`}
    >
      {zhu ? (
        <rect x="4" y="4" width="92" height="92" rx="9" fill="var(--paper-raised)" stroke="var(--cinnabar)" strokeWidth="7" />
      ) : (
        <>
          <rect x="0" y="0" width="100" height="100" rx="14" fill="var(--cinnabar)" />
          {dim >= 32 && <rect x="7" y="7" width="86" height="86" rx="8" fill="none" stroke="var(--on-cinnabar)" strokeOpacity="0.45" strokeWidth="1.6" />}
        </>
      )}
      {layout.map(([x, y, fs, sy], i) => (
        <text
          key={i}
          x={x}
          y={y}
          fontSize={fs}
          fill={ink}
          textAnchor="middle"
          dominantBaseline="central"
          transform={sy !== 1 ? `translate(${x} ${y}) scale(1 ${sy}) translate(${-x} ${-y})` : undefined}
          className={styles.sealText}
        >
          {chars[i]}
        </text>
      ))}
    </svg>
  )
}

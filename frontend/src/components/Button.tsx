import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './Button.module.css'

/**
 * 按钮。variant 用法：
 *   primary —— 墨色实底，页面里最主要的一个动作（如"创建"）
 *   accent  —— 朱色实底，只用于"用户拍板"类动作（发送、确认盖章）
 *   ghost   —— 描边，次要动作
 *   quiet   —— 无边框，工具栏、列表内的轻动作
 */
type Variant = 'primary' | 'accent' | 'ghost' | 'quiet'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: IconName
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'ghost', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  const cls = [styles.btn, styles[variant], styles[size], !children && styles.iconOnly, className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children && <span>{children}</span>}
    </button>
  )
})

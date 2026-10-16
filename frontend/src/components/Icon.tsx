import type { SVGProps } from 'react'

/**
 * 图标集：24 栅格、1.6 描边、圆头。新增图标须保持同一笔触，不要引入第三方图标库。
 */
const paths = {
  send: <path d="M5 12h12M12 6l6 6-6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  retry: <path d="M5 12a7 7 0 1 0 2.05-4.95M5 4.5v3.5h3.5" />,
  edit: <path d="M5 19h3.5L18.5 9a2.12 2.12 0 0 0-3-3L5.5 16 5 19z" />,
  panel: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M14.5 5v14" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.6 2 3 4.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6" />
    </>
  ),
  chat: <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3h0.5A1.5 1.5 0 0 1 5 14.5z" />,
  sparkle: <path d="M12 4.5l1.6 4.4 4.4 1.6-4.4 1.6L12 16.5l-1.6-4.4L6 10.5l4.4-1.6zM18 16l.7 1.8 1.8.7-1.8.7L18 21l-.7-1.8-1.8-.7 1.8-.7z" />,
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v1.8M12 18.7v1.8M20.5 12h-1.8M5.3 12H3.5M18 6l-1.3 1.3M7.3 16.7L6 18M18 18l-1.3-1.3M7.3 7.3L6 6" />
    </>
  ),
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  minimise: <path d="M6 12h12" />,
  maximise: <rect x="6.5" y="6.5" width="11" height="11" rx="1" />,
  reply: <path d="M10 8L5 12.5l5 4.5M5.5 12.5H14a5 5 0 0 1 5 5V19" />,
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  )
}

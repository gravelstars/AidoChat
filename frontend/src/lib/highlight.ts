/**
 * 代码高亮（TASK-011）。用 shiki 的 core + JS 引擎 + 按需语言包，
 * 主题「案头」走 css-variables 模式：颜色全部取自 tokens.css 的变量，日间/夜间自动跟随纸张。
 * 语言包与引擎都在需要时才动态加载，主包只增加引擎与主题的体积。
 */
import { createHighlighterCore, createCssVariablesTheme, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// 主题「案头」：css-variables 模式，颜色全部落到 tokens.css 的变量上，日间/夜间随纸张走。
// 默认值写成 var(--token)，输出形如 var(--shiki-token-keyword, var(--pigment-shiqing))。
const antou = createCssVariablesTheme({
  name: 'antou',
  variablePrefix: '--shiki-',
  variableDefaults: {
    foreground: 'var(--ink)',
    background: 'transparent',
    'token-comment': 'var(--ink-3)',
    'token-keyword': 'var(--pigment-shiqing)',
    'token-string': 'var(--pigment-shilv)',
    'token-string-expression': 'var(--pigment-shilv)',
    'token-constant': 'var(--pigment-zheshi)',
    'token-function': 'var(--ink)',
    'token-parameter': 'var(--ink-2)',
    'token-punctuation': 'var(--ink-2)',
    'token-link': 'var(--ink-2)',
  },
})

// 常见语言的别名 → shiki 语言名
const ALIAS: Record<string, string> = {
  ts: 'typescript', typescript: 'typescript', tsx: 'tsx',
  js: 'javascript', javascript: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  go: 'go', golang: 'go',
  py: 'python', python: 'python',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash',
  html: 'html', xml: 'xml', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown',
  sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  rust: 'rust', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', cs: 'csharp', csharp: 'csharp',
  dockerfile: 'dockerfile', docker: 'dockerfile', diff: 'diff', ini: 'ini', makefile: 'makefile', make: 'makefile',
}

// 显式列出导入路径，Vite 才能把它们拆成按需加载的独立 chunk（不能用变量拼接）。
const LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  go: () => import('@shikijs/langs/go'),
  python: () => import('@shikijs/langs/python'),
  bash: () => import('@shikijs/langs/bash'),
  html: () => import('@shikijs/langs/html'),
  xml: () => import('@shikijs/langs/xml'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  less: () => import('@shikijs/langs/less'),
  markdown: () => import('@shikijs/langs/markdown'),
  sql: () => import('@shikijs/langs/sql'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  diff: () => import('@shikijs/langs/diff'),
  ini: () => import('@shikijs/langs/ini'),
  makefile: () => import('@shikijs/langs/makefile'),
}

let core: Promise<HighlighterCore> | undefined
const loaded = new Set<string>()

function highlighter(): Promise<HighlighterCore> {
  core ??= createHighlighterCore({ themes: [antou], langs: [], engine: createJavaScriptRegexEngine() })
  return core
}

/** 高亮一段代码；语言未知或加载失败时返回 null（调用方回退为纯文本）。 */
export async function highlight(code: string, lang: string): Promise<string | null> {
  const name = ALIAS[(lang || '').trim().toLowerCase()]
  const load = name ? LOADERS[name] : undefined
  if (!load) return null
  try {
    const h = await highlighter()
    if (!loaded.has(name)) {
      const mod = (await load()) as { default?: unknown }
      await h.loadLanguage((mod.default ?? mod) as never)
      loaded.add(name)
    }
    return h.codeToHtml(code, { lang: name, theme: 'antou' })
  } catch {
    return null
  }
}
